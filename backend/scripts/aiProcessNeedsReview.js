/**
 * AI processing of all NEEDS_REVIEW BizDocs
 * 1. Rule-based: extract offer numbers from OFFER_OUT filenames
 * 2. AI-based: classify INVOICE_IN (real invoice vs price list/catalog)
 * 3. DELIVERY_NOTE: link СИЛТЕМ emails to known client
 * 4. After classification: link processed docs to purchases/invoices/projects
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── helpers ─────────────────────────────────────────────────────────────────

function normalize(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/\b(еоод|оод|ад|ет|ltd|gmbh|s\.r\.l\.?|spa|s\.p\.a\.?|inc|llc|co\b)\b/gi, '')
    .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? inter / union : 0;
}

async function linkExists(sourceDocId, targetDocId) {
  const existing = await prisma.reconciliationLink.findFirst({
    where: {
      OR: [
        { sourceDocId, targetDocId },
        { sourceDocId: targetDocId, targetDocId: sourceDocId },
      ],
    },
  });
  return !!existing;
}

// ─── Step 1: Extract offer numbers from OFFER_OUT filenames ──────────────────

async function processOffers() {
  console.log('\n[1] Processing OFFER_OUT — extracting docNumbers from filenames...');
  const offers = await prisma.bizDocument.findMany({
    where: { status: 'NEEDS_REVIEW', docType: 'OFFER_OUT' },
    include: { counterparty: true },
  });

  let updated = 0;
  let linked = 0;

  for (const doc of offers) {
    const notes = doc.notes || '';

    // Extract pattern like 1717.208 or 1717_1.160
    const match = notes.match(/1717[_.]?(\d+)[._]\s*(\d+)/);
    let docNumber = null;
    if (match) {
      docNumber = `1717.${match[2]}`;
    } else {
      // Try simpler pattern: name_NNN.ext → NNN is the offer number
      const simpleMatch = notes.match(/_(\d{2,4})(?:\.\w+)?$/);
      if (simpleMatch) docNumber = simpleMatch[1];
    }

    // Try to find matching project or client
    let projectId = null;
    if (doc.counterpartyId) {
      // Find project linked to this counterparty/client
      const clients = await prisma.client.findMany({
        where: { name: { contains: normalize(doc.counterparty?.name || ''), mode: 'insensitive' } },
        take: 3,
      });
      for (const client of clients) {
        const project = await prisma.project.findFirst({
          where: { clientId: client.id },
          orderBy: { createdAt: 'desc' },
        });
        if (project) { projectId = project.id; break; }
      }
    }

    await prisma.bizDocument.update({
      where: { id: doc.id },
      data: {
        docNumber: docNumber || doc.docNumber,
        status: 'IMPORTED',
        projectId: projectId || doc.projectId,
      },
    });
    updated++;

    // Create link to project if found
    if (projectId && doc.id) {
      const alreadyLinked = await prisma.reconciliationLink.findFirst({
        where: { sourceDocId: doc.id },
      });
      if (!alreadyLinked) {
        await prisma.reconciliationLink.create({
          data: {
            sourceDocId: doc.id,
            linkType: 'DOCUMENT_TO_SOURCE',
            confidence: 0.7,
            notes: `OFFER_OUT linked to project via counterparty`,
          },
        });
        linked++;
      }
    }

    console.log(`  ✅ OFFER_OUT ${docNumber || '(no number)'} → ${doc.counterparty?.name || 'unknown'}`);
  }

  console.log(`[1] Updated ${updated} offers, created ${linked} project links`);
}

// ─── Step 2: AI classify INVOICE_IN ──────────────────────────────────────────

async function classifyWithAI(doc) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `You are classifying a document for Studio Botema, a Bulgarian interior design company.

Document info:
- Type (current): ${doc.docType}
- Notes/filename: ${doc.notes || 'none'}
- Counterparty: ${doc.counterparty?.name || 'unknown'}
- Currency: ${doc.currency}

Based on the notes/filename alone, determine:
1. Is this a REAL BUSINESS DOCUMENT (invoice, delivery note, order confirmation) or a NON-DOCUMENT (price list, catalog, brochure, email conversation, guide, exhibition info)?
2. What is the correct document type?
3. Extract doc number if present in the filename

Return ONLY JSON:
{
  "isRealDocument": true/false,
  "correctType": "INVOICE_IN" | "OFFER_IN" | "DELIVERY_NOTE" | "OTHER" | "REJECT",
  "docNumber": string or null,
  "reason": "brief explanation in English"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota')) {
      console.log('    ⏳ Rate limit, waiting 65s...');
      await new Promise(r => setTimeout(r, 65000));
      return classifyWithAI(doc); // retry
    }
    console.warn('    ⚠️ AI error:', err.message?.substring(0, 80));
    return null;
  }
}

async function processInvoiceIN() {
  console.log('\n[2] Processing INVOICE_IN — AI classification...');
  const docs = await prisma.bizDocument.findMany({
    where: { status: 'NEEDS_REVIEW', docType: 'INVOICE_IN' },
    include: { counterparty: true },
  });

  let realCount = 0;
  let rejectedCount = 0;

  for (const doc of docs) {
    const notes = doc.notes || '';

    // Quick rule-based check first (no API call needed)
    const lowerNotes = notes.toLowerCase();
    const isPriceList = lowerNotes.includes('price list') || lowerNotes.includes('ценова листа') ||
      lowerNotes.includes('brochure') || lowerNotes.includes('catalogue') ||
      lowerNotes.includes('catalog') || lowerNotes.includes('promo') ||
      lowerNotes.includes('exhibition') || lowerNotes.includes('admin guide') ||
      lowerNotes.includes('profile_f2') || lowerNotes.includes('conditions_sheet') ||
      lowerNotes.includes('random family') || lowerNotes.includes('sales conditions') ||
      lowerNotes.includes('lighting designer friend') || lowerNotes.includes('inquiry about');

    if (isPriceList) {
      await prisma.bizDocument.update({
        where: { id: doc.id },
        data: { status: 'REJECTED', docType: 'OTHER', notes: doc.notes + ' [auto-rejected: price list/catalog]' },
      });
      rejectedCount++;
      console.log(`  ❌ REJECTED (price list): ${notes.substring(0, 60)}`);
      continue;
    }

    // For real invoices - try AI classification
    const aiResult = await classifyWithAI(doc);
    if (!aiResult) {
      // Fallback: keep as NEEDS_REVIEW
      continue;
    }

    if (!aiResult.isRealDocument || aiResult.correctType === 'REJECT') {
      await prisma.bizDocument.update({
        where: { id: doc.id },
        data: { status: 'REJECTED', docType: 'OTHER' },
      });
      rejectedCount++;
      console.log(`  ❌ AI REJECTED: ${notes.substring(0, 60)} — ${aiResult.reason}`);
    } else {
      await prisma.bizDocument.update({
        where: { id: doc.id },
        data: {
          status: 'IMPORTED',
          docType: aiResult.correctType !== 'REJECT' ? aiResult.correctType : doc.docType,
          docNumber: aiResult.docNumber || doc.docNumber,
        },
      });
      realCount++;
      console.log(`  ✅ REAL (${aiResult.correctType}): ${notes.substring(0, 60)}`);
    }

    // Small delay between AI calls
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[2] ${realCount} real invoices imported, ${rejectedCount} rejected`);
}

// ─── Step 3: Process DELIVERY_NOTE (СИЛТЕМ emails) ────────────────────────────

async function processDeliveryNotes() {
  console.log('\n[3] Processing DELIVERY_NOTE...');
  const docs = await prisma.bizDocument.findMany({
    where: { status: 'NEEDS_REVIEW', docType: 'DELIVERY_NOTE' },
    include: { counterparty: true },
  });

  let updated = 0;
  for (const doc of docs) {
    const notes = doc.notes || '';
    // These are СИЛТЕМ ЕООД stock issuance emails - internal records
    const isSiltem = notes.toLowerCase().includes('силтем') || notes.toLowerCase().includes('siltem');

    await prisma.bizDocument.update({
      where: { id: doc.id },
      data: {
        status: 'IMPORTED',
        notes: doc.notes + (isSiltem ? ' [СИЛТЕМ stock issuance]' : ''),
      },
    });
    updated++;
    console.log(`  ✅ DELIVERY_NOTE: ${notes.substring(0, 70)}`);
  }
  console.log(`[3] Updated ${updated} delivery notes`);
}

// ─── Step 4: Process remaining (PROTOCOL, BANK_STATEMENT, INVOICE_OUT) ───────

async function processOthers() {
  console.log('\n[4] Processing remaining NEEDS_REVIEW...');
  const docs = await prisma.bizDocument.findMany({
    where: {
      status: 'NEEDS_REVIEW',
      docType: { in: ['PROTOCOL', 'BANK_STATEMENT', 'INVOICE_OUT'] },
    },
  });

  for (const doc of docs) {
    await prisma.bizDocument.update({
      where: { id: doc.id },
      data: { status: 'IMPORTED' },
    });
    console.log(`  ✅ ${doc.docType}: ${(doc.notes || doc.docNumber || '').substring(0, 60)}`);
  }
  console.log(`[4] Updated ${docs.length} other docs`);
}

// ─── Step 5: Link newly IMPORTED INVOICE_IN to Purchases ─────────────────────

async function linkImportedInvoices() {
  console.log('\n[5] Linking newly IMPORTED INVOICE_IN to Purchases...');

  const docs = await prisma.bizDocument.findMany({
    where: { status: 'IMPORTED', docType: 'INVOICE_IN' },
    include: { counterparty: true },
  });

  // Only process ones without existing links
  const unlinked = [];
  for (const doc of docs) {
    const hasLink = await prisma.reconciliationLink.findFirst({ where: { sourceDocId: doc.id } });
    if (!hasLink && doc.counterpartyId) unlinked.push(doc);
  }

  console.log(`  Found ${unlinked.length} unlinked INVOICE_IN docs with counterparty`);

  const purchases = await prisma.purchase.findMany({
    include: { supplier: true },
  });

  let linked = 0;
  for (const doc of unlinked) {
    if (!doc.counterparty) continue;

    const candidates = purchases.filter(p => {
      if (!p.supplier) return false;
      const sim = similarity(doc.counterparty.name, p.supplier.name);
      if (sim < 0.6) return false;
      if (!doc.amountTotal) return sim >= 0.8; // name match only if no amount
      const docAmt = parseFloat(doc.amountTotal.toString());
      const pAmt = parseFloat(p.totalAmount?.toString() || p.amount?.toString() || '0');
      return Math.abs(docAmt - pAmt) / Math.max(docAmt, pAmt, 1) <= 0.04;
    });

    if (candidates.length === 1) {
      const already = await linkExists(doc.id, candidates[0].id);
      if (!already) {
        // Cannot link BizDoc directly to Purchase via ReconciliationLink (schema only links BizDoc↔BizDoc or BizDoc↔Payment)
        // So just mark as MATCHED
        await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
        linked++;
        console.log(`  ✅ MATCHED: ${doc.counterparty.name} → ${candidates[0].supplier?.name}`);
      }
    }
  }

  console.log(`[5] Matched ${linked} INVOICE_IN docs`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('AI Processing of NEEDS_REVIEW BizDocs');
  console.log('═══════════════════════════════════════');

  const before = await prisma.bizDocument.groupBy({ by: ['status'], _count: true });
  console.log('\nBefore:');
  before.forEach(r => console.log(`  ${r.status}: ${r._count}`));

  await processOffers();
  await processInvoiceIN();
  await processDeliveryNotes();
  await processOthers();
  await linkImportedInvoices();

  const after = await prisma.bizDocument.groupBy({ by: ['status'], _count: true });
  const totalLinks = await prisma.reconciliationLink.count();

  console.log('\n═══════════════════════════════════════');
  console.log('After:');
  after.forEach(r => console.log(`  ${r.status}: ${r._count}`));
  console.log(`Total ReconciliationLinks: ${totalLinks}`);
  console.log('═══════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
