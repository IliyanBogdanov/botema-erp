require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.bizDocument.findMany({
    where: { status: 'NEEDS_REVIEW' },
    include: { sourceFile: true, counterparty: true },
  });

  const byType = {};
  docs.forEach(d => {
    if (!byType[d.docType]) byType[d.docType] = [];
    byType[d.docType].push({
      id: d.id,
      docNumber: d.docNumber,
      amount: d.amountTotal ? d.amountTotal.toString() : null,
      currency: d.currency,
      notes: (d.notes || '').substring(0, 100),
      cp: d.counterparty ? d.counterparty.name : null,
      hasSF: !!d.sourceFile,
      driveId: d.sourceFile ? d.sourceFile.driveFileId : null,
      gmailId: d.sourceFile ? d.sourceFile.gmailMsgId : null,
      subject: d.sourceFile ? d.sourceFile.subject : null,
    });
  });

  for (const [type, arr] of Object.entries(byType)) {
    console.log('\n=== ' + type + ' (' + arr.length + ') ===');
    arr.forEach(x => console.log(JSON.stringify(x)));
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
