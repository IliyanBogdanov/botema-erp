/**
 * Gemini-powered reconciliation script.
 * Uses AI to match unmatched bank payments to BizDocuments.
 * Run: node run-gemini-reconcile.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function log(msg) { console.log(new Date().toISOString().slice(11, 19), msg); }

async function askGemini(prompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      log(`Gemini attempt ${attempt} failed: ${err.message?.slice(0, 100)}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}

function parseGeminiMatches(text) {
  // Try to extract JSON array from Gemini response
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    text.match(/(\[[\s\S]*\])/);
  if (!jsonMatch) return [];
  try {
    return JSON.parse(jsonMatch[1]);
  } catch {
    return [];
  }
}

async function main() {
  log('=== GEMINI RECONCILIATION ===');

  // 1. Load unmatched payments (BANK_TRANSFER + COD)
  const payments = await prisma.payment.findMany({
    where: { status: 'UNMATCHED', paymentType: { in: ['BANK_TRANSFER', 'COD'] } },
    include: { counterparty: { select: { name: true } } },
    orderBy: { paymentDate: 'desc' },
  });
  log(`Unmatched payments to process: ${payments.length}`);

  // 2. Load unlinked BizDocuments (invoices/proformas with amounts)
  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_IN', 'PROFORMA_OUT'] },
      amountTotal: { gt: 0 },
    },
    include: { counterparty: { select: { name: true } } },
    orderBy: { docDate: 'desc' },
  });
  log(`BizDocuments available for matching: ${docs.length}`);

  // 3. Process in batches of 15
  const BATCH_SIZE = 15;
  let totalMatched = 0, totalSkipped = 0, totalErrors = 0;

  for (let i = 0; i < payments.length; i += BATCH_SIZE) {
    const batch = payments.slice(i, i + BATCH_SIZE);
    log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(payments.length / BATCH_SIZE)} (${batch.length} payments)...`);

    const paymentList = batch.map(p => ({
      id: p.id,
      date: p.paymentDate?.toISOString().slice(0, 10),
      amount: Number(p.amount),
      currency: p.currency,
      notes: (p.notes || '').slice(0, 120),
      counterparty: p.counterparty?.name || null,
    }));

    // Find candidate docs for this batch (within ±90 days of any payment in batch)
    const batchDates = batch.map(p => new Date(p.paymentDate));
    const minDate = new Date(Math.min(...batchDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...batchDates.map(d => d.getTime())));
    minDate.setDate(minDate.getDate() - 90);
    maxDate.setDate(maxDate.getDate() + 90);

    const candidateDocs = docs.filter(d => {
      if (!d.docDate) return false;
      return d.docDate >= minDate && d.docDate <= maxDate;
    }).map(d => ({
      id: d.id,
      docNumber: d.docNumber,
      docType: d.docType,
      date: d.docDate?.toISOString().slice(0, 10),
      amount: Number(d.amountTotal),
      currency: d.currency,
      counterparty: d.counterparty?.name || null,
    }));

    if (candidateDocs.length === 0) {
      log(`  No candidate docs in date range, skipping batch`);
      totalSkipped += batch.length;
      continue;
    }

    const prompt = `You are a financial reconciliation expert for a Bulgarian interior design company.

Match each bank payment to the most likely BizDocument (invoice/proforma). 

Rules:
- Match by: invoice number in payment notes, amount similarity (±2%), counterparty name, date proximity
- "фактура номер XXXXXXXXX" in notes = invoice with that number (strip leading zeros: "0000000249" = "249")
- "проф." / "prof." / "проформа" = proforma invoice
- Speedy payments = delivery charges (COD or DHL), match by amount
- Only match if confidence > 0.7
- A BizDoc can only be matched once
- Return ONLY a JSON array, no explanation

BANK PAYMENTS (to match):
${JSON.stringify(paymentList, null, 2)}

AVAILABLE BIZDOCUMENTS:
${JSON.stringify(candidateDocs, null, 2)}

Return JSON array of matches:
[
  {
    "paymentId": "...",
    "docId": "...",
    "confidence": 0.95,
    "reason": "invoice number match"
  }
]

If no match found for a payment, omit it from the array.`;

    const response = await askGemini(prompt);
    if (!response) {
      log(`  Gemini failed for batch, skipping`);
      totalSkipped += batch.length;
      continue;
    }

    const matches = parseGeminiMatches(response);
    log(`  Gemini suggested ${matches.length} matches`);

    // Apply matches
    const usedDocIds = new Set();
    for (const match of matches) {
      if (!match.paymentId || !match.docId) continue;
      if (usedDocIds.has(match.docId)) {
        log(`  Skipping duplicate docId ${match.docId}`);
        continue;
      }
      const confidence = Number(match.confidence) || 0.75;
      if (confidence < 0.7) continue;

      try {
        const existingLink = await prisma.reconciliationLink.findFirst({
          where: { paymentId: match.paymentId, targetDocId: match.docId },
          select: { id: true },
        });

        const newStatus = confidence >= 0.85 ? 'MATCHED' : 'PARTIAL';
        await prisma.$transaction([
          existingLink
            ? prisma.reconciliationLink.update({
                where: { id: existingLink.id },
                data: { confidence, notes: `gemini: ${match.reason || ''}` },
              })
            : prisma.reconciliationLink.create({
                data: {
                  linkType: 'PAYMENT_TO_INVOICE',
                  confidence,
                  paymentId: match.paymentId,
                  targetDocId: match.docId,
                  notes: `gemini: ${match.reason || ''}`,
                },
              }),
          prisma.payment.update({
            where: { id: match.paymentId },
            data: { status: newStatus },
          }),
        ]);

        usedDocIds.add(match.docId);
        totalMatched++;
        log(`  ✓ Matched payment ${match.paymentId.slice(-6)} → doc ${match.docId.slice(-6)} (${confidence}) — ${match.reason}`);
      } catch (err) {
        log(`  ✗ Error applying match: ${err.message}`);
        totalErrors++;
      }
    }

    // Rate limit: wait between batches
    if (i + BATCH_SIZE < payments.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  log('');
  log('=== GEMINI RECONCILIATION RESULTS ===');
  log(`Matched:  ${totalMatched}`);
  log(`Skipped:  ${totalSkipped}`);
  log(`Errors:   ${totalErrors}`);

  // Final stats
  const [unmatched, matched, partial] = await Promise.all([
    prisma.payment.count({ where: { status: 'UNMATCHED' } }),
    prisma.payment.count({ where: { status: 'MATCHED' } }),
    prisma.payment.count({ where: { status: 'PARTIAL' } }),
  ]);
  const total = unmatched + matched + partial;
  log('');
  log('=== FINAL PAYMENT STATUS ===');
  log(`MATCHED:   ${matched}/${total} (${Math.round(matched/total*100)}%)`);
  log(`PARTIAL:   ${partial}/${total} (${Math.round(partial/total*100)}%)`);
  log(`UNMATCHED: ${unmatched}/${total} (${Math.round(unmatched/total*100)}%)`);

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
