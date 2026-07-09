/**
 * 2026-07-09: Backfill Payment.category for all payments (bank-first pivot).
 * Idempotent — reruns overwrite. Dry run by default; --apply to write.
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { classifyPayment } = require('../src/lib/paymentClassifier');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const toEur = (a, c) => c === 'BGN' ? Number(a) / 1.95583 : Number(a);

async function main() {
  console.log(`=== Classify all payments ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const supplierCps = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', counterpartyId: { not: null } },
    select: { counterpartyId: true }, distinct: ['counterpartyId'],
  });
  const supplierSet = new Set(supplierCps.map(x => x.counterpartyId));

  const payments = await prisma.payment.findMany({
    select: { id: true, paymentDate: true, amount: true, currency: true, reference: true, notes: true, counterpartyId: true, counterparty: { select: { name: true } } },
  });
  const agg = {};
  for (const p of payments) {
    const cat = classifyPayment(p, supplierSet);
    const y = p.paymentDate.getUTCFullYear();
    const k = y + '|' + cat;
    agg[k] = agg[k] || { n: 0, eur: 0 };
    agg[k].n++; agg[k].eur += toEur(p.amount, p.currency);
    if (APPLY) await prisma.payment.update({ where: { id: p.id }, data: { category: cat } });
  }
  console.log('Година|Категория: брой ~EUR');
  Object.keys(agg).sort().forEach(k => console.log(' ', k.padEnd(22), String(agg[k].n).padStart(4), Math.round(agg[k].eur).toString().padStart(9)));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
