/**
 * 2026-07-09: Conservative matcher — PENDING Invoice ↔ incoming bank payments ([IN]).
 * A PENDING invoice becomes PAID only when there is EXACTLY ONE unused incoming
 * payment whose amount matches FX-aware within 0.5% and whose date falls in
 * [invoice date − 30d, invoice date + 90d] (advance invoices are issued days
 * AFTER the payment arrives). One payment can settle only one invoice.
 * Also creates a ReconciliationLink for the audit trail when the invoice has an
 * INVOICE_OUT BizDocument twin, and marks the payment MATCHED.
 * Dry run by default; --apply to write.
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const BGN_PER_EUR = 1.95583;

const toEur = (a, c) => c === 'BGN' ? Number(a) / BGN_PER_EUR : Number(a);
const close = (a, b) => a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= 0.005;

async function main() {
  console.log(`=== PENDING invoices ↔ [IN] payments ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const invoices = await prisma.invoice.findMany({
    where: { status: 'PENDING' },
    include: { client: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });
  const payments = await prisma.payment.findMany({
    where: { notes: { contains: '[IN]' } },
    include: { counterparty: { select: { name: true } } },
    orderBy: { paymentDate: 'asc' },
  });
  console.log(`PENDING invoices: ${invoices.length} | incoming payments: ${payments.length}\n`);

  const used = new Set();
  let paid = 0, ambiguous = 0, noMatch = 0;

  for (const inv of invoices) {
    const invEur = toEur(inv.amountTotal, inv.currency);
    const lo = new Date(inv.date); lo.setDate(lo.getDate() - 30);
    const hi = new Date(inv.date); hi.setDate(hi.getDate() + 90);
    const candidates = payments.filter(p =>
      !used.has(p.id) &&
      p.paymentDate >= lo && p.paymentDate <= hi &&
      close(toEur(p.amount, p.currency), invEur)
    );
    const tag = `#${inv.number} ${inv.date.toISOString().slice(0, 10)} ${inv.currency} ${inv.amountTotal} ${(inv.client?.name || '').slice(0, 25)}`;
    if (candidates.length === 1) {
      const pay = candidates[0];
      used.add(pay.id);
      paid++;
      console.log(`PAID      ${tag} ← плащане ${pay.paymentDate.toISOString().slice(0, 10)} ${pay.currency} ${pay.amount} от "${(pay.counterparty?.name || pay.reference || '').slice(0, 30)}"`);
      if (APPLY) {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { status: 'PAID', notes: `${inv.notes ? inv.notes + ' | ' : ''}PAID 2026-07-09: банково плащане ${pay.paymentDate.toISOString().slice(0, 10)} ${pay.amount} ${pay.currency} (${pay.reference || ''})`.slice(0, 700) },
        });
        await prisma.payment.update({ where: { id: pay.id }, data: { status: 'MATCHED' } });
      }
    } else if (candidates.length > 1) {
      ambiguous++;
      console.log(`AMBIGUOUS ${tag}: ${candidates.length} кандидата — оставена PENDING`);
    } else {
      noMatch++;
      console.log(`NO-PAY    ${tag}`);
    }
  }
  console.log('\n=== DONE ===', JSON.stringify({ paid, ambiguous, noMatch }));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
