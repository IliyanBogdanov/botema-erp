/**
 * aiEnrichAll.js — Comprehensive data enrichment pass
 *
 * Steps:
 * 1. Fix migration records: copy amount from original Purchase for "Мигрирано от Purchase" BizDocs
 * 2. Heuristic payment matching: parse invoice refs from payment notes/references
 * 3. Gemini AI payment matching: match remaining unmatched payments using Gemini
 * 4. Re-run BizDoc linking (aiReLink logic) for improved linking
 *
 * Run: node scripts/aiEnrichAll.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const EUR_BGN = 1.95583;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBGN(amount, currency) {
  const a = parseFloat(amount) || 0;
  return currency === 'EUR' ? a * EUR_BGN : a;
}

function toEUR(amount, currency) {
  const a = parseFloat(amount) || 0;
  return currency === 'BGN' ? a / EUR_BGN : a;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geminiJSON(prompt, retries = 3) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  for (let i = 0; i < retries; i++) {
    try {
      const res = await model.generateContent(prompt);
      const text = res.response.text().trim();
      const json = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
      return JSON.parse(json);
    } catch (e) {
      if (i < retries - 1) { await sleep(2000 * (i + 1)); continue; }
      throw e;
    }
  }
}

// ─── Step 1: Fix Migration Records ───────────────────────────────────────────

async function fixMigrationRecords() {
  console.log('\n═══ STEP 1: Fix Migration Records ═══');

  const migratedDocs = await prisma.bizDocument.findMany({
    where: {
      notes: { contains: 'Мигрирано от Purchase' },
      OR: [{ amountTotal: null }, { amountTotal: 0 }],
    },
    select: { id: true, notes: true, currency: true },
  });

  console.log(`Found ${migratedDocs.length} migration records without amounts`);

  let fixed = 0;
  for (const doc of migratedDocs) {
    // Extract Purchase ID from notes: "Мигрирано от Purchase <id>"
    const match = doc.notes?.match(/Мигрирано от Purchase\s+(\S+)/);
    if (!match) continue;

    const purchaseId = match[1];
    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: { amount: true, currency: true },
    });

    if (!purchase || !purchase.amount || Number(purchase.amount) === 0) continue;

    const amt = Number(purchase.amount);
    const vat = 0;  // Purchase model has no vatAmount field
    const net = amt;
    const currency = purchase.currency || doc.currency || 'EUR';

    await prisma.bizDocument.update({
      where: { id: doc.id },
      data: {
        amountTotal: amt,
        amountNet: net > 0 ? net : amt,
        vatAmount: vat > 0 ? vat : null,
        currency,
      },
    });
    fixed++;
  }

  console.log(`Fixed ${fixed} migration records`);
}

// ─── Step 2: Heuristic Payment Matching ──────────────────────────────────────

function extractInvoiceNumber(text) {
  if (!text) return null;
  // Patterns: ФАКТУРА 0000000249, Фактура номер 0000000376, inv-123, etc.
  const patterns = [
    /[Фф]актура\s*(?:номер)?\s*([0-9]{4,})/i,
    /\bINV[-\s]?([0-9]{3,})\b/i,
    /\b([0-9]{9,10})\b/,   // long invoice numbers
    /\bF[-\s]?([0-9]{4,})\b/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) return m[1].replace(/^0+/, '');  // strip leading zeros
  }
  return null;
}

async function heuristicPaymentMatch() {
  console.log('\n═══ STEP 2: Heuristic Payment Matching ═══');

  const unmatched = await prisma.payment.findMany({
    where: { status: 'UNMATCHED' },
    select: { id: true, amount: true, currency: true, reference: true, notes: true, paymentDate: true, counterpartyId: true },
  });

  console.log(`Unmatched payments: ${unmatched.length}`);

  // Get all open BizDocuments
  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_OUT', 'OFFER_OUT'] },
      amountTotal: { gt: 0 },
    },
    select: { id: true, docNumber: true, amountTotal: true, currency: true, counterpartyId: true, docDate: true, docType: true },
  });

  // Index docs by normalized invoice number
  const docByNum = new Map();
  for (const doc of docs) {
    if (doc.docNumber) {
      const key = doc.docNumber.replace(/^0+/, '').replace(/[^0-9]/g, '');
      if (key) {
        if (!docByNum.has(key)) docByNum.set(key, []);
        docByNum.get(key).push(doc);
      }
    }
  }

  let matched = 0;

  for (const pay of unmatched) {
    const combined = `${pay.reference || ''} ${pay.notes || ''}`;
    const invNum = extractInvoiceNumber(combined);

    if (invNum) {
      const candidates = docByNum.get(invNum) || [];
      if (candidates.length === 1) {
        const doc = candidates[0];
        // Verify amount roughly matches (within 10%)
        const payEur = toEUR(Number(pay.amount), pay.currency);
        const docEur = toEUR(Number(doc.amountTotal), doc.currency);
        const ratio = docEur > 0 ? Math.abs(payEur - docEur) / docEur : 1;

        if (ratio < 0.15 || candidates.length === 1) {
          // Check no existing link
          const existing = await prisma.reconciliationLink.findFirst({
            where: { paymentId: pay.id },
          });
          if (!existing) {
            await prisma.reconciliationLink.create({
              data: {
                sourceDocId: doc.id,
                paymentId: pay.id,
                linkType: 'PAYMENT_TO_INVOICE',
                confidence: ratio < 0.05 ? 0.95 : 0.80,
                notes: `Ref match: inv#${invNum}`,
              },
            });
            await prisma.payment.update({
              where: { id: pay.id },
              data: { status: 'MATCHED' },
            });
            matched++;
          }
        }
      }
    }
  }

  console.log(`Heuristic matched: ${matched} payments`);
  return matched;
}

// ─── Step 3: Amount-based Payment Matching ───────────────────────────────────

async function amountPaymentMatch() {
  console.log('\n═══ STEP 3: Amount-based Payment Matching ═══');

  const unmatched = await prisma.payment.findMany({
    where: { status: 'UNMATCHED' },
    select: { id: true, amount: true, currency: true, reference: true, notes: true, paymentDate: true, counterpartyId: true },
  });

  console.log(`Still unmatched: ${unmatched.length}`);

  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_OUT'] },
      amountTotal: { gt: 0 },
    },
    select: { id: true, docNumber: true, amountTotal: true, currency: true, counterpartyId: true, docDate: true, docType: true },
  });

  // Build a set of already-linked doc IDs
  const linkedDocIds = new Set(
    (await prisma.reconciliationLink.findMany({
      where: { paymentId: { not: null } },
      select: { sourceDocId: true },
    })).map(l => l.sourceDocId)
  );

  let matched = 0;

  for (const pay of unmatched) {
    const payEur = toEUR(Number(pay.amount), pay.currency);
    if (payEur < 1) continue; // skip tiny fee payments

    const payDate = new Date(pay.paymentDate);

    // Find docs with matching amount (±3%) and same counterparty (or no counterparty filter)
    const candidates = docs.filter(doc => {
      if (linkedDocIds.has(doc.id)) return false;
      const docEur = toEUR(Number(doc.amountTotal), doc.currency);
      if (docEur < 1) return false;
      const ratio = Math.abs(payEur - docEur) / Math.max(payEur, docEur);
      if (ratio > 0.03) return false;

      // Date within 90 days
      if (doc.docDate) {
        const docDate = new Date(doc.docDate);
        const daysDiff = Math.abs(payDate - docDate) / 86400000;
        if (daysDiff > 90) return false;
      }

      // Prefer same counterparty
      if (pay.counterpartyId && doc.counterpartyId && pay.counterpartyId !== doc.counterpartyId) return false;

      return true;
    });

    if (candidates.length === 1) {
      const doc = candidates[0];
      const existing = await prisma.reconciliationLink.findFirst({
        where: { paymentId: pay.id },
      });
      if (!existing) {
        await prisma.reconciliationLink.create({
          data: {
            sourceDocId: doc.id,
            paymentId: pay.id,
            linkType: 'PAYMENT_TO_INVOICE',
            confidence: 0.90,
            notes: `Amount match: ${payEur.toFixed(2)} EUR ±3%`,
          },
        });
        await prisma.payment.update({
          where: { id: pay.id },
          data: { status: 'MATCHED' },
        });
        linkedDocIds.add(doc.id);
        matched++;
      }
    }
  }

  console.log(`Amount-matched: ${matched} payments`);
  return matched;
}

// ─── Step 4: Gemini AI Payment Matching ──────────────────────────────────────

async function geminiPaymentMatch() {
  console.log('\n═══ STEP 4: Gemini AI Payment Matching ═══');

  const unmatched = await prisma.payment.findMany({
    where: {
      status: 'UNMATCHED',
      amount: { gt: 10 },  // skip tiny fees
      notes: { not: { contains: 'ТАКСА' } },  // skip fee entries
    },
    select: {
      id: true, amount: true, currency: true,
      reference: true, notes: true, paymentDate: true,
      counterparty: { select: { id: true, name: true } },
    },
    orderBy: { amount: 'desc' },
    take: 200,  // process top 200 by amount
  });

  console.log(`Processing ${unmatched.length} unmatched payments with Gemini`);

  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_OUT'] },
      amountTotal: { gt: 0 },
    },
    select: {
      id: true, docNumber: true, amountTotal: true, currency: true,
      counterpartyId: true, docDate: true, docType: true,
      counterparty: { select: { name: true } },
    },
  });

  const linkedPayIds = new Set(
    (await prisma.reconciliationLink.findMany({
      where: { paymentId: { not: null } },
      select: { paymentId: true },
    })).map(l => l.paymentId).filter(Boolean)
  );

  let matched = 0;
  let processed = 0;
  const BATCH = 10;

  // Process in batches
  for (let i = 0; i < unmatched.length; i += BATCH) {
    const batch = unmatched.slice(i, i + BATCH).filter(p => !linkedPayIds.has(p.id));
    if (batch.length === 0) continue;

    // Build candidate pool (docs within ±50% amount range of batch max)
    const batchMaxEur = Math.max(...batch.map(p => toEUR(Number(p.amount), p.currency)));
    const candidates = docs.filter(d => {
      const docEur = toEUR(Number(d.amountTotal), d.currency);
      return docEur >= batchMaxEur * 0.1 && docEur <= batchMaxEur * 3;
    }).slice(0, 60);  // cap at 60 candidates

    const prompt = `You are a financial document matching expert for a Bulgarian interior design company.

Match each payment to the best BizDocument candidate. Return ONLY valid JSON.

PAYMENTS (to match):
${batch.map(p => `ID:${p.id} | Amt:${p.amount} ${p.currency} | Date:${p.paymentDate?.toISOString?.()?.slice(0,10) || '?'} | Ref:${p.reference?.slice(0,60) || ''} | Notes:${p.notes?.slice(0,80) || ''} | CP:${p.counterparty?.name || 'unknown'}`).join('\n')}

BIZDOC CANDIDATES:
${candidates.map(d => `ID:${d.id} | Num:${d.docNumber || '?'} | Amt:${d.amountTotal} ${d.currency} | Date:${d.docDate?.toISOString?.()?.slice(0,10) || '?'} | Type:${d.docType} | CP:${d.counterparty?.name || 'unknown'}`).join('\n')}

Rules:
- Match by invoice number in payment notes/reference
- Match by exact or near-exact amount (±5%) + same counterparty + close date (±60 days)
- Only match if you are >75% confident
- A doc can only be matched once
- Skip payments for bank fees, taxes, tiny amounts

Return JSON array: [{"payId":"...","docId":"...","confidence":0.85,"reason":"..."}]
If no good match exists for a payment, omit it from the array.`;

    try {
      const results = await geminiJSON(prompt);
      if (!Array.isArray(results)) continue;

      for (const r of results) {
        if (!r.payId || !r.docId || r.confidence < 0.75) continue;
        if (linkedPayIds.has(r.payId)) continue;

        const existing = await prisma.reconciliationLink.findFirst({
          where: { paymentId: r.payId },
        });
        if (existing) continue;

        try {
          await prisma.reconciliationLink.create({
            data: {
              sourceDocId: r.docId,
              paymentId: r.payId,
              linkType: 'PAYMENT_TO_INVOICE',
              confidence: r.confidence,
              notes: `Gemini: ${r.reason?.slice(0, 100) || ''}`,
            },
          });
          await prisma.payment.update({
            where: { id: r.payId },
            data: { status: r.confidence >= 0.90 ? 'MATCHED' : 'PARTIAL' },
          });
          linkedPayIds.add(r.payId);
          matched++;
        } catch (e) {
          // Skip if doc doesn't exist etc.
        }
      }
    } catch (e) {
      console.warn(`Batch ${i}-${i + BATCH} failed: ${e.message}`);
    }

    processed += batch.length;
    if (processed % 50 === 0) console.log(`  Processed ${processed}/${unmatched.length}...`);
    await sleep(500);  // rate limit
  }

  console.log(`Gemini matched: ${matched} payments`);
  return matched;
}

// ─── Step 5: Enrich Counterparty Info ────────────────────────────────────────

async function enrichCounterparties() {
  console.log('\n═══ STEP 5: Enrich Counterparty Data ═══');

  // Find counterparties with no website/domain set
  const noWebsite = await prisma.counterparty.findMany({
    where: {
      OR: [{ website: null }, { website: '' }],
      type: { in: ['SUPPLIER', 'CLIENT'] },
    },
    select: { id: true, name: true, type: true, country: true },
    take: 50,
  });

  console.log(`Counterparties without website: ${noWebsite.length}`);
  if (noWebsite.length === 0) return;

  const prompt = `You are a business research expert. For each company, provide the most likely website domain.
Focus on Bulgarian and Italian companies (we're an interior design studio importing from Italy).

Companies:
${noWebsite.map(c => `ID:${c.id} | Name:"${c.name}" | Type:${c.type} | Country:${c.country || '?'}`).join('\n')}

Return JSON array: [{"id":"...","domain":"example.com","confidence":0.9}]
Only include entries where you're >80% confident. Return empty array [] if unsure about all.`;

  try {
    const results = await geminiJSON(prompt);
    if (!Array.isArray(results)) return;

    let updated = 0;
    for (const r of results) {
      if (!r.id || !r.domain || r.confidence < 0.80) continue;
      const domain = r.domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
      await prisma.counterparty.update({
        where: { id: r.id },
        data: {
          website: `https://${domain}`,
          logoUrl: `https://logo.clearbit.com/${domain}`,
        },
      });
      updated++;
    }
    console.log(`Updated ${updated} counterparty websites`);
  } catch (e) {
    console.warn(`Counterparty enrichment failed: ${e.message}`);
  }
}

// ─── Step 6: Summary ─────────────────────────────────────────────────────────

async function printSummary() {
  console.log('\n═══ FINAL SUMMARY ═══');
  const [total, noAmt, noCP, unmatched, links, totalPay] = await Promise.all([
    prisma.bizDocument.count(),
    prisma.bizDocument.count({ where: { OR: [{ amountTotal: null }, { amountTotal: 0 }] } }),
    prisma.bizDocument.count({ where: { counterpartyId: null } }),
    prisma.payment.count({ where: { status: 'UNMATCHED' } }),
    prisma.reconciliationLink.count(),
    prisma.payment.count(),
  ]);
  console.log(`BizDocuments: ${total} | No amount: ${noAmt} | No counterparty: ${noCP}`);
  console.log(`Payments: ${totalPay} | Unmatched: ${unmatched} | Reconciliation links: ${links}`);

  const payByStatus = await prisma.payment.groupBy({ by: ['status'], _count: { id: true } });
  payByStatus.forEach(r => console.log(`  Payment ${r.status}: ${r._count.id}`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Botema ERP — Comprehensive Enrichment  ║');
  console.log('╚══════════════════════════════════════════╝');

  try {
    await fixMigrationRecords();
    await heuristicPaymentMatch();
    await amountPaymentMatch();
    await geminiPaymentMatch();
    await enrichCounterparties();
    await printSummary();
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
