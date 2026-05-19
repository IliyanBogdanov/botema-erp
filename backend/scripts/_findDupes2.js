/**
 * Cross-counterparty duplicate BizDoc cleanup.
 * Standard cleanBizDocumentDuplicates.js groups by counterpartyId too, missing
 * cross-source duplicates where the same invoice was imported from Gmail, Drive,
 * AND the migrated Purchase table — each with a different counterpartyId.
 *
 * Groups by: docType + docNumber + currency + amountTotal (±0.01)
 * Keeps: best status (MATCHED > IMPORTED > REVIEWED > …), rejects the rest.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const STATUS_RANK = { MATCHED: 6, REVIEWED: 5, IMPORTED: 4, NEEDS_REVIEW: 3, NEW: 2, ARCHIVED: 1, REJECTED: 0 };
function rank(doc) {
  return [STATUS_RANK[doc.status] || 0, Number(doc.confidence || 0), -new Date(doc.createdAt).getTime()];
}
function best(a, b) {
  const ar = rank(a), br = rank(b);
  for (let i = 0; i < ar.length; i++) if (br[i] !== ar[i]) return br[i] > ar[i] ? b : a;
  return a;
}

async function main() {
  console.log(`=== CROSS-COUNTERPARTY DEDUP${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);

  const groups = await p.$queryRawUnsafe(`
    SELECT "docType", "docNumber", currency,
      ROUND(COALESCE("amountTotal", 0)::numeric, 2)::text AS amount,
      COUNT(*)::int AS cnt
    FROM biz_documents
    WHERE "docNumber" IS NOT NULL
      AND status != 'REJECTED'
      AND "amountTotal" > 0
    GROUP BY 1,2,3,4
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `);

  console.log(`Duplicate groups: ${groups.length}`);
  let totalRejected = 0;

  for (const g of groups) {
    const amt = parseFloat(g.amount);
    const docs = await p.bizDocument.findMany({
      where: {
        docType: g.docType,
        docNumber: g.docNumber,
        currency: g.currency,
        status: { not: 'REJECTED' },
        amountTotal: { gte: amt - 0.015, lte: amt + 0.015 },
      },
      select: { id: true, status: true, notes: true, counterpartyId: true, confidence: true, createdAt: true },
    });
    if (docs.length < 2) continue;

    const keeper = docs.reduce((a, b) => best(a, b) === a ? a : b);
    const dupes = docs.filter(d => d.id !== keeper.id);

    console.log(`\n${g.docType} #${g.docNumber} ${g.amount} ${g.currency} x${docs.length}:`);
    console.log(`  KEEP [${keeper.status}] ${keeper.id} | ${(keeper.notes||'').substring(0,55)}`);
    dupes.forEach(d => console.log(`  REJECT [${d.status}] ${d.id} | ${(d.notes||'').substring(0,55)}`));

    if (APPLY) {
      await p.bizDocument.updateMany({
        where: { id: { in: dupes.map(d => d.id) } },
        data: { status: 'REJECTED' },
      });
      totalRejected += dupes.length;
    }
  }

  console.log(`\n=== DONE: ${APPLY ? `rejected ${totalRejected}` : `would reject ~${groups.length}+ dupes`} ===`);
}
main().catch(console.error).finally(() => p.$disconnect());
