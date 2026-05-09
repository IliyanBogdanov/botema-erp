// Migration: add new InvoiceType values and InvoiceItem fields
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Applying document schema migration...');

  // PostgreSQL ALTER TYPE ... ADD VALUE is safe to run multiple times with IF NOT EXISTS
  await prisma.$executeRawUnsafe(`ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'OFFER'`);
  await prisma.$executeRawUnsafe(`ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'DELIVERY_NOTE'`);
  await prisma.$executeRawUnsafe(`ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'PROTOCOL'`);
  await prisma.$executeRawUnsafe(`ALTER TYPE "InvoiceType" ADD VALUE IF NOT EXISTS 'WARRANTY'`);
  console.log('✓ InvoiceType enum extended');

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "invoice_items"
      ADD COLUMN IF NOT EXISTS "unit"      TEXT,
      ADD COLUMN IF NOT EXISTS "imageUrl"  TEXT,
      ADD COLUMN IF NOT EXISTS "sortOrder" INT NOT NULL DEFAULT 0
  `);
  console.log('✓ invoice_items columns added');

  console.log('Migration complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
