/**
 * linkAllBizDocs.js — Full BizDocument association pass
 * 1. Mark NEW BizDocs with extracted data → IMPORTED
 * 2. Link INVOICE_IN → Purchase (same counterparty + amount ±3%)
 * 3. Link INVOICE_OUT → Invoice (docNumber match)
 * 4. Link OFFER_OUT → Project (counterparty name match)
 * 5. Link DELIVERY_NOTE → Purchase (same counterparty + close date)
 * 6. Create ReconciliationLinks for DOCUMENT_TO_SOURCE
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EUR_BGN = 1.95583;

function toBGN(amount, currency) {
  const a = parseFloat(amount) || 0;
  return currency === 'EUR' ? a * EUR_BGN : a;
}

function amountMatch(a, b, tol = 0.04) {
  if (!a || !b || a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}

function normalize(name = '') {
  return name.toLowerCase()
    .replace(/еоод|оод|ад|ет|ltd|llc|gmbh|inc\b/gi, '')
    .replace(/[.,\-"'—()\s]+/g, ' ').trim();
}

function nameSim(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const common = [...wa].filter(w => wb.has(w)).length;
  const total = new Set([...wa, ...wb]).size;
  return total > 0 ? common / total : 0;
}

async function linkExists(docId) {
  const existing = await prisma.reconciliationLink.findFirst({
    where: { OR: [{ sourceDocId: docId }, { targetDocId: docId }] }
  });
  return !!existing;
}

// ── Step 1: Mark NEW → IMPORTED if has docNumber ─────────────────────────────
async function markImported() {
  const res = await prisma.bizDocument.updateMany({
    where: { status: 'NEW', docNumber: { not: null } },
    data: { status: 'IMPORTED' }
  });
  console.log(`\n[1] Marked IMPORTED (had docNumber): ${res.count}`);

  // Mark remaining NEW with no docNumber as NEEDS_REVIEW
  const res2 = await prisma.bizDocument.updateMany({
    where: { status: 'NEW', docNumber: null },
    data: { status: 'NEEDS_REVIEW' }
  });
  console.log(`[1] Marked NEEDS_REVIEW (no docNumber): ${res2.count}`);
}

// ── Step 2: INVOICE_IN → Purchase ────────────────────────────────────────────
async function linkInvoiceInToPurchase() {
  const invoiceIns = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { in: ['IMPORTED', 'NEEDS_REVIEW'] }, counterpartyId: { not: null } },
    include: { counterparty: { select: { name: true } } }
  });

  const purchases = await prisma.purchase.findMany({
    include: { supplier: { select: { name: true } } }
  });

  let linked = 0;
  for (const doc of invoiceIns) {
    if (await linkExists(doc.id)) continue;
    const docBGN = toBGN(doc.amountTotal, doc.currency);
    if (!docBGN) continue;

    // Find purchase by same supplier (name match) + amount ±4%
    let best = null, bestSim = 0;
    for (const pur of purchases) {
      if (!pur.amount) continue;
      const purBGN = toBGN(pur.amount, pur.currency);
      if (!amountMatch(docBGN, purBGN)) continue;
      const sim = nameSim(doc.counterparty?.name, pur.supplier?.name);
      if (sim >= 0.7 && sim > bestSim) { best = pur; bestSim = sim; }
    }

    if (best) {
      await prisma.reconciliationLink.create({
        data: {
          targetDocId: doc.id,
          linkType: 'DOCUMENT_TO_SOURCE',
          confidence: Math.min(bestSim, 0.9),
          notes: `auto: INVOICE_IN #${doc.docNumber} ↔ Purchase ${best.id} (${best.supplier?.name})`,
        }
      });
      await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
      // Mark purchase as linked
      purchases.splice(purchases.indexOf(best), 1);
      console.log(`  ✅ INVOICE_IN #${doc.docNumber} ${doc.amountTotal}${doc.currency} → Purchase [${best.supplier?.name?.substring(0,25)}]`);
      linked++;
    }
  }
  console.log(`\n[2] INVOICE_IN linked to Purchase: ${linked}`);
  return linked;
}

// ── Step 3: INVOICE_OUT BizDoc → Invoice ─────────────────────────────────────
async function linkInvoiceOutToInvoice() {
  const invoiceOuts = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_OUT', docNumber: { not: null }, status: { not: 'MATCHED' } }
  });

  const invoices = await prisma.invoice.findMany({
    select: { id: true, number: true, amountTotal: true, currency: true, client: { select: { name: true } } }
  });

  // Build invoice number map
  const invByNumber = {};
  for (const inv of invoices) invByNumber[inv.number] = inv;

  let linked = 0;
  for (const doc of invoiceOuts) {
    if (await linkExists(doc.id)) continue;
    // Try exact number match
    const inv = invByNumber[doc.docNumber];
    if (inv) {
      await prisma.reconciliationLink.create({
        data: {
          sourceDocId: doc.id,
          linkType: 'DOCUMENT_TO_SOURCE',
          confidence: 1.0,
          notes: `auto: INVOICE_OUT BizDoc #${doc.docNumber} ↔ Invoice #${inv.number}`,
        }
      });
      await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
      console.log(`  ✅ INVOICE_OUT #${doc.docNumber} ↔ Invoice #${inv.number} [${inv.client?.name?.substring(0,25)}]`);
      linked++;
    }
  }
  console.log(`\n[3] INVOICE_OUT matched to Invoice: ${linked}`);
  return linked;
}

// ── Step 4: OFFER_OUT → Project ──────────────────────────────────────────────
async function linkOfferToProject() {
  const offers = await prisma.bizDocument.findMany({
    where: { docType: 'OFFER_OUT', counterpartyId: { not: null } },
    include: { counterparty: { select: { name: true } } }
  });

  const projects = await prisma.project.findMany({
    include: { client: { select: { name: true } } }
  });

  let linked = 0;
  for (const offer of offers) {
    if (await linkExists(offer.id)) continue;
    let best = null, bestSim = 0;
    for (const proj of projects) {
      const sim = nameSim(offer.counterparty?.name, proj.client?.name);
      if (sim >= 0.75 && sim > bestSim) { best = proj; bestSim = sim; }
    }
    if (best) {
      await prisma.reconciliationLink.create({
        data: {
          sourceDocId: offer.id,
          linkType: 'DOCUMENT_TO_SOURCE',
          confidence: bestSim,
          notes: `auto: OFFER_OUT #${offer.docNumber} ↔ Project ${best.code||best.id} [${best.client?.name?.substring(0,20)}]`,
        }
      });
      await prisma.bizDocument.update({ where: { id: offer.id }, data: { status: 'MATCHED' } });
      linked++;
    }
  }
  console.log(`\n[4] OFFER_OUT linked to Project: ${linked}`);
  return linked;
}

// ── Step 5: DELIVERY_NOTE → Purchase ─────────────────────────────────────────
async function linkDeliveryToPurchase() {
  const deliveries = await prisma.bizDocument.findMany({
    where: { docType: 'DELIVERY_NOTE', counterpartyId: { not: null } },
    include: { counterparty: { select: { name: true } } }
  });

  const purchases = await prisma.purchase.findMany({
    include: { supplier: { select: { name: true } } }
  });

  let linked = 0;
  for (const del of deliveries) {
    if (await linkExists(del.id)) continue;
    let best = null, bestSim = 0;
    for (const pur of purchases) {
      const sim = nameSim(del.counterparty?.name, pur.supplier?.name);
      // Also check date proximity
      const delDate = del.docDate ? new Date(del.docDate) : null;
      const purDate = pur.date ? new Date(pur.date) : null;
      const daysDiff = delDate && purDate ? Math.abs((delDate - purDate) / 86400000) : 999;
      if (sim >= 0.75 && daysDiff <= 60 && sim > bestSim) { best = pur; bestSim = sim; }
    }
    if (best) {
      await prisma.reconciliationLink.create({
        data: {
          sourceDocId: del.id,
          linkType: 'INVOICE_TO_DELIVERY',
          confidence: bestSim,
          notes: `auto: DELIVERY_NOTE #${del.docNumber} ↔ Purchase ${best.id}`,
        }
      });
      await prisma.bizDocument.update({ where: { id: del.id }, data: { status: 'MATCHED' } });
      purchases.splice(purchases.indexOf(best), 1);
      linked++;
    }
  }
  console.log(`\n[5] DELIVERY_NOTE linked to Purchase: ${linked}`);
  return linked;
}

async function main() {
  await markImported();

  const [l2, l3, l4, l5] = await Promise.all([
    linkInvoiceInToPurchase(),
    linkInvoiceOutToInvoice(),
    linkOfferToProject(),
    linkDeliveryToPurchase(),
  ]);

  const [totalLinks, bizMatched, bizImported, bizNeedsReview] = await Promise.all([
    prisma.reconciliationLink.count(),
    prisma.bizDocument.count({ where: { status: 'MATCHED' } }),
    prisma.bizDocument.count({ where: { status: 'IMPORTED' } }),
    prisma.bizDocument.count({ where: { status: 'NEEDS_REVIEW' } }),
  ]);

  console.log('\n═══════════════════════════════════════');
  console.log('New links created:', l2 + l3 + l4 + l5);
  console.log('Total ReconciliationLinks:', totalLinks);
  console.log('BizDocs MATCHED:', bizMatched);
  console.log('BizDocs IMPORTED:', bizImported);
  console.log('BizDocs NEEDS_REVIEW:', bizNeedsReview);
}

main().catch(console.error).finally(() => prisma.$disconnect());
