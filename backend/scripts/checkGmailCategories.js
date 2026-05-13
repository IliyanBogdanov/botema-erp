require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const stats = await p.gmailMessage.groupBy({ by: ['classifiedType', 'status'], _count: { id: true } });
  console.log('By category:', JSON.stringify(stats, null, 2));
  const invoices = await p.gmailMessage.findMany({
    where: { classifiedType: 'INVOICE_IN' },
    select: { messageId: true, subject: true, from: true, date: true, attachmentNames: true },
    take: 5
  });
  console.log('Sample INVOICE_IN:', JSON.stringify(invoices, null, 2));
}
main().catch(console.error).finally(() => p.$disconnect());
