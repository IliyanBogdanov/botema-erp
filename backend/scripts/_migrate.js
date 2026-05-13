require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  await p.$executeRawUnsafe('ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS "isIndividual" BOOLEAN NOT NULL DEFAULT false');
  await p.$executeRawUnsafe('ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS website TEXT');
  await p.$executeRawUnsafe('ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS "logoUrl" TEXT');
  // Also add missing vatAmount, amountNet to bizdocuments if not present
  await p.$executeRawUnsafe('ALTER TABLE biz_documents ADD COLUMN IF NOT EXISTS "vatAmount" DECIMAL(14,4)');
  await p.$executeRawUnsafe('ALTER TABLE biz_documents ADD COLUMN IF NOT EXISTS "amountNet" DECIMAL(14,4)');
  console.log('Migration applied successfully');
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
