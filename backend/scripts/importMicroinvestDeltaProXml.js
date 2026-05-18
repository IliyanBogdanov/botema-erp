require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const XML_PATH = path.resolve(__dirname, '../../bank statements and docs/Export_MicroinvestDeltaPro_2026-05-18-15-44.xml');
const NOTE = 'Imported from Microinvest Delta Pro XML';

function parseAttributes(blob) {
  return Object.fromEntries(
    [...String(blob || '').matchAll(/([A-Za-z0-9/]+)="([^"]*)"/g)].map(m => [m[1], m[2]]),
  );
}

function parseNumber(value) {
  const n = Number(String(value || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseXml(xml) {
  const rows = [];
  const re = /<Accounting\s+([^>]+)>\s*<Document\s+Date="([^"]+)"\s+Number="([^"]+)"\s+DocumentType="([^"]+)"\/>\s*<Company\s+Name="([^"]*)"[^>]*>[\s\S]*?<AccountingDetails>([\s\S]*?)<\/AccountingDetails>/g;
  for (const match of xml.matchAll(re)) {
    const accounting = parseAttributes(match[1]);
    const details = [...match[6].matchAll(/<AccountingDetail\s+([^>]+)\/>/g)].map(d => parseAttributes(d[1]));
    const directionCredit = details.find(d => d.Direction === 'Credit');
    const directionDebit = details.find(d => d.Direction === 'Debit');
    const tax = details.find(d => d.AccountNumber === '453/1' || d.AccountNumber === '453/2');
    const amount = directionCredit ? parseNumber(directionCredit.Amount) : parseNumber(directionDebit?.Amount);
    const vat = tax ? parseNumber(tax.Amount) : 0;
    const net = tax ? Math.round((amount - vat) * 100) / 100 : amount;

    rows.push({
      term: accounting.Term,
      accountingDate: accounting.AccountingDate,
      dueDate: accounting.DueDate,
      reference: accounting.Reference || '',
      date: match[2],
      number: match[3],
      company: match[5],
      amount,
      net,
      vat,
      details,
    });
  }
  return rows;
}

async function findOrCreateClient(name) {
  if (!name) return null;
  const existing = await prisma.client.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;
  const created = await prisma.client.create({
    data: { name, type: 'COMPANY', brand: 'STUDIO_BOTEMA', notes: 'auto-created from Microinvest XML' },
    select: { id: true },
  });
  return created.id;
}

async function findOrCreateCounterparty(name, type) {
  if (!name) return null;
  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;
  const created = await prisma.counterparty.create({
    data: {
      name,
      type,
      country: 'BG',
      currency: 'BGN',
      notes: 'auto-created from Microinvest XML',
    },
    select: { id: true },
  });
  return created.id;
}

async function findOrCreateSupplier(name) {
  if (!name) return null;
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;
  const created = await prisma.supplier.create({
    data: { name, currency: 'BGN', notes: 'auto-created from Microinvest XML' },
    select: { id: true },
  });
  return created.id;
}

async function upsertOutgoing(row) {
  const clientId = await findOrCreateClient(row.company);
  const counterpartyId = await findOrCreateCounterparty(row.company, 'CLIENT');
  const existingInvoice = await prisma.invoice.findUnique({
    where: { number: row.number },
    select: { id: true },
  });
  const existingBiz = await prisma.bizDocument.findFirst({
    where: { docType: 'INVOICE_OUT', docNumber: row.number },
    select: { id: true },
  });

  const invoiceData = {
    date: new Date(row.date),
    dueDate: new Date(row.dueDate || row.date),
    clientId: clientId || undefined,
    type: 'INVOICE',
    status: row.amount > 0 ? 'PAID' : 'CANCELLED',
    brand: 'STUDIO_BOTEMA',
    currency: 'BGN',
    amountNet: new Prisma.Decimal(row.net),
    vatAmount: new Prisma.Decimal(row.vat),
    amountTotal: new Prisma.Decimal(row.amount),
    description: row.reference || `Microinvest XML ${row.number}`,
    notes: NOTE,
  };

  const bizData = {
    counterpartyId: counterpartyId || undefined,
    docType: 'INVOICE_OUT',
    docNumber: row.number,
    docDate: new Date(row.date),
    dueDate: new Date(row.dueDate || row.date),
    currency: 'BGN',
    amountNet: new Prisma.Decimal(row.net),
    vatAmount: new Prisma.Decimal(row.vat),
    amountTotal: new Prisma.Decimal(row.amount),
    vatType: 'STANDARD_BG',
    status: row.amount > 0 ? 'MATCHED' : 'REJECTED',
    confidence: new Prisma.Decimal(100),
    notes: NOTE,
  };

  if (APPLY) {
    if (existingInvoice) await prisma.invoice.update({ where: { id: existingInvoice.id }, data: invoiceData });
    else await prisma.invoice.create({ data: { number: row.number, ...invoiceData } });

    if (existingBiz) await prisma.bizDocument.update({ where: { id: existingBiz.id }, data: bizData });
    else await prisma.bizDocument.create({ data: bizData });
  }

  return {
    kind: 'OUT',
    number: row.number,
    company: row.company,
    invoice: existingInvoice ? 'update' : 'create',
    bizdoc: existingBiz ? 'update' : 'create',
  };
}

async function upsertIncoming(row) {
  const supplierId = await findOrCreateSupplier(row.company);
  const counterpartyId = await findOrCreateCounterparty(row.company, 'SUPPLIER');
  const existingPurchase = supplierId
    ? await prisma.purchase.findFirst({
        where: { invoiceNo: row.number, supplierId },
        select: { id: true },
      })
    : null;
  const existingBiz = await prisma.bizDocument.findFirst({
    where: { docType: 'INVOICE_IN', docNumber: row.number },
    select: { id: true },
  });

  const purchaseData = {
    invoiceNo: row.number,
    date: new Date(row.date),
    supplierId,
    currency: 'BGN',
    amount: new Prisma.Decimal(row.amount),
    description: row.reference || `Microinvest XML ${row.number}`,
    status: 'PAID',
    year: new Date(row.date).getFullYear(),
  };

  const bizData = {
    counterpartyId: counterpartyId || undefined,
    docType: 'INVOICE_IN',
    docNumber: row.number,
    docDate: new Date(row.date),
    dueDate: new Date(row.dueDate || row.date),
    currency: 'BGN',
    amountNet: new Prisma.Decimal(row.net),
    vatAmount: new Prisma.Decimal(row.vat),
    amountTotal: new Prisma.Decimal(row.amount),
    vatType: 'STANDARD_BG',
    status: 'IMPORTED',
    confidence: new Prisma.Decimal(100),
    notes: NOTE,
  };

  if (APPLY) {
    if (existingPurchase) await prisma.purchase.update({ where: { id: existingPurchase.id }, data: purchaseData });
    else await prisma.purchase.create({ data: purchaseData });

    if (existingBiz) await prisma.bizDocument.update({ where: { id: existingBiz.id }, data: bizData });
    else await prisma.bizDocument.create({ data: bizData });
  }

  return {
    kind: 'IN',
    number: row.number,
    company: row.company,
    purchase: existingPurchase ? 'update' : 'create',
    bizdoc: existingBiz ? 'update' : 'create',
  };
}

async function main() {
  console.log(`=== IMPORT MICROINVEST DELTA PRO XML${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);
  if (!fs.existsSync(XML_PATH)) {
    throw new Error(`Missing XML: ${XML_PATH}`);
  }

  const xml = fs.readFileSync(XML_PATH, 'utf8');
  const rows = parseXml(xml);
  const missing = [];

  for (const row of rows) {
    if (row.term === 'Продажба') {
      const exists = await prisma.invoice.findUnique({ where: { number: row.number }, select: { id: true } });
      if (!exists) missing.push(row);
    } else if (row.term === 'Доставка') {
      const exists = await prisma.bizDocument.findFirst({ where: { docType: 'INVOICE_IN', docNumber: row.number }, select: { id: true } });
      if (!exists) missing.push(row);
    }
  }

  console.log({
    parsed: rows.length,
    missing: missing.length,
    byTerm: rows.reduce((acc, row) => {
      acc[row.term] = (acc[row.term] || 0) + 1;
      return acc;
    }, {}),
  });

  for (const row of missing) {
    console.log({
      term: row.term,
      number: row.number,
      company: row.company,
      amount: row.amount,
      net: row.net,
      vat: row.vat,
      reference: row.reference,
    });
  }

  if (!APPLY) return;

  const results = [];
  for (const row of missing) {
    if (row.term === 'Продажба') results.push(await upsertOutgoing(row));
    if (row.term === 'Доставка') results.push(await upsertIncoming(row));
  }

  console.log({ imported: results.length, results });
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
