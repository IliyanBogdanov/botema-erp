/**
 * Finds and rejects BizDocument INVOICE_IN records that were wrongly created
 * from Drive "remaining" folders — specifically outgoing proformas and salary docs
 * that Gemini classified as PROFORMA but the script stored as INVOICE_IN.
 *
 * Criteria: notes contain "Drive:" AND (docNumber matches 1717.* pattern OR
 * supplierName is null and docNumber looks like an outgoing series)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`=== FIX PROFORMA BIZDOCS${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);

  // Find Drive-sourced INVOICE_IN BizDocs created in "remaining" mode
  // that look like outgoing documents (1717.XXX series from HR/salary system)
  const suspects = await prisma.bizDocument.findMany({
    where: {
      docType: 'INVOICE_IN',
      status: 'IMPORTED',
      notes: { contains: 'Drive:', mode: 'insensitive' },
    },
    select: { id: true, docNumber: true, amountTotal: true, currency: true, notes: true, counterpartyId: true, docDate: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  // Filter: outgoing documents by docNumber pattern or folder name in notes
  const KEEP_PATTERNS = ['входящи', 'sedap', 'ателие седап', 'atelier sedap', 'лодес фактури', 'lodes', 'formani', 'zieta', 'polaris', 'omega', 'омега', 'speedy', 'alog', 'dhl', 'aka ', 'ака'];
  const wrongOnes = suspects.filter(b => {
    const num = b.docNumber || '';
    const notes = (b.notes || '').toLowerCase();
    // Safe: if folder/notes contain known incoming supplier keywords → KEEP
    if (KEEP_PATTERNS.some(p => notes.includes(p))) return false;
    // 1717.XXX = salary/HR system outgoing documents → REJECT
    if (/^1717\.\d+$/.test(num)) return true;
    // "Изходящи фактури" folder = outgoing invoices → REJECT
    if (notes.includes('изходящ')) return true;
    // "Оферти" folder = client offers → REJECT
    if (notes.includes('/оферти') || notes.includes('/оферт')) return true;
    // Folder starts with "Проформ" = outgoing offer folder → REJECT
    if (/\/проформ/i.test(b.notes || '')) return true;
    // Proforma-Invoice-XXXXXXX filename = from 1717 system outgoing → REJECT
    if (/Proforma-Invoice-\d{10}/i.test(b.notes || '')) return true;
    // "Проформа Студио Ботема" = Botema's own proforma → REJECT
    if (notes.includes('проформа студио ботема')) return true;
    return false;
  });

  console.log(`Drive IMPORTED INVOICE_IN (recent): ${suspects.length}`);
  console.log(`Suspected wrong (1717.XXX pattern): ${wrongOnes.length}`);
  wrongOnes.forEach(b => console.log(`  ${b.id} | ${b.docNumber} | ${b.amountTotal} ${b.currency} | ${b.notes?.substring(0, 60)}`));

  if (APPLY && wrongOnes.length > 0) {
    const result = await prisma.bizDocument.updateMany({
      where: { id: { in: wrongOnes.map(b => b.id) } },
      data: { status: 'REJECTED' },
    });
    console.log(`\nREJECTED ${result.count} wrong BizDocs`);
  }

  // Show all recently created Drive BizDocs for review
  console.log('\nAll recent Drive IMPORTED INVOICE_IN (last 20):');
  suspects.slice(0, 20).forEach(b => console.log(`  ${b.docNumber} | ${b.amountTotal} ${b.currency} | cp=${b.counterpartyId} | ${b.notes?.substring(0, 60)}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
