// Fix dashboard data issues found in 2026-07-08 audit:
// 1. Demote today's auto-promoted MinerU docs (REVIEWED -> NEEDS_REVIEW) — unverified, null counterparty
// 2. Reject two x100 decimal-error customs docs (real siblings exist at /100)
// 3. Merge duplicate "Агенция Митници" counterparty into canonical cp-mitnica-bg
// 4. Delete today's amount-mismatched recon links + reset affected payments; undo missing-document spam
// Usage: node scripts/_fixDashboardData.js [--apply]
const prisma = require('../src/lib/prisma');

const APPLY = process.argv.includes('--apply');
const EUR = 1.95583;
const toEur = (a, c) => (c === 'BGN' ? Number(a) / EUR : Number(a));

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN ===');

  // ── 1. Demote MinerU auto-promoted docs ────────────────────────────────
  const mineru = await prisma.bizDocument.findMany({
    where: { notes: { startsWith: 'MinerU promoted' }, status: 'REVIEWED' },
    select: { id: true, amountTotal: true, currency: true, docDate: true },
  });
  const mineruEur = mineru.reduce((s, d) => s + toEur(d.amountTotal || 0, d.currency), 0);
  console.log(`\n[1] MinerU REVIEWED -> NEEDS_REVIEW: ${mineru.length} docs (${mineruEur.toFixed(0)} EUR removed from dashboard)`);
  if (APPLY && mineru.length) {
    await prisma.bizDocument.updateMany({
      where: { id: { in: mineru.map(d => d.id) } },
      data: { status: 'NEEDS_REVIEW' },
    });
  }

  // ── 2. Reject x100 customs docs ────────────────────────────────────────
  const X100 = [
    { id: 'cmp0z1226000ixxha18wk5pnn', label: '133163 BGN (real: 1331.63, exists as TEXPE-0002849880)' },
    { id: 'cmp0z36ix00dnxxhatni802lu', label: '45630 EUR (real: 456.30, exists as doc cmpb50dr9000h1pp9oqni5bww)' },
  ];
  for (const { id, label } of X100) {
    const links = await prisma.reconciliationLink.findMany({
      where: { OR: [{ sourceDocId: id }, { targetDocId: id }] },
      select: { id: true, paymentId: true },
    });
    console.log(`\n[2] Reject doc ${id} — ${label}; delete ${links.length} links`);
    if (APPLY) {
      await prisma.reconciliationLink.deleteMany({ where: { OR: [{ sourceDocId: id }, { targetDocId: id }] } });
      await prisma.bizDocument.update({
        where: { id },
        data: { status: 'REJECTED', notes: { set: `REJECTED 2026-07-08: x100 decimal error — ${label}` } },
      });
      // reset orphaned payments
      const payIds = [...new Set(links.map(l => l.paymentId).filter(Boolean))];
      let reset = 0;
      for (const pid of payIds) {
        const remaining = await prisma.reconciliationLink.count({ where: { paymentId: pid } });
        if (remaining === 0) {
          await prisma.payment.update({ where: { id: pid }, data: { status: 'UNMATCHED' } });
          reset++;
        }
      }
      console.log(`    reset ${reset} orphaned payments to UNMATCHED`);
    }
  }

  // ── 3. Merge duplicate customs counterparty ───────────────────────────
  const DUP_CP = 'cmoyhaotc000jnodp1mheb559';
  const CANON_CP = 'cp-mitnica-bg';
  const dupDocs = await prisma.bizDocument.count({ where: { counterpartyId: DUP_CP } });
  const dupPays = await prisma.payment.count({ where: { counterpartyId: DUP_CP } });
  console.log(`\n[3] Merge CP ${DUP_CP} -> ${CANON_CP}: ${dupDocs} docs, ${dupPays} payments`);
  if (APPLY) {
    await prisma.bizDocument.updateMany({ where: { counterpartyId: DUP_CP }, data: { counterpartyId: CANON_CP } });
    await prisma.payment.updateMany({ where: { counterpartyId: DUP_CP }, data: { counterpartyId: CANON_CP } });
    const other = await prisma.purchase.updateMany({ where: { supplierId: DUP_CP }, data: { supplierId: CANON_CP } }).catch(() => ({ count: 0 }));
    try { await prisma.counterparty.delete({ where: { id: DUP_CP } }); console.log('    dup CP deleted'); }
    catch (e) { console.log('    dup CP kept (still referenced):', e.code || e.message); }
  }

  // ── 4. Today's bad recon links ─────────────────────────────────────────
  const todayLinks = await prisma.reconciliationLink.findMany({
    where: { createdAt: { gte: new Date('2026-07-08T00:00:00Z') } },
    include: {
      payment: { select: { id: true, amount: true, currency: true, status: true, notes: true } },
      targetDoc: { select: { amountTotal: true, currency: true } },
      sourceDoc: { select: { amountTotal: true, currency: true } },
    },
  });
  const bad = [];
  for (const l of todayLinks) {
    const doc = l.targetDoc || l.sourceDoc;
    if (!l.payment || !doc) continue;
    const p = toEur(l.payment.amount, l.payment.currency);
    const d = toEur(doc.amountTotal || 0, doc.currency);
    const tol = Math.max(2, 0.02 * Math.max(p, d));
    if (Math.abs(p - d) > tol) bad.push(l);
  }
  console.log(`\n[4] Today's links: ${todayLinks.length}, amount-mismatched (to delete): ${bad.length}`);
  if (APPLY && bad.length) {
    await prisma.reconciliationLink.deleteMany({ where: { id: { in: bad.map(l => l.id) } } });
    let reset = 0;
    for (const pid of [...new Set(bad.map(l => l.paymentId).filter(Boolean))]) {
      const remaining = await prisma.reconciliationLink.count({ where: { paymentId: pid } });
      const pay = await prisma.payment.findUnique({ where: { id: pid }, select: { notes: true } });
      const isSystem = /\[auto:(bank_fee|tax|salary|atm|card_subscription|cod|correction)\]/.test(pay?.notes || '');
      if (remaining === 0 && !isSystem) {
        await prisma.payment.update({ where: { id: pid }, data: { status: 'UNMATCHED' } });
        reset++;
      }
    }
    console.log(`    reset ${reset} payments to UNMATCHED`);
  }

  // undo missing-document spam
  const missSpam = await prisma.missingDocument.findMany({
    where: { notes: { startsWith: 'Auto-created from unmatched payment' } },
    select: { id: true, notes: true },
  });
  const taggedPays = await prisma.payment.findMany({
    where: { notes: { contains: '[auto:missing_document]' } },
    select: { id: true, notes: true },
  });
  console.log(`[4b] Auto-created MissingDocuments to delete: ${missSpam.length}; payments tagged [auto:missing_document] to reset: ${taggedPays.length}`);
  if (APPLY) {
    if (missSpam.length) await prisma.missingDocument.deleteMany({ where: { id: { in: missSpam.map(m => m.id) } } });
    for (const p of taggedPays) {
      const remaining = await prisma.reconciliationLink.count({ where: { paymentId: p.id } });
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          notes: p.notes.replace(/\s*\[auto:missing_document\]/g, ''),
          status: remaining > 0 ? 'PARTIAL' : 'UNMATCHED',
        },
      });
    }
  }

  // ── 5. Recompute dashboard numbers ─────────────────────────────────────
  const AUTH = ['REVIEWED', 'IMPORTED', 'MATCHED'];
  for (const year of [2024, 2025, 2026]) {
    const docs = await prisma.bizDocument.findMany({
      where: {
        docType: 'INVOICE_IN', status: { in: AUTH }, amountTotal: { gt: 0 },
        docDate: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31T23:59:59Z`) },
      },
      select: { amountTotal: true, currency: true, counterpartyId: true },
    });
    const eur = docs.reduce((s, d) => s + toEur(d.amountTotal, d.currency), 0);
    const byCp = {};
    for (const d of docs) {
      if (!d.counterpartyId) continue;
      byCp[d.counterpartyId] = (byCp[d.counterpartyId] || 0) + toEur(d.amountTotal, d.currency);
    }
    const top = Object.entries(byCp).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const names = await prisma.counterparty.findMany({ where: { id: { in: top.map(t => t[0]) } }, select: { id: true, name: true } });
    const nm = Object.fromEntries(names.map(n => [n.id, n.name]));
    console.log(`\n[5] ${APPLY ? 'AFTER' : 'WOULD-BE'} ${year}: purchases=${eur.toFixed(0)} EUR (${docs.length} docs); top: ${top.map(([c, a]) => `${nm[c]}=${a.toFixed(0)}`).join(', ')}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
