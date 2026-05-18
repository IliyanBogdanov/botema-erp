require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const NOTE = 'auto-flag: invoice document is missing number or usable amount';

function appendNote(existing) {
  if ((existing || '').includes(NOTE)) return existing || NOTE;
  return existing ? `${existing} | ${NOTE}` : NOTE;
}

async function main() {
  console.log(`=== FLAG INCOMPLETE INVOICE BIZDOCS${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);
  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT'] },
      status: { in: ['IMPORTED', 'REVIEWED', 'NEW'] },
      OR: [
        { docNumber: null },
        { amountTotal: null },
        { amountTotal: 0 },
      ],
    },
    select: { id: true, docType: true, docNumber: true, amountTotal: true, status: true, notes: true },
  });

  const grouped = {};
  for (const doc of docs) {
    const key = `${doc.docType}:${doc.status}`;
    grouped[key] = (grouped[key] || 0) + 1;
  }
  console.table(Object.entries(grouped).map(([bucket, count]) => ({ bucket, count })));

  if (!APPLY) {
    console.log({ wouldFlag: docs.length });
    return;
  }

  for (const doc of docs) {
    await prisma.bizDocument.update({
      where: { id: doc.id },
      data: { status: 'NEEDS_REVIEW', notes: appendNote(doc.notes) },
    });
  }

  console.log({ flagged: docs.length });
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
