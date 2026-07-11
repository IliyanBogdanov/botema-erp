/**
 * 2026-07-11: Auto-link invoices and cost documents to projects via the offer
 * numbers (1717.xxx) that appear in their descriptions/notes/source folders.
 * This is what makes per-order P&L live — until now almost nothing was linked.
 *
 *  - Existing Project (by code) → link
 *  - Unknown offer number referenced by an INVOICE (revenue) → create the
 *    Project (code, client, year from the invoice) and link
 *  - Unknown number referenced only by cost docs → create too (order exists,
 *    invoice may come later)
 *  - Never overwrites an existing projectId
 *
 * Dry run by default; --apply to write.
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const RX = /1717\.(\d{1,4})/g;

const numsIn = text => [...new Set([...(String(text || '').matchAll(RX))].map(m => '1717.' + m[1]))];

async function main() {
  console.log(`=== Auto-link projects by offer number ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);

  const [projects, invoices, docs] = await Promise.all([
    prisma.project.findMany({ select: { id: true, code: true } }),
    prisma.invoice.findMany({
      where: { status: { not: 'CANCELLED' } },
      select: { id: true, number: true, date: true, description: true, notes: true, projectId: true, clientId: true, amountNet: true, currency: true, client: { select: { name: true } } },
    }),
    prisma.bizDocument.findMany({
      where: { status: { in: ['MATCHED', 'REVIEWED', 'IMPORTED'] } },
      select: { id: true, docType: true, docDate: true, notes: true, projectId: true, sourceFile: { select: { folder: true, filename: true } } },
    }),
  ]);
  const byCode = new Map(projects.map(p => [p.code, p.id]));

  // Collect references: code → { invoices: [], docs: [] }
  const refs = new Map();
  const addRef = (code, kind, item) => {
    if (!refs.has(code)) refs.set(code, { invoices: [], docs: [] });
    refs.get(code)[kind].push(item);
  };
  for (const inv of invoices) {
    for (const code of numsIn(`${inv.description || ''} ${inv.notes || ''}`)) addRef(code, 'invoices', inv);
  }
  for (const d of docs) {
    const text = `${d.notes || ''} ${d.sourceFile?.folder || ''} ${d.sourceFile?.filename || ''}`;
    for (const code of numsIn(text)) addRef(code, 'docs', d);
  }
  console.log(`Офертни номера с референции: ${refs.size}\n`);

  const stats = { projectsCreated: 0, invLinked: 0, docLinked: 0, skippedHasProject: 0, skippedThin: 0 };
  for (const [code, r] of [...refs.entries()].sort()) {
    let projectId = byCode.get(code);
    if (!projectId) {
      // Only create a project when there is real substance: an invoice (revenue)
      // or at least two cost documents. Single stray references stay unlinked —
      // 40+ single-doc projects would just clutter the Projects page.
      if (r.invoices.length === 0 && r.docs.length < 2) { stats.skippedThin++; continue; }
      const inv = r.invoices[0];
      const when = new Date(inv?.date || r.docs[0]?.docDate || Date.now());
      const lastActivity = Math.max(...[...r.invoices.map(i => +new Date(i.date)), ...r.docs.map(d => +new Date(d.docDate || 0))]);
      const isRecent = Date.now() - lastActivity < 90 * 864e5;
      const name = inv?.client?.name ? `${inv.client.name} — ${code}` : `Поръчка ${code}`;
      console.log(`+PROJECT ${code} "${name}" (${r.invoices.length} фактури, ${r.docs.length} документа) [${isRecent ? 'ACTIVE' : 'COMPLETED'}]`);
      stats.projectsCreated++;
      if (APPLY) {
        const created = await prisma.project.create({
          data: {
            code, name,
            clientId: inv?.clientId || null,
            year: when.getUTCFullYear(),
            status: isRecent ? 'ACTIVE' : 'COMPLETED',
            notes: 'Създаден автоматично 2026-07-11 от офертен номер в документите',
          },
          select: { id: true },
        });
        projectId = created.id;
        byCode.set(code, projectId);
      } else {
        projectId = 'dry-run';
      }
    }
    for (const inv of r.invoices) {
      if (inv.projectId) { stats.skippedHasProject++; continue; }
      stats.invLinked++;
      if (APPLY) await prisma.invoice.update({ where: { id: inv.id }, data: { projectId } });
      inv.projectId = projectId; // avoid double-link within the run
    }
    for (const d of r.docs) {
      if (d.projectId) { stats.skippedHasProject++; continue; }
      stats.docLinked++;
      if (APPLY) await prisma.bizDocument.update({ where: { id: d.id }, data: { projectId } });
      d.projectId = projectId;
    }
  }

  console.log('\n=== DONE ===', JSON.stringify(stats));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
