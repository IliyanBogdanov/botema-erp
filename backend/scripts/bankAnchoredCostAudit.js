/**
 * 2026-07-09: Bank-anchored cost audit. The bank data is now COMPLETE
 * (2024-2026, one account, directions known), so every real supplier cost must
 * either match an outgoing payment or be a recent payable. Targets the classes
 * that inflated documented costs ~300K over actual bank outgoings:
 *
 *  A) Same-digits different-currency twins (EUR/BGN mislabel) → REJECT the
 *     BGN-labeled one when the counterpart has recon evidence, else newest.
 *  B) Proforma/version twins (docNumber P-prefix / V03 / ПФ) whose same-amount
 *     invoice twin exists within 60d → REJECT the proforma one.
 *  C) Numberless Purchase-migrated docs (order totals from Drive folders):
 *     keep only if an unused OUT payment matches the amount ±1% within
 *     [docDate-30d, docDate+180d]; otherwise → NEEDS_REVIEW (order without
 *     invoice/payment evidence — likely duplicated by the real invoices).
 *
 * Dry run by default; --apply to write.
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const toEur = (a, c) => c === 'BGN' ? Number(a) / 1.95583 : c === 'USD' ? Number(a) / 1.14 : Number(a);

async function setStatus(doc, status, reason, stats, key) {
  stats[key] = (stats[key] || 0) + toEur(doc.amountTotal, doc.currency);
  stats[key + 'N'] = (stats[key + 'N'] || 0) + 1;
  console.log(`${status.padEnd(12)} ${(doc.counterparty?.name || 'NULL').slice(0, 28).padEnd(28)} ${doc.docDate?.toISOString().slice(0, 10)} ${doc.currency} ${String(doc.amountTotal).padStart(10)} #${(doc.docNumber || '?').slice(0, 16)} — ${reason}`);
  if (!APPLY) return;
  await prisma.bizDocument.update({
    where: { id: doc.id },
    data: { status, notes: `${doc.notes ? doc.notes + ' | ' : ''}${status} 2026-07-09 bank-audit: ${reason}`.slice(0, 1000) },
  });
}

async function main() {
  console.log(`=== Bank-anchored cost audit ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const docs = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { in: ['MATCHED', 'REVIEWED', 'IMPORTED'] } },
    select: {
      id: true, docNumber: true, docDate: true, amountTotal: true, currency: true, notes: true, counterpartyId: true,
      counterparty: { select: { name: true } },
    },
  });
  const outPays = await prisma.payment.findMany({
    where: { notes: { contains: '[OUT]' } },
    select: { id: true, paymentDate: true, amount: true, currency: true },
  });
  const stats = {};
  const handled = new Set();

  // ── A) currency twins ──────────────────────────────────────────────────────
  const byCp = {};
  docs.forEach(d => { const k = d.counterpartyId || 'NULL'; (byCp[k] = byCp[k] || []).push(d); });
  for (const arr of Object.values(byCp)) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (handled.has(a.id) || handled.has(b.id)) continue;
      const days = a.docDate && b.docDate ? Math.abs(a.docDate - b.docDate) / 864e5 : 999;
      if (Math.abs(Number(a.amountTotal) - Number(b.amountTotal)) < 0.02 && a.currency !== b.currency && days < 60) {
        const drop = a.currency === 'BGN' ? a : b; // 2025+ supplier EUR invoices: BGN label is the parse artifact
        handled.add(drop.id);
        await setStatus(drop, 'REJECTED', `валутен дубликат на #${(drop === a ? b : a).docNumber}`, stats, 'A');
      }
    }
  }

  // ── B) proforma/version twins ──────────────────────────────────────────────
  const isProformaNo = n => /^(P\d|ПФ|PRO)/i.test(String(n || '')) || /V03\b/.test(String(n || ''));
  for (const arr of Object.values(byCp)) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (handled.has(a.id) || handled.has(b.id)) continue;
      const days = a.docDate && b.docDate ? Math.abs(a.docDate - b.docDate) / 864e5 : 999;
      if (Math.abs(Number(a.amountTotal) - Number(b.amountTotal)) < 0.02 && a.currency === b.currency && days < 60) {
        const aP = isProformaNo(a.docNumber), bP = isProformaNo(b.docNumber);
        if (aP !== bP) {
          const drop = aP ? a : b;
          handled.add(drop.id);
          await setStatus(drop, 'REJECTED', `проформа-двойник на фактура #${(drop === a ? b : a).docNumber}`, stats, 'B');
        }
      }
    }
  }

  // ── C) numberless order docs: keep only when payment-backed ───────────────
  const usedPay = new Set();
  const orderDocs = docs.filter(d => !handled.has(d.id) && (!d.docNumber || d.docNumber === '?') && /Мигрирано от Purchase/.test(d.notes || ''));
  orderDocs.sort((x, y) => (x.docDate || 0) - (y.docDate || 0));
  for (const d of orderDocs) {
    const eur = toEur(d.amountTotal, d.currency);
    if (!eur) continue;
    const lo = d.docDate ? new Date(d.docDate.getTime() - 30 * 864e5) : null;
    const hi = d.docDate ? new Date(d.docDate.getTime() + 180 * 864e5) : null;
    const match = outPays.find(pp => !usedPay.has(pp.id)
      && (!lo || (pp.paymentDate >= lo && pp.paymentDate <= hi))
      && Math.abs(toEur(pp.amount, pp.currency) - eur) / eur <= 0.01);
    if (match) {
      usedPay.add(match.id);
      stats.CkeptN = (stats.CkeptN || 0) + 1;
      stats.Ckept = (stats.Ckept || 0) + eur;
      console.log(`KEEP(paid)   ${(d.counterparty?.name || 'NULL').slice(0, 28).padEnd(28)} ${d.docDate?.toISOString().slice(0, 10)} ${d.currency} ${String(d.amountTotal).padStart(10)} ← плащане ${match.paymentDate.toISOString().slice(0, 10)} ${match.amount} ${match.currency}`);
    } else {
      await setStatus(d, 'NEEDS_REVIEW', 'поръчков запис без номер и без покриващо плащане — вероятно дублира реалните фактури', stats, 'C');
    }
  }

  console.log('\n=== DONE ===');
  console.log(`A) валутни дубликати REJECTED: ${stats.AN || 0} (~${Math.round(stats.A || 0)} EUR)`);
  console.log(`B) проформа-двойки REJECTED: ${stats.BN || 0} (~${Math.round(stats.B || 0)} EUR)`);
  console.log(`C) поръчкови без покритие → NEEDS_REVIEW: ${stats.CN || 0} (~${Math.round(stats.C || 0)} EUR); запазени с плащане: ${stats.CkeptN || 0} (~${Math.round(stats.Ckept || 0)} EUR)`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
