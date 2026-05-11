const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  // Find duplicate payments - get all IDs per reference and keep the oldest (min id)
  const dupRefs = await p.$queryRaw`
    SELECT reference FROM payments WHERE reference IS NOT NULL GROUP BY reference HAVING COUNT(*) > 1
  `;
  
  let deleted = 0;
  for (const { reference } of dupRefs) {
    const dupes = await p.payment.findMany({
      where: { reference },
      orderBy: { id: "asc" },
      select: { id: true, paymentDate: true, amount: true, currency: true, reference: true }
    });
    // Keep the first one, delete the rest
    const toDelete = dupes.slice(1);
    console.log(`Ref: ${reference?.substring(0,40)} | keeping ${dupes[0].id} | deleting ${toDelete.map(d=>d.id).join(",")}`);
    for (const d of toDelete) {
      await p.payment.delete({ where: { id: d.id } });
      deleted++;
    }
  }
  console.log(`\nDeleted ${deleted} duplicate payments`);
  const total = await p.payment.count();
  console.log(`Remaining payments: ${total}`);
}
main().catch(console.error).finally(() => p.$disconnect());
