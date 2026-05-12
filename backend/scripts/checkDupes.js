const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const dupInv = await p.$queryRawUnsafe(`SELECT number, COUNT(*) as cnt FROM invoices GROUP BY number HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 10`);
  console.log('Invoice duplicates:', dupInv);
  const payFields = await p.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_name='payments' LIMIT 10`);
  console.log('Payment fields:', payFields.map(f=>f.column_name));
  const dupBiz = await p.$queryRawUnsafe(`SELECT "docNumber", "docType", COUNT(*) as cnt FROM biz_documents WHERE "docNumber" IS NOT NULL GROUP BY "docNumber", "docType" HAVING COUNT(*) > 1 LIMIT 10`);
  console.log('BizDoc duplicates:', dupBiz);
  // Total counts
  const counts = await p.$queryRawUnsafe(`SELECT 
    (SELECT COUNT(*) FROM invoices) as invoices,
    (SELECT COUNT(*) FROM payments) as payments,
    (SELECT COUNT(*) FROM biz_documents) as biz_docs,
    (SELECT COUNT(*) FROM clients) as clients,
    (SELECT COUNT(*) FROM projects) as projects`);
  console.log('Counts:', counts[0]);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
