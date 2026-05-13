/**
 * aiExtractVAT.js
 *
 * Fill vatAmount and amountNet on BizDocuments where null.
 * Rules:
 *   - BG supplier (country=BG), VAT-registered: VAT = total / 1.2 * 0.2 = total / 6
 *   - EU supplier (not BG): EU VAT reverse charge, usually VAT=0 in the document
 *   - If vatAmount is already set, skip
 *
 * Run: node scripts/aiExtractVAT.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

async function main() {
  console.log('=== VAT Extraction for BizDocuments ===\n');

  const docs = await p.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'OFFER_OUT'] },
      amountTotal: { not: null, gt: 0 },
    },
    include: {
      counterparty: { select: { country: true, vat: true, isIndividual: true, name: true } },
    },
    orderBy: { docDate: 'desc' },
  });

  console.log(`Found ${docs.length} BizDocuments with amounts\n`);

  let updated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const total = Number(doc.amountTotal);
    if (!total || total <= 0) { skipped++; continue; }

    const cp = doc.counterparty;
    const country = cp?.country || 'BG';
    const hasVatReg = !!(cp?.vat);
    const isIndividual = cp?.isIndividual || false;

    // Already has both set
    if (doc.vatAmount != null && doc.amountNet != null) { skipped++; continue; }

    let vatAmount = null;
    let amountNet = null;

    if (doc.docType === 'INVOICE_IN') {
      if (country === 'BG' || hasVatReg) {
        // Bulgarian or VAT-registered: assume VAT included in total (20%)
        vatAmount = total / 6;
        amountNet = total - vatAmount;
      } else {
        // EU supplier: reverse charge, VAT=0
        vatAmount = 0;
        amountNet = total;
      }
    } else if (doc.docType === 'INVOICE_OUT' || doc.docType === 'OFFER_OUT') {
      if (!isIndividual) {
        // B2B: VAT included
        vatAmount = total / 6;
        amountNet = total - vatAmount;
      } else {
        // B2C individual: total is gross, VAT included
        vatAmount = total / 6;
        amountNet = total - vatAmount;
      }
    }

    if (vatAmount !== null) {
      const updates = {};
      if (doc.vatAmount == null) updates.vatAmount = parseFloat(vatAmount.toFixed(2));
      if (doc.amountNet == null) updates.amountNet = parseFloat(amountNet.toFixed(2));

      if (Object.keys(updates).length > 0) {
        await p.bizDocument.update({ where: { id: doc.id }, data: updates });
        updated++;
        if (updated <= 30 || updated % 50 === 0) {
          console.log(`  ✓ ${doc.docType} ${doc.docNumber || doc.id.slice(-6)} [${cp?.name?.slice(0, 30)}]: net=${amountNet?.toFixed(2)} vat=${vatAmount?.toFixed(2)}`);
        }
      } else {
        skipped++;
      }
    } else {
      skipped++;
    }
  }

  console.log(`\nUpdated: ${updated} | Skipped: ${skipped}`);

  // Summary
  const withVat = await p.bizDocument.count({ where: { vatAmount: { not: null } } });
  const totalDocs = await p.bizDocument.count();
  console.log(`\nBizDocs with vatAmount: ${withVat} / ${totalDocs}`);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
