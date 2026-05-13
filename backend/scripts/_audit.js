require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const bizDocs = await p.bizDocument.groupBy({ by: ['status', 'docType'], _count: true });
  const payments = await p.payment.groupBy({ by: ['paymentType', 'status'], _count: true, _sum: { amount: true } });
  const purchases = await p.purchase.aggregate({ _count: true, _sum: { amount: true } });
  const invoices = await p.invoice.aggregate({ _count: true, _sum: { amountTotal: true } });
  const counterparties = await p.counterparty.findMany({ select: { id: true, name: true, type: true, subtype: true, eik: true, vat: true, city: true } });
  const projects = await p.project.count();
  const links = await p.reconciliationLink.groupBy({ by: ['linkType'], _count: true });
  const recentBankStmts = await p.bizDocument.findMany({
    where: { docType: 'BANK_STATEMENT' },
    select: { id: true, docNumber: true, docDate: true, amountTotal: true, currency: true, notes: true, counterparty: { select: { name: true } } },
    orderBy: { docDate: 'desc' },
    take: 10,
  });
  const vatRelated = await p.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { in: ['MATCHED', 'IMPORTED', 'REVIEWED'] } },
    select: { id: true, docNumber: true, amountTotal: true, vatAmount: true, currency: true, docDate: true, counterparty: { select: { name: true } } },
    take: 20,
    orderBy: { docDate: 'desc' },
  });
  const outInvoices = await p.bizDocument.findMany({
    where: { docType: 'INVOICE_OUT', status: { notIn: ['REJECTED'] } },
    select: { id: true, docNumber: true, amountTotal: true, vatAmount: true, currency: true, docDate: true, counterparty: { select: { name: true } } },
    take: 20,
    orderBy: { docDate: 'desc' },
  });
  
  console.log('\n=== BIZ DOCS BY STATUS+TYPE ===');
  bizDocs.sort((a,b) => b._count - a._count).forEach(d => console.log(`  ${d.status} / ${d.docType}: ${d._count}`));
  
  console.log('\n=== PAYMENTS by type+status ===');
  payments.forEach(pt => console.log(`  ${pt.paymentType} / ${pt.status}: count=${pt._count}, sum=${Number(pt._sum?.amount||0).toFixed(2)} BGN`));
  
  console.log('\n=== PURCHASES ===', purchases._count, 'total, sum=', Number(purchases._sum?.amount||0).toFixed(2), 'BGN');
  console.log('=== INVOICES (outgoing) ===', invoices._count, 'total, sum=', Number(invoices._sum?.amountTotal||0).toFixed(2), 'BGN');
  console.log('=== PROJECTS ===', projects);
  
  console.log('\n=== RECONCILIATION LINKS ===');
  links.forEach(l => console.log(`  ${l.linkType}: ${l._count}`));
  
  console.log('\n=== COUNTERPARTIES (total:', counterparties.length, ') ===');
  const withType = counterparties.filter(c => c.type);
  const withEIK = counterparties.filter(c => c.eik);
  const withVAT = counterparties.filter(c => c.vat);
  console.log(`  With type set: ${withType.length} | With EIK: ${withEIK.length} | With VAT#: ${withVAT.length}`);
  console.log('  Types:', counterparties.reduce((acc, c) => { acc[c.type] = (acc[c.type]||0)+1; return acc; }, {}));
  counterparties.slice(0, 30).forEach(c => console.log(`  - ${c.name} | type=${c.type} | eik=${c.eik||'?'} | vat=${c.vat||'?'} | city=${c.city||'?'}`));

  console.log('\n=== RECENT BANK STATEMENTS ===');
  recentBankStmts.forEach(d => console.log(`  ${String(d.docDate).slice(0,10)} | ${d.docNumber||'?'} | ${d.counterparty?.name||'?'} | ${d.amountTotal} ${d.currency}`));

  console.log('\n=== RECENT INVOICE_IN (incoming, with VAT) ===');
  vatRelated.forEach(d => console.log(`  ${String(d.docDate).slice(0,10)} | #${d.docNumber} | ${(d.counterparty?.name||'?').substring(0,30)} | total=${d.amountTotal} vat=${d.vatAmount||'?'} ${d.currency}`));

  console.log('\n=== RECENT INVOICE_OUT (outgoing) ===');
  outInvoices.forEach(d => console.log(`  ${String(d.docDate).slice(0,10)} | #${d.docNumber} | ${(d.counterparty?.name||'?').substring(0,30)} | total=${d.amountTotal} vat=${d.vatAmount||'?'} ${d.currency}`));
  
  await p.$disconnect();
}
main().catch(console.error);
