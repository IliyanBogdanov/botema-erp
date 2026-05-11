const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  let removed = 0;

  // ── 1. BizDocument duplicates: keep earliest, delete rest ──────────────────
  const dupBizDocs = await prisma.$queryRaw`
    SELECT "docType", "docNumber", COUNT(*) as cnt, MIN("createdAt") as first_created
    FROM biz_documents WHERE "docNumber" IS NOT NULL
    GROUP BY "docType", "docNumber" HAVING COUNT(*) > 1
  `;

  for (const row of dupBizDocs) {
    const all = await prisma.bizDocument.findMany({
      where: { docType: row.docType, docNumber: row.docNumber },
      orderBy: { createdAt: 'asc' },
      select: { id: true, docNumber: true, docType: true }
    });
    // keep first, delete the rest
    const toDelete = all.slice(1).map(d => d.id);
    // First remove reconciliation links pointing to these
    await prisma.reconciliationLink.deleteMany({ where: { OR: [{ sourceDocId: { in: toDelete } }, { targetDocId: { in: toDelete } }] } });
    await prisma.bizDocument.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`  Deleted ${toDelete.length} dupe(s): ${row.docType} #${row.docNumber}`);
    removed += toDelete.length;
  }

  // ── 2. Payment duplicates: same reference + amount + date ──────────────────
  const dupPayments = await prisma.$queryRaw`
    SELECT reference, amount, "paymentDate", COUNT(*) as cnt
    FROM payments WHERE reference IS NOT NULL
    GROUP BY reference, amount, "paymentDate" HAVING COUNT(*) > 1
  `;

  for (const row of dupPayments) {
    const all = await prisma.payment.findMany({
      where: { reference: row.reference, amount: row.amount, paymentDate: row.paymentDate },
      orderBy: { createdAt: 'asc' },
      select: { id: true }
    });
    const toDelete = all.slice(1).map(p => p.id);
    await prisma.reconciliationLink.deleteMany({ where: { paymentId: { in: toDelete } } });
    await prisma.payment.deleteMany({ where: { id: { in: toDelete } } });
    console.log(`  Deleted ${toDelete.length} dupe payment(s): ref=${row.reference} amt=${row.amount}`);
    removed += toDelete.length;
  }

  console.log(`\nTotal removed: ${removed}`);

  // Final counts
  const bizDocs = await prisma.bizDocument.count();
  const payments = await prisma.payment.count();
  const links = await prisma.reconciliationLink.count();
  console.log(`BizDocuments: ${bizDocs}, Payments: ${payments}, Links: ${links}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
