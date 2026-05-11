const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const EUR_RATE = 1.95583;

function toBgn(amount, currency) {
  return currency === 'EUR' ? amount * EUR_RATE : amount;
}

async function main() {
  // Get all CPs that have both unlinked INVOICE_OUT and unmatched payments
  const unlinkedInvCps = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_OUT', linkedTo: { none: {} }, amountTotal: { gt: 0 } },
    select: { counterpartyId: true }, distinct: ['counterpartyId']
  });
  const invCpIds = unlinkedInvCps.map(d => d.counterpartyId).filter(Boolean);

  const overlapCps = await prisma.payment.findMany({
    where: { counterpartyId: { in: invCpIds }, reconciliationLinks: { none: {} }, amount: { gt: 1 } },
    select: { counterpartyId: true }, distinct: ['counterpartyId']
  });

  console.log(`Overlapping CPs: ${overlapCps.length}`);

  let totalLinksCreated = 0;

  for (const { counterpartyId } of overlapCps) {
    const cpName = (await prisma.counterparty.findUnique({ where: { id: counterpartyId }, select: { name: true } }))?.name;

    // Get all unlinked invoices for this CP (sorted by date)
    const invoices = await prisma.bizDocument.findMany({
      where: { docType: 'INVOICE_OUT', counterpartyId, linkedTo: { none: {} }, amountTotal: { gt: 0 } },
      orderBy: { docDate: 'asc' }
    });

    // Get all unmatched payments for this CP (sorted by date)
    const payments = await prisma.payment.findMany({
      where: { counterpartyId, reconciliationLinks: { none: {} }, amount: { gt: 1 } },
      orderBy: { paymentDate: 'asc' }
    });

    const invTotalBgn = invoices.reduce((s, i) => s + toBgn(Number(i.amountTotal)||0, i.currency), 0);
    const payTotalBgn = payments.reduce((s, p) => s + toBgn(Number(p.amount)||0, p.currency), 0);

    console.log(`\n${cpName}:`);
    console.log(`  Invoices: ${invoices.map(i => `#${i.docNumber}=${i.amountTotal}${i.currency}`).join(', ')}`);
    console.log(`  Payments: ${payments.map(p => `${p.amount}${p.currency}@${p.paymentDate?.toISOString().split('T')[0]}`).join(', ')}`);
    console.log(`  Total inv: ${invTotalBgn.toFixed(2)} BGN, Total pay: ${payTotalBgn.toFixed(2)} BGN`);

    // Link each payment to the earliest unlinked invoice
    // Use chronological assignment
    let remainingInvoices = invoices.map(i => ({ ...i, remainingBgn: toBgn(i.amountTotal, i.currency) }));

    for (const pay of payments) {
      const payAmtBgn = toBgn(pay.amount, pay.currency);
      let remainingPay = payAmtBgn;

      for (const inv of remainingInvoices) {
        if (inv.remainingBgn <= 0) continue;
        if (remainingPay <= 0) break;

        const linkAmt = Math.min(remainingPay, inv.remainingBgn);
        const linkAmtInPayCurrency = pay.currency === 'EUR' ? Math.round(linkAmt / EUR_RATE * 100) / 100 : linkAmt;

        // Only link if payment is within 180 days AFTER invoice date
        const invDate = inv.docDate ? new Date(inv.docDate) : new Date(0);
        const payDate = pay.paymentDate ? new Date(pay.paymentDate) : new Date();
        const daysDiff = (payDate - invDate) / 86400000;

        if (daysDiff > -90 && daysDiff < 365) {
          await prisma.reconciliationLink.create({
            data: {
              paymentId: pay.id,
              targetDocId: inv.id,
              linkType: 'PAYMENT_TO_INVOICE',
              amountLinked: linkAmtInPayCurrency,
              confidence: 0.7
            }
          });
          totalLinksCreated++;
          inv.remainingBgn -= linkAmt;
          remainingPay -= linkAmt;
          console.log(`    → Linked ${linkAmtInPayCurrency}${pay.currency} from ${pay.paymentDate?.toISOString().split('T')[0]} to #${inv.docNumber}`);
        }
      }

      // Mark payment status
      if (remainingPay < payAmtBgn * 0.1) {
        await prisma.payment.update({ where: { id: pay.id }, data: { status: 'MATCHED' } });
      } else if (remainingPay < payAmtBgn) {
        await prisma.payment.update({ where: { id: pay.id }, data: { status: 'PARTIAL' } });
      }
    }

    // Mark invoices PAID if remaining <= 0
    for (const inv of remainingInvoices) {
      if (inv.remainingBgn <= 0.01 * toBgn(inv.amountTotal, inv.currency)) {
        await prisma.bizDocument.update({ where: { id: inv.id }, data: { status: 'PAID' } });
      }
    }
  }

  console.log(`\nTotal new ReconciliationLinks: ${totalLinksCreated}`);
  const totalLinks = await prisma.reconciliationLink.count();
  const totalUnmatched = await prisma.payment.count({ where: { reconciliationLinks: { none: {} }, amount: { gt: 1 } } });
  console.log(`Grand total links: ${totalLinks}`);
  console.log(`Remaining unmatched: ${totalUnmatched}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
