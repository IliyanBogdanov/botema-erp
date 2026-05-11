/**
 * Import historical invoices from the accounting XLS export.
 * File: history invoices/IssuedInvoices-(11.05.2026-14-05).xls
 *
 * Usage: node scripts/importHistoryInvoices.js [--dry-run]
 * Idempotent: upserts by invoice number.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const XLS_PATH = path.resolve(__dirname, '../../history invoices/IssuedInvoices-(11.05.2026-14-05).xls');

// Parse Bulgarian date "07.05.2026" → Date
function parseBGDate(str) {
  if (!str) return null;
  const m = String(str).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T00:00:00.000Z`);
}

// Determine invoice status from остатък (remaining) and paid
function getStatus(total, paid, remaining) {
  const rem = parseFloat(remaining) || 0;
  const tot = parseFloat(total) || 0;
  if (rem === 0 && tot > 0) return 'PAID';
  if (rem > 0 && parseFloat(paid) > 0) return 'PENDING'; // partially paid → still pending
  return 'PENDING';
}

async function findOrCreateClient(partnerName, eik) {
  if (!partnerName) return null;
  const name = partnerName.trim();
  const vatNo = eik ? String(eik).trim().replace(/\s+/g, '') : null;

  // Try by EIK first
  if (vatNo) {
    const byEik = await prisma.client.findFirst({ where: { eik: vatNo } });
    if (byEik) return byEik.id;
    const byVat = await prisma.client.findFirst({ where: { vat: vatNo } });
    if (byVat) return byVat.id;
  }

  // Try by name (case-insensitive)
  const byName = await prisma.client.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (byName) return byName.id;

  if (DRY_RUN) return null;

  // Create new client
  const created = await prisma.client.create({
    data: {
      name,
      eik: vatNo || null,
      type: 'COMPANY',
      brand: 'STUDIO_BOTEMA',
    },
  });
  return created.id;
}

async function main() {
  console.log(`📂 Reading: ${XLS_PATH}`);
  const wb = xlsx.readFile(XLS_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

  // Data rows start at index 7, filter only rows with 10-digit invoice numbers
  const dataRows = rows.slice(7).filter(r => r[0] && String(r[0]).match(/^\d{10}$/));
  console.log(`📊 Found ${dataRows.length} invoices in XLS`);

  // Get all existing invoice numbers from DB
  const existing = await prisma.invoice.findMany({ select: { number: true } });
  const existingNums = new Set(existing.map(i => i.number));
  console.log(`📊 Already in DB: ${existingNums.size} invoices`);

  const toImport = dataRows.filter(r => !existingNums.has(String(r[0])));
  console.log(`📊 To import: ${toImport.length} invoices${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  let imported = 0;
  let errors = 0;

  for (const row of toImport) {
    const [number, dateStr, docType, , eik, partnerName, , netRaw, vatRaw, totalRaw, paidRaw, remRaw, , currency] = row;

    const invoiceDate = parseBGDate(dateStr);
    if (!invoiceDate) {
      console.warn(`⚠️  Skip ${number}: invalid date "${dateStr}"`);
      continue;
    }

    const amountNet   = parseFloat(netRaw)   || 0;
    const vatAmount   = parseFloat(vatRaw)   || 0;
    const amountTotal = parseFloat(totalRaw) || 0;
    const status      = getStatus(amountTotal, paidRaw, remRaw);
    const curr        = (currency || 'BGN').trim().toUpperCase();

    // Determine brand from обект (object/brand column, index 6)
    const brand = String(row[6] || '').toUpperCase().includes('LUMINA')
      ? 'LUMINA_VERA'
      : 'STUDIO_BOTEMA';

    try {
      const clientId = await findOrCreateClient(partnerName, eik);

      if (!DRY_RUN) {
        await prisma.invoice.upsert({
          where: { number: String(number) },
          update: {
            date: invoiceDate,
            clientId,
            status,
            currency: curr,
            amountNet,
            vatAmount,
            amountTotal,
          },
          create: {
            number: String(number),
            date: invoiceDate,
            clientId,
            type: 'INVOICE',
            status,
            brand,
            currency: curr,
            amountNet,
            vatAmount,
            amountTotal,
            description: `${docType || 'Фактура'} — ${partnerName || ''}`.trim(),
          },
        });
      }

      imported++;
      if (imported % 20 === 0 || imported <= 5) {
        console.log(`  ✓ ${number} | ${dateStr} | ${partnerName} | ${amountTotal} ${curr} | ${status}`);
      }
    } catch (err) {
      errors++;
      console.error(`  ✗ ${number}: ${err.message}`);
    }
  }

  console.log(`\n✅ Done: ${imported} imported, ${errors} errors`);

  if (!DRY_RUN) {
    const total = await prisma.invoice.count();
    console.log(`📊 Total invoices in DB: ${total}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
