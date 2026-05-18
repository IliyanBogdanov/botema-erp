require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Expenses sample + duplicates
  const expenses = await p.expense.findMany({ orderBy: { date: 'desc' }, take: 8 });
  console.log('=== EXPENSES (last 8) ===');
  expenses.forEach(e => console.log(
    e.date?.toISOString().split('T')[0], e.category, e.amount+e.currency,
    'sup:', (e.supplier||'EMPTY'), '| desc:', (e.description||'EMPTY').substring(0,30)
  ));

  const expDups = await p.$queryRawUnsafe(`
    SELECT date::text, category, amount::text, currency, COUNT(*)::int as cnt 
    FROM expenses GROUP BY date, category, amount, currency HAVING COUNT(*) > 1 LIMIT 10
  `);
  console.log('\nEXPENSE DUPLICATES:', expDups.length);
  expDups.forEach(r => console.log(' ', r.date, r.category, r.amount, r.currency, 'x'+r.cnt));

  // BizDocs breakdown
  const bizTypes = await p.$queryRawUnsafe(`
    SELECT "docType", status, COUNT(*)::int as cnt 
    FROM biz_documents GROUP BY "docType", status ORDER BY "docType", status
  `);
  console.log('\n=== BIZDOCS by type+status ===');
  bizTypes.forEach(r => console.log(r.docType, r.status, r.cnt));

  // Missing data checks
  const [payNoCp, bizNoNum, purchNoSup, cpTotal] = await Promise.all([
    p.payment.count({ where: { counterpartyId: null, amount: { gt: 100 } } }),
    p.bizDocument.count({ where: { docNumber: null, docType: { in: ['INVOICE_IN','INVOICE_OUT'] } } }),
    p.$queryRawUnsafe(`SELECT COUNT(*)::int AS cnt FROM purchases WHERE "supplierId" IS NULL OR "supplierId" = ''`),
    p.counterparty.count(),
  ]);
  console.log('\n=== DATA QUALITY ===');
  console.log('Payments >100 without counterparty:', payNoCp);
  console.log('INVOICE BizDocs without docNumber:', bizNoNum);
  console.log('Purchases without supplier:', purchNoSup[0]?.cnt || 0);
  console.log('Counterparties total:', cpTotal);

  // Orders check
  const ordersTotal = await p.order.count();
  const ordersNoProject = await p.order.count({ where: { projectId: null } });
  console.log('\n=== ORDERS ===', 'total:', ordersTotal, '| no project:', ordersNoProject);
}

main().catch(console.error).finally(() => p.$disconnect());
