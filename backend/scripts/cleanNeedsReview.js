/**
 * Reject NEEDS_REVIEW BizDocuments with zero/null amounts that have no reconciliation links.
 * These are migrated INVOICE_OUT stubs and DHL null-amount records — not actionable.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`=== NEEDS_REVIEW CLEANUP${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===\n`);

  const candidates = await p.bizDocument.findMany({
    where: {
      status: 'NEEDS_REVIEW',
      OR: [
        { amountTotal: null },
        { amountTotal: 0 },
      ],
    },
    select: {
      id: true, docType: true, docNumber: true, notes: true,
      amountTotal: true, currency: true,
      counterparty: { select: { name: true } },
      reconciliationLinks: { select: { id: true } },
    },
  });

  console.log(`NEEDS_REVIEW with zero/null amount: ${candidates.length}`);

  const toReject = candidates.filter(d => d.reconciliationLinks.length === 0);
  const keepLinked = candidates.filter(d => d.reconciliationLinks.length > 0);

  if (keepLinked.length > 0) {
    console.log(`\nSKIP (has recon links): ${keepLinked.length}`);
    keepLinked.forEach(d => console.log(`  KEEP [linked] ${d.id} | ${d.docType} | ${d.counterparty?.name || '—'} | ${(d.notes || '').substring(0, 50)}`));
  }

  console.log(`\nWill REJECT: ${toReject.length}`);
  toReject.forEach(d => console.log(`  REJECT ${d.id} | ${d.docType} | ${d.counterparty?.name || '—'} | ${(d.notes || '').substring(0, 60)}`));

  if (APPLY && toReject.length > 0) {
    await p.bizDocument.updateMany({
      where: { id: { in: toReject.map(d => d.id) } },
      data: { status: 'REJECTED' },
    });
    console.log(`\n✅ Rejected ${toReject.length} NEEDS_REVIEW BizDocuments.`);
  } else if (!APPLY) {
    console.log('\nRun with --apply to execute.');
  }
}

main().catch(console.error).finally(() => p.$disconnect());
