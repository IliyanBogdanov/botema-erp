require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const PDF_PATH = path.resolve(__dirname, '../../bank statements and docs/invoices old .pdf');
const NOTE = 'Imported from InvoicePro export';

function normalizeName(name) {
  return String(name || '').trim().replace(/^"+|"+$/g, '').replace(/\s+/g, ' ');
}

function parseAmountToken(token) {
  const cleaned = String(token || '').replace(/\s/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseTotalFromTail(tail) {
  const matches = String(tail || '').match(/\d[\d\s]*[.,]\d{2}/g);
  if (!matches || matches.length === 0) return null;
  return parseAmountToken(matches[matches.length - 1]);
}

function deriveVatSplit(total) {
  if (!Number.isFinite(total) || total <= 0) return { net: 0, vat: 0 };
  const net = Math.round((total / 1.2) * 100) / 100;
  const vat = Math.round((total - net) * 100) / 100;
  return { net, vat };
}

function parseDate(value) {
  const [dd, mm, yyyy] = String(value || '').split('.');
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function appendNote(existing, extra) {
  if (!existing) return extra;
  if (existing.includes(extra)) return existing;
  return `${existing} | ${extra}`;
}

function parseRows(text) {
  const lines = text.replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const m = line.match(/^(Проформа\s+)?Фактура(\d{10})(\d{2}\.\d{2}\.\d{4})(\d{2}\.\d{2}\.\d{4})(.*?)(Банков път|Наложен платеж)(.*?)\s*([0-9][0-9\s.,]*) BGN$/);
    if (!m) continue;
    rows.push({
      docType: m[1] ? 'PROFORMA_OUT' : 'INVOICE_OUT',
      docNumber: m[2],
      issueDate: parseDate(m[3]),
      taxDate: parseDate(m[4]),
      counterpartyName: normalizeName(m[5]),
      paymentMethod: m[6],
      total: parseTotalFromTail(m[8]),
      rawLine: line,
    });
  }
  return rows;
}

function inferClientType(name) {
  const upper = String(name || '').toUpperCase();
  if (upper.includes(' ЕТ ') || upper.startsWith('ЕТ ')) return 'ET';
  if (/ООД|ЕООД|АД|КД|СД|ОД/iu.test(upper)) return 'COMPANY';
  return 'PERSON';
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
    data: {
      name,
      type: inferClientType(name),
      brand: 'STUDIO_BOTEMA',
      notes: 'auto-created from InvoicePro export',
    },
    select: { id: true },
  });
  return created.id;
}

async function findOrCreateBizCounterparty(name) {
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
      type: 'CLIENT',
      country: 'BG',
      currency: 'BGN',
      notes: 'auto-created from InvoicePro export',
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertInvoice(row, clientId) {
  const total = row.total ?? 0;
  const { net, vat } = deriveVatSplit(total);
  const existing = await prisma.invoice.findUnique({ where: { number: row.docNumber } });
  const data = {
    date: row.issueDate || new Date(),
    clientId: clientId || undefined,
    type: 'INVOICE',
    status: 'PAID',
    brand: 'STUDIO_BOTEMA',
    currency: 'BGN',
    amountNet: new Prisma.Decimal(net),
    vatAmount: new Prisma.Decimal(vat),
    amountTotal: new Prisma.Decimal(total),
    description: `${row.counterpartyName} | ${row.paymentMethod} | InvoicePro export`,
    notes: appendNote(existing?.notes || '', NOTE),
  };
  if (existing) {
    if (!APPLY) return { action: 'update', id: existing.id };
    await prisma.invoice.update({ where: { id: existing.id }, data });
    return { action: 'update', id: existing.id };
  }
  if (!APPLY) return { action: 'create', number: row.docNumber };
  const created = await prisma.invoice.create({
    data: { number: row.docNumber, ...data },
    select: { id: true },
  });
  return { action: 'create', id: created.id };
}

async function upsertBizDocument(row, counterpartyId) {
  const total = row.total ?? 0;
  const { net, vat } = deriveVatSplit(total);
  const existing = await prisma.bizDocument.findFirst({
    where: { docType: row.docType, docNumber: row.docNumber },
    select: { id: true, notes: true, status: true },
  });
  const data = {
    counterpartyId: counterpartyId || undefined,
    docType: row.docType,
    docNumber: row.docNumber,
    docDate: row.issueDate || new Date(),
    dueDate: row.issueDate || new Date(),
    currency: 'BGN',
    amountNet: new Prisma.Decimal(net),
    vatAmount: new Prisma.Decimal(vat),
    amountTotal: new Prisma.Decimal(total),
    vatType: 'STANDARD_BG',
    status: row.docType === 'INVOICE_OUT' ? 'MATCHED' : 'IMPORTED',
    confidence: new Prisma.Decimal(100),
    notes: appendNote(existing?.notes || '', NOTE),
  };
  if (existing) {
    if (!APPLY) return { action: 'update', id: existing.id };
    await prisma.bizDocument.update({ where: { id: existing.id }, data });
    return { action: 'update', id: existing.id };
  }
  if (!APPLY) return { action: 'create', docNumber: row.docNumber, docType: row.docType };
  const created = await prisma.bizDocument.create({ data, select: { id: true } });
  return { action: 'create', id: created.id };
}

async function main() {
  console.log(`=== IMPORT INVOICEPRO EXPORT${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);
  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(`Missing PDF: ${PDF_PATH}`);
  }

  const text = (await pdfParse(fs.readFileSync(PDF_PATH))).text;
  const rows = parseRows(text);
  const summary = rows.reduce((acc, row) => {
    acc[row.docType] = (acc[row.docType] || 0) + 1;
    return acc;
  }, {});
  console.log('Parsed rows:', summary);

  const planned = { invoices: { create: 0, update: 0 }, bizdocs: { create: 0, update: 0 }, counterparties: 0 };
  for (const row of rows) {
    const clientId = await findOrCreateClient(row.counterpartyName);
    const counterpartyId = await findOrCreateBizCounterparty(row.counterpartyName);
    if (!counterpartyId && row.counterpartyName) planned.counterparties++;
    const inv = row.docType === 'INVOICE_OUT' ? await prisma.invoice.findUnique({ where: { number: row.docNumber }, select: { id: true } }) : null;
    const biz = await prisma.bizDocument.findFirst({ where: { docType: row.docType, docNumber: row.docNumber }, select: { id: true } });
    if (row.docType === 'INVOICE_OUT') {
      planned.invoices[inv ? 'update' : 'create']++;
    }
    planned.bizdocs[biz ? 'update' : 'create']++;
  }
  console.log(planned);

  if (!APPLY) return;

  for (const row of rows) {
    const clientId = await findOrCreateClient(row.counterpartyName);
    const counterpartyId = await findOrCreateBizCounterparty(row.counterpartyName);
    await upsertBizDocument(row, counterpartyId);
    if (row.docType === 'INVOICE_OUT') {
      await upsertInvoice(row, clientId);
    }
  }

  console.log({ imported: rows.length });
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
