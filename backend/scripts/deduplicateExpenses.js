require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Find all duplicates: keep the oldest (smallest createdAt), delete the rest
  const dups = await p.$queryRawUnsafe(`
    SELECT date::text, category, amount::text, currency, 
           array_agg(id ORDER BY "createdAt" ASC) as ids,
           COUNT(*)::int as cnt
    FROM expenses 
    GROUP BY date, category, amount, currency 
    HAVING COUNT(*) > 1
  `);

  console.log(`Found ${dups.length} duplicate groups`);
  let deleted = 0;

  for (const dup of dups) {
    const ids = dup.ids; // first is the one to keep
    const toDelete = ids.slice(1); // delete all but first
    console.log(`  ${dup.date.split('T')[0]} ${dup.category} ${dup.amount}${dup.currency} — keep ${ids[0]}, delete ${toDelete.length}`);
    await p.expense.deleteMany({ where: { id: { in: toDelete } } });
    deleted += toDelete.length;
  }

  const remaining = await p.expense.count();
  console.log(`\nDeleted: ${deleted} duplicates. Remaining expenses: ${remaining}`);
}

main().catch(console.error).finally(() => p.$disconnect());
