/**
 * 2026-07-09: Backfill [IN]/[OUT] direction markers on 2026 payments from the
 * full-year Texim CSV (bank statements and docs/2026.csv), which has explicit
 * debit/credit columns. 203 of the 2026 payments were imported from monthly
 * PDFs without direction and can't be matched to outgoing invoices otherwise.
 * Match: same date + amount (±0.01) + currency; unique candidate only.
 * Dry run by default; --apply to write.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { parseBankStatementBuffer } = require('../src/lib/bankStatementParser');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const CSV = path.resolve(__dirname, '../../bank statements and docs/2026.csv');

async function main() {
  console.log(`=== Backfill payment directions from 2026.csv ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const { meta, rows } = parseBankStatementBuffer(fs.readFileSync(CSV));
  console.log(`CSV: ${rows.length} rows, currency ${meta.currency}, IBAN ${meta.iban}`);

  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: new Date('2026-01-01') } },
    select: { id: true, paymentDate: true, amount: true, currency: true, reference: true, notes: true },
  });
  const unmarked = payments.filter(p => !/\[(IN|OUT)\]/.test(p.notes || ''));
  console.log(`Payments 2026: ${payments.length}, без посока: ${unmarked.length}`);

  const stats = { marked: 0, ambiguous: 0, noRow: 0 };
  for (const pay of unmarked) {
    const payDay = pay.paymentDate.toISOString().slice(0, 10);
    const candidates = rows.filter(r => {
      const amt = r.isOutgoing ? r.debit : r.credit;
      const rDay = r.date instanceof Date ? r.date.toISOString().slice(0, 10)
        : String(r.date).slice(0, 10);
      return rDay === payDay && Math.abs(Number(amt) - Number(pay.amount)) < 0.01;
    });
    const dirs = [...new Set(candidates.map(r => r.isOutgoing ? 'OUT' : 'IN'))];
    if (candidates.length === 0) { stats.noRow++; continue; }
    if (dirs.length > 1) {
      stats.ambiguous++;
      console.log(`AMBIG ${payDay} ${pay.amount} ${pay.currency} — редове и в двете посоки`);
      continue;
    }
    const dir = dirs[0];
    stats.marked++;
    if (stats.marked <= 15 || dir === 'IN') console.log(`MARK [${dir}] ${payDay} ${pay.currency} ${String(pay.amount).padStart(10)} | ${(pay.reference || '').slice(0, 50)}`);
    if (APPLY) {
      await prisma.payment.update({
        where: { id: pay.id },
        data: { notes: `${pay.notes ? pay.notes + ' ' : ''}[${dir}]`.slice(0, 900) },
      });
    }
  }
  console.log('\n=== DONE ===', JSON.stringify(stats));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
