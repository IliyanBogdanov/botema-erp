/**
 * Auto-match Payments ↔ BizDocuments only (steps 1-3 already done).
 * Run: node run-automatch.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function log(msg) { console.log(new Date().toISOString().slice(11,19), msg); }

function amountsMatch(a, b, tolerance = 0.005) {
  if (!a || !b) return false;
  const diff = Math.abs(a - b);
  const avg = (Math.abs(a) + Math.abs(b)) / 2;
  return avg < 0.01 || diff / avg <= tolerance;
}

function extractInvoiceNumbers(text) {
  if (!text) return [];
  return (text.match(/\d{4,}/g) || []).filter(n => n.length >= 4);
}

async function main() {
  log('=== AUTO-MATCH: Payment ↔ BizDocument ===');

  const payments = await prisma.payment.findMany({
    where: { status: { in: ['UNMATCHED', 'PARTIAL'] } },
    include: { counterparty: { select: { id: true, name: true } } },
    orderBy: { paymentDate: 'desc' },
  });
  log(`Processing ${payments.length} unmatched payments`);

  const docs = await prisma.bizDocument.findMany({
    where: { status: { in: ['IMPORTED', 'NEW', 'NEEDS_REVIEW'] } },
    select: { id: true, docNumber: true, docDate: true, amountTotal: true, currency: true, counterpartyId: true, status: true },
  });
  log(`Available BizDocuments: ${docs.length}`);

  let matched = 0, partial = 0, unmatched = 0;

  for (const payment of payments) {
    const windowStart = new Date(payment.paymentDate);
    windowStart.setDate(windowStart.getDate() - 45);
    const windowEnd = new Date(payment.paymentDate);
    windowEnd.setDate(windowEnd.getDate() + 5);

    let bestMatch = null;
    let confidence = 0;

    // Step 1: invoice number in notes
    const invoiceNums = extractInvoiceNumbers(payment.notes || '');
    if (invoiceNums.length > 0) {
      const byNumber = docs.find(d =>
        d.docNumber && invoiceNums.some(n => d.docNumber.includes(n))
      );
      if (byNumber) { bestMatch = byNumber; confidence = 0.95; }
    }

    // Step 2: counterparty + amount + date window
    if (!bestMatch && payment.counterpartyId) {
      const candidates = docs.filter(d =>
        d.counterpartyId === payment.counterpartyId &&
        d.currency === payment.currency &&
        d.docDate >= windowStart && d.docDate <= windowEnd &&
        amountsMatch(Number(payment.amount), Number(d.amountTotal))
      );
      if (candidates.length === 1) { bestMatch = candidates[0]; confidence = 0.85; }
    }

    // Step 3: exact amount + currency + date (unique in window)
    if (!bestMatch) {
      const candidates = docs.filter(d =>
        d.currency === payment.currency &&
        d.docDate >= windowStart && d.docDate <= windowEnd &&
        amountsMatch(Number(payment.amount), Number(d.amountTotal), 0.002)
      );
      if (candidates.length === 1) { bestMatch = candidates[0]; confidence = 0.6; }
    }

    if (bestMatch) {
      const newStatus = confidence >= 0.8 ? 'MATCHED' : 'PARTIAL';

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: newStatus },
      });

      const existingLink = await prisma.reconciliationLink.findFirst({
        where: { paymentId: payment.id, targetDocId: bestMatch.id },
        select: { id: true },
      });
      if (!existingLink) {
        await prisma.reconciliationLink.create({
          data: {
            linkType: 'PAYMENT_TO_INVOICE',
            paymentId: payment.id,
            targetDocId: bestMatch.id,
            confidence: confidence,
          },
        });
      }

      if (newStatus === 'MATCHED') matched++;
      else partial++;
    } else {
      unmatched++;
    }
  }

  log('');
  log('=== РЕЗУЛТАТ ===');
  log(`MATCHED:   ${matched}`);
  log(`PARTIAL:   ${partial}`);
  log(`UNMATCHED: ${unmatched}`);
  log(`TOTAL:     ${payments.length}`);
  log(`Match rate: ${Math.round(((matched + partial) / payments.length) * 100)}%`);

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
