// Import issued invoices from XLS accounting export
// Upserts by invoice number - safe to re-run
require('dotenv').config();
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const prisma = new PrismaClient();

function parseDate(str) {
  if (!str) return null;
  const [d, m, y] = str.split('.');
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
}

function detectBrand(obj) {
  if (!obj) return 'STUDIO_BOTEMA';
  const s = String(obj).replace(/\s+/g, '').toUpperCase();
  if (s.includes('LUMINAVERA') || s.includes('LUMINA')) return 'LUMINAVERA';
  return 'STUDIO_BOTEMA';
}

function detectStatus(paid, remaining) {
  const rem = parseFloat(remaining) || 0;
  if (rem <= 0) return 'PAID';
  return 'PENDING';
}

async function main() {
  const filePath = path.join(__dirname, '../../history invoices/IssuedInvoices-(11.05.2026-14-05).xls');
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  let created = 0, updated = 0, skipped = 0;

  for (let i = 7; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0] || !String(row[0]).match(/^\d+$/)) continue;

    const invoiceNum = String(row[0]).replace(/^0+/, '') || row[0]; // strip leading zeros for display
    const paddedNum = String(row[0]); // keep original padded
    const dateStr = String(row[1] || '');
    const partnerName = String(row[5] || '').trim();
    const brandObj = row[6];
    const amountNet = parseFloat(row[7]) || 0;
    const vatAmount = parseFloat(row[8]) || 0;
    const amountTotal = parseFloat(row[9]) || 0;
    const paidAmount = parseFloat(row[10]) || 0;
    const remaining = parseFloat(row[11]) || 0;
    const currency = String(row[13] || 'BGN').trim();

    const invoiceDate = parseDate(dateStr);
    if (!invoiceDate) { skipped++; continue; }

    const brand = detectBrand(brandObj);
    const status = detectStatus(paidAmount, remaining);

    // Try to find existing client by name
    let clientId = null;
    if (partnerName) {
      const client = await prisma.client.findFirst({
        where: { name: { contains: partnerName.slice(0, 20), mode: 'insensitive' } },
        select: { id: true },
      });
      if (client) clientId = client.id;
    }

    const data = {
      number: paddedNum,
      date: invoiceDate,
      type: 'INVOICE',
      status,
      brand,
      currency,
      amountNet: amountNet,
      vatAmount: vatAmount,
      amountTotal: amountTotal,
      description: partnerName || null,
      clientId,
    };

    try {
      const existing = await prisma.invoice.findUnique({ where: { number: paddedNum } });
      if (existing) {
        // Update status if changed
        if (existing.status !== status) {
          await prisma.invoice.update({ where: { number: paddedNum }, data: { status } });
          updated++;
        } else {
          skipped++;
        }
      } else {
        await prisma.invoice.create({ data });
        created++;
        console.log(`  ✅ Created invoice #${paddedNum} (${dateStr}) ${partnerName} ${amountTotal} ${currency}`);
      }
    } catch (err) {
      console.error(`  ❌ Error on ${paddedNum}:`, err.message);
    }
  }

  console.log(`\nDone: created=${created}, updated=${updated}, skipped=${skipped}`);

  // Final count
  const total = await prisma.invoice.count();
  console.log(`Total invoices in DB: ${total}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
