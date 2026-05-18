require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const {
  getLastIssuedOutgoingInvoiceNo,
  isBeyondLastIssuedOutgoingInvoice,
} = require('../src/lib/outgoingInvoicePolicy');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const REASON = 'auto-quarantine: outgoing invoice number is beyond confirmed last issued invoice';

function appendNote(existing) {
  const note = `${REASON} #${getLastIssuedOutgoingInvoiceNo()}`;
  if ((existing || '').includes(note)) return existing || note;
  return existing ? `${existing} | ${note}` : note;
}

async function main() {
  const lastIssued = getLastIssuedOutgoingInvoiceNo();
  console.log(`=== QUARANTINE OUTGOING INVOICES > ${lastIssued}${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);

  const invoices = (await prisma.invoice.findMany({
    select: { id: true, number: true, status: true, notes: true },
  })).filter(i => isBeyondLastIssuedOutgoingInvoice(i.number, lastIssued));

  const bizDocs = (await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_OUT' },
    select: { id: true, docNumber: true, status: true, notes: true },
  })).filter(d => isBeyondLastIssuedOutgoingInvoice(d.docNumber, lastIssued));

  const docIds = bizDocs.map(d => d.id);
  const links = docIds.length ? await prisma.reconciliationLink.findMany({
    where: { OR: [{ sourceDocId: { in: docIds } }, { targetDocId: { in: docIds } }] },
    select: { id: true, paymentId: true, linkType: true },
  }) : [];

  const paymentIds = [...new Set(links.map(l => l.paymentId).filter(Boolean))];
  console.table({
    invoiceRows: invoices.length,
    bizDocumentRows: bizDocs.length,
    linksToRemove: links.length,
    affectedPayments: paymentIds.length,
  });

  if (!APPLY) return;

  await prisma.$transaction(async tx => {
    if (links.length) {
      await tx.reconciliationLink.deleteMany({ where: { id: { in: links.map(l => l.id) } } });
    }

    for (const inv of invoices) {
      await tx.invoice.update({
        where: { id: inv.id },
        data: { status: 'CANCELLED', notes: appendNote(inv.notes) },
      });
    }

    for (const doc of bizDocs) {
      await tx.bizDocument.update({
        where: { id: doc.id },
        data: { status: 'REJECTED', notes: appendNote(doc.notes) },
      });
    }

    for (const paymentId of paymentIds) {
      const remaining = await tx.reconciliationLink.count({ where: { paymentId } });
      if (remaining === 0) {
        await tx.payment.update({ where: { id: paymentId }, data: { status: 'UNMATCHED' } });
      }
    }
  });

  console.log('Applied quarantine.');
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
