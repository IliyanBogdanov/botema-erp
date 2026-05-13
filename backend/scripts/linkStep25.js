// Re-run only INVOICE_IN → Purchase and DELIVERY_NOTE → Purchase (steps 2 & 5)
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const EUR_BGN = 1.95583;

function toBGN(amount, currency) {
  const a = parseFloat(amount) || 0;
  return currency === 'EUR' ? a * EUR_BGN : a;
}
function amountMatch(a, b, tol = 0.04) {
  if (!a || !b) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}
function normalize(name = '') {
  return name.toLowerCase().replace(/еоод|оод|ад|ет|ltd|llc|gmbh|inc\b/gi, '').replace(/[.,\-"'—()\s]+/g, ' ').trim();
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
  const e = await prisma.reconciliationLink.findFirst({ where: { OR: [{ sourceDocId: docId }, { targetDocId: docId }] } });
  return !!e;
}

async function main() {
  const purchases = await prisma.purchase.findMany({ include: { supplier: { select: { name: true } } } });

  // Step 2: INVOICE_IN → Purchase
  const invoiceIns = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', counterpartyId: { not: null }, amountTotal: { not: null } },
    include: { counterparty: { select: { name: true } } }
  });
  let linked2 = 0;
  const usedPurchases = new Set();
  for (const doc of invoiceIns) {
    if (await linkExists(doc.id)) continue;
    const docBGN = toBGN(doc.amountTotal, doc.currency);
    if (!docBGN) continue;
    let best = null, bestSim = 0;
    for (const pur of purchases) {
      if (usedPurchases.has(pur.id)) continue;
      const purBGN = toBGN(pur.amount, pur.currency);
      if (!amountMatch(docBGN, purBGN)) continue;
      const sim = nameSim(doc.counterparty?.name, pur.supplier?.name);
      if (sim >= 0.7 && sim > bestSim) { best = pur; bestSim = sim; }
    }
    if (best) {
      await prisma.reconciliationLink.create({
        data: { targetDocId: doc.id, linkType: 'DOCUMENT_TO_SOURCE', confidence: Math.min(bestSim, 0.9),
          notes: `auto: INVOICE_IN #${doc.docNumber} ↔ Purchase [${best.supplier?.name}]` }
      });
      await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
      usedPurchases.add(best.id);
      console.log(`  ✅ INVOICE_IN #${doc.docNumber} ${doc.amountTotal}${doc.currency} → [${best.supplier?.name?.substring(0,25)}]`);
      linked2++;
    }
  }
  console.log(`[2] INVOICE_IN → Purchase: ${linked2}`);

  // Step 5: DELIVERY_NOTE → Purchase
  const deliveries = await prisma.bizDocument.findMany({
    where: { docType: 'DELIVERY_NOTE', counterpartyId: { not: null } },
    include: { counterparty: { select: { name: true } } }
  });
  let linked5 = 0;
  for (const del of deliveries) {
    if (await linkExists(del.id)) continue;
    let best = null, bestSim = 0;
    for (const pur of purchases) {
      if (usedPurchases.has(pur.id)) continue;
      const sim = nameSim(del.counterparty?.name, pur.supplier?.name);
      const delDate = del.docDate ? new Date(del.docDate) : null;
      const purDate = pur.date ? new Date(pur.date) : null;
      const daysDiff = delDate && purDate ? Math.abs((delDate - purDate) / 86400000) : 999;
      if (sim >= 0.75 && daysDiff <= 60 && sim > bestSim) { best = pur; bestSim = sim; }
    }
    if (best) {
      await prisma.reconciliationLink.create({
        data: { sourceDocId: del.id, linkType: 'INVOICE_TO_DELIVERY', confidence: bestSim,
          notes: `auto: DELIVERY_NOTE #${del.docNumber} ↔ Purchase [${best.supplier?.name}]` }
      });
      await prisma.bizDocument.update({ where: { id: del.id }, data: { status: 'MATCHED' } });
      usedPurchases.add(best.id);
      linked5++;
    }
  }
  console.log(`[5] DELIVERY_NOTE → Purchase: ${linked5}`);

  const [totalLinks, bizMatched, bizImported, bizNeedsReview, bizNew] = await Promise.all([
    prisma.reconciliationLink.count(),
    prisma.bizDocument.count({ where: { status: 'MATCHED' } }),
    prisma.bizDocument.count({ where: { status: 'IMPORTED' } }),
    prisma.bizDocument.count({ where: { status: 'NEEDS_REVIEW' } }),
    prisma.bizDocument.count({ where: { status: 'NEW' } }),
  ]);
  console.log('\n═══════════════════════════════════════');
  console.log('Total ReconciliationLinks:', totalLinks);
  console.log('BizDocs: NEW=' + bizNew, '| IMPORTED=' + bizImported, '| MATCHED=' + bizMatched, '| NEEDS_REVIEW=' + bizNeedsReview);
}
main().catch(console.error).finally(() => prisma.$disconnect());
