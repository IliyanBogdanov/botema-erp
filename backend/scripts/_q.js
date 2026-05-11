const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = new PrismaClient();
async function main() {
  const xlsx = require('xlsx');
  const wb = xlsx.readFile(require('path').join(__dirname, '../../history invoices/IssuedInvoices-(11.05.2026-14-05).xls'));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });
  // Find header row (row 6)
  const dataRows = rows.slice(7).filter(r => r[0] && String(r[0]).match(/^\d{10}$/));
  console.log('XLS data rows:', dataRows.length);
  console.log('First:', JSON.stringify(dataRows[0]));
  console.log('Last:', JSON.stringify(dataRows[dataRows.length-1]));
  // Get all numbers from XLS
  const xlsNums = new Set(dataRows.map(r => String(r[0]).padStart(10, '0')));
  // Get all from DB
  const dbInvoices = await prisma.invoice.findMany({ select: { number: true } });
  const dbNums = new Set(dbInvoices.map(i => i.number));
  // Find missing
  const missing = [...xlsNums].filter(n => !dbNums.has(n));
  const extra = [...dbNums].filter(n => !xlsNums.has(n));
  console.log('In XLS:', xlsNums.size, '| In DB:', dbNums.size);
  console.log('Missing from DB:', missing.length, missing.slice(0, 10));
  console.log('In DB not in XLS:', extra.length, extra.slice(0, 5));
}
main().catch(console.error).finally(() => prisma.$disconnect());
