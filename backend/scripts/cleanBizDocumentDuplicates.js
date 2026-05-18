require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const STATUS_RANK = {
  MATCHED: 6,
  IMPORTED: 5,
  REVIEWED: 4,
  NEEDS_REVIEW: 3,
  NEW: 2,
  ARCHIVED: 1,
  REJECTED: 0,
};

function rankDoc(doc) {
  return [
    STATUS_RANK[doc.status] || 0,
    doc.internalRef ? 1 : 0,
    doc.sourceFileId ? 1 : 0,
    Number(doc.confidence || 0),
    -new Date(doc.createdAt).getTime(),
  ];
}

function compareRank(a, b) {
  const ar = rankDoc(a);
  const br = rankDoc(b);
  for (let i = 0; i < ar.length; i++) {
    if (br[i] !== ar[i]) return br[i] - ar[i];
  }
  return 0;
}

async function duplicateGroups() {
  return prisma.$queryRawUnsafe(`
    SELECT "docType", "docNumber", currency,
      ROUND(COALESCE("amountTotal", 0)::numeric, 2)::text AS amount,
      COALESCE("counterpartyId", '') AS cp,
      COUNT(*)::int AS cnt
    FROM biz_documents
    WHERE "docNumber" IS NOT NULL
    GROUP BY 1,2,3,4,5
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
  `);
}

async function main() {
  console.log(`=== CLEAN BIZDOCUMENT DUPLICATES${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);
  const groups = await duplicateGroups();
  console.log(`Groups: ${groups.length}`);

  let deleted = 0;
  let relinked = 0;

  for (const group of groups) {
    const amount = Number(group.amount);
    const docs = await prisma.bizDocument.findMany({
      where: {
        docType: group.docType,
        docNumber: group.docNumber,
        currency: group.currency,
        counterpartyId: group.cp || null,
        amountTotal: { gte: amount - 0.005, lte: amount + 0.005 },
      },
      include: {
        reconciliationLinks: { select: { id: true } },
        linkedTo: { select: { id: true } },
        missingDocuments: { select: { id: true } },
      },
    });
    if (docs.length < 2) continue;

    const [keeper, ...dupes] = docs.sort(compareRank);
    console.log(`KEEP ${keeper.id} ${group.docType} #${group.docNumber} ${group.amount} ${group.currency}; delete ${dupes.length}`);

    if (!APPLY) continue;

    for (const dupe of dupes) {
      const [sourceLinks, targetLinks, missingDocs] = await prisma.$transaction([
        prisma.reconciliationLink.updateMany({ where: { sourceDocId: dupe.id }, data: { sourceDocId: keeper.id } }),
        prisma.reconciliationLink.updateMany({ where: { targetDocId: dupe.id }, data: { targetDocId: keeper.id } }),
        prisma.missingDocument.updateMany({ where: { relatedDocId: dupe.id }, data: { relatedDocId: keeper.id } }),
      ]);
      relinked += sourceLinks.count + targetLinks.count + missingDocs.count;

      await prisma.bizDocument.delete({ where: { id: dupe.id } });
      deleted++;
    }
  }

  console.log(`Done: deleted=${deleted}, relinked=${relinked}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
