require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.bizDocument.findMany({
    where: { status: 'NEEDS_REVIEW' },
    include: { sourceFile: true, counterparty: true },
    take: 5,
  });
  docs.forEach(d => {
    const sf = d.sourceFile;
    console.log({
      id: d.id,
      type: d.docType,
      docNumber: d.docNumber,
      amount: d.amountTotal?.toString(),
      currency: d.currency,
      notes: (d.notes || '').substring(0, 150),
      counterparty: d.counterparty?.name || null,
      sourceFile: sf ? {
        driveFileId: sf.driveFileId,
        gmailMsgId: sf.gmailMsgId,
        filename: sf.filename,
        subject: sf.subject,
        fromEmail: sf.fromEmail,
      } : null,
    });
  });
  await prisma.$disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
