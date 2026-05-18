require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Покупки (purchases)
  const purchTotal = await p.purchase.count();
  const purchNoSupplier = await p.$queryRawUnsafe(`SELECT COUNT(*)::int cnt FROM purchases WHERE "supplierId" IS NULL OR "supplierId" = ''`);
  const purchSample = await p.purchase.findMany({ take: 3, orderBy: { date: 'desc' }, include: { supplier: { select: { name: true } } } });
  console.log('=== ПОКУПКИ ===', 'total:', purchTotal, '| no supplier:', purchNoSupplier[0].cnt);
  purchSample.forEach(p => console.log(' ', p.date?.toISOString().split('T')[0], p.supplier?.name||'NO-SUP', p.amount, p.currency));

  // Orders
  const ordTotal = await p.order.count();
  const ordNoProject = await p.order.count({ where: { projectId: null } });
  const ordByStatus = await p.$queryRawUnsafe(`SELECT status, COUNT(*)::int cnt FROM orders GROUP BY status ORDER BY cnt DESC`);
  console.log('\n=== ПОРЪЧКИ ===', 'total:', ordTotal, '| no project:', ordNoProject);
  ordByStatus.forEach(r => console.log(' ', r.status, r.cnt));

  // Проекти
  const projTotal = await p.project.count();
  const projOpen = await p.project.count({ where: { status: 'ACTIVE' } });
  console.log('\n=== ПРОЕКТИ ===', 'total:', projTotal, '| active:', projOpen);

  // Clients
  const clientTotal = await p.client.count();
  console.log('\n=== КЛИЕНТИ ===', 'total:', clientTotal);

  // Invoices check
  const invTotal = await p.invoice.count();
  const invByStatus = await p.$queryRawUnsafe(`SELECT status, COUNT(*)::int cnt FROM invoices GROUP BY status ORDER BY cnt DESC`);
  console.log('\n=== ФАКТУРИ ===', 'total:', invTotal);
  invByStatus.forEach(r => console.log(' ', r.status, r.cnt));

  // Inventory
  const invItems = await p.inventoryItem.count();
  console.log('\n=== СКЛАД ===', 'items:', invItems);

  // BizDocs NEW (неразгледани)
  const bizNew = await p.bizDocument.count({ where: { status: 'NEW' } });
  const bizNeedsReview = await p.bizDocument.count({ where: { status: 'NEEDS_REVIEW' } });
  console.log('\n=== BIZDOCS нуждаещи се от преглед ===');
  console.log('  NEW:', bizNew, '| NEEDS_REVIEW:', bizNeedsReview);

  // Reconciliation coverage
  const totalLinks = await p.reconciliationLink.count();
  const missingDocs = await p.missingDocument.count({ where: { status: 'OPEN' } });
  console.log('\n=== RECONCILIATION ===', 'links:', totalLinks, '| missing open:', missingDocs);
}

main().catch(console.error).finally(() => p.$disconnect());
