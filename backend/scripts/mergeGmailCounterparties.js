/**
 * mergeGmailCounterparties.js
 * Merges short-name counterparties created by processGmailPdfs.js
 * into the existing canonical counterparties.
 *
 * Usage:
 *   node scripts/mergeGmailCounterparties.js           # dry run
 *   node scripts/mergeGmailCounterparties.js --apply   # apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Short names created by Gmail script → canonical counterparty name (exact match, case-insensitive)
// canonicalContains: substring to find the canonical CP in the DB
const MERGE_MAP = [
  { shortName: 'Polaris',       canonicalContains: 'Polaris Lighting' },
  { shortName: 'Lodes',         canonicalContains: 'LODES S.r.l' },
  { shortName: 'Formani',       canonicalContains: 'Formani Holland' },
  { shortName: 'Fercam',        canonicalContains: 'Dachser' },
  { shortName: 'Zieta',         canonicalContains: 'Zieta Prozessdesign' },
  { shortName: 'Atelier Sedap', canonicalContains: 'ATELIER SEDAP SN' },
  { shortName: 'ROS-BG',        canonicalContains: 'ROS-BG' },
];

async function main() {
  console.log(`=== MERGE GMAIL COUNTERPARTIES${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);

  for (const { shortName, canonicalContains } of MERGE_MAP) {
    // Find the short-name CP (exact match, type SUPPLIER)
    const shortCp = await prisma.counterparty.findFirst({
      where: { name: { equals: shortName, mode: 'insensitive' }, type: 'SUPPLIER' },
      select: { id: true, name: true },
    });
    if (!shortCp) {
      console.log(`SKIP: "${shortName}" not found`);
      continue;
    }

    // Find the canonical CP
    const canonicalCp = await prisma.counterparty.findFirst({
      where: { name: { contains: canonicalContains, mode: 'insensitive' }, type: 'SUPPLIER' },
      select: { id: true, name: true },
    });
    if (!canonicalCp) {
      console.log(`SKIP: canonical "${canonicalContains}" not found — keeping "${shortName}"`);
      continue;
    }

    if (shortCp.id === canonicalCp.id) {
      console.log(`SKIP: "${shortName}" IS the canonical`);
      continue;
    }

    // Count affected records
    const bizCount = await prisma.bizDocument.count({ where: { counterpartyId: shortCp.id } });
    const payCount = await prisma.payment.count({ where: { counterpartyId: shortCp.id } });

    console.log(`MERGE: "${shortCp.name}" → "${canonicalCp.name}" | bizDocs=${bizCount} payments=${payCount}`);

    if (APPLY) {
      // Re-point BizDocs and Payments to canonical
      if (bizCount > 0) {
        await prisma.bizDocument.updateMany({
          where: { counterpartyId: shortCp.id },
          data: { counterpartyId: canonicalCp.id },
        });
      }
      if (payCount > 0) {
        await prisma.payment.updateMany({
          where: { counterpartyId: shortCp.id },
          data: { counterpartyId: canonicalCp.id },
        });
      }
      // Delete the short-name CP (only if no more refs)
      const remainingBiz = await prisma.bizDocument.count({ where: { counterpartyId: shortCp.id } });
      const remainingPay = await prisma.payment.count({ where: { counterpartyId: shortCp.id } });
      if (remainingBiz === 0 && remainingPay === 0) {
        await prisma.counterparty.delete({ where: { id: shortCp.id } });
        console.log(`  ✅ Merged and deleted "${shortCp.name}"`);
      } else {
        console.log(`  ⚠ Still has refs — not deleted (biz=${remainingBiz} pay=${remainingPay})`);
      }
    }
  }

  console.log('Done.');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
