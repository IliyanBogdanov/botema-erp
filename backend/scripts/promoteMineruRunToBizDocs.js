require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Prisma, PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const RUN_ID = argValue('--run-id', process.env.MINERU_RUN_ID || 'mineru-only-full-20260702');
const MIN_CONFIDENCE = Number(argValue('--min-confidence', '80'));
const ONLY_TYPE = argValue('--type', null);

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function norm(value) {
  return String(value || '').trim();
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asDecimal(value) {
  const n = toNumber(value);
  return n == null ? null : new Prisma.Decimal(n);
}

function confidencePercent(doc, data) {
  const raw = Number(doc.confidence ?? data.confidence ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return raw <= 1 ? raw * 100 : raw;
}

function inferBizDocType(doc, data) {
  const type = data.docType || data.type || doc.type;
  const text = `${doc.filename || ''} ${data.folder || ''} ${data.subject || ''} ${data.fromEmail || ''}`.toLowerCase();
  if (text.includes('транзакция') || text.includes('transaction')) return 'OTHER';
  if (text.includes('[ки]') || text.includes('credit note') || text.includes('кредитно известие')) return 'OTHER';

  const outgoingHints = [
    'operation-sale',
    'for-operation-sale',
    'изход',
    'outgoing',
    'issued',
    '1717.',
  ];
  const looksOutgoing = outgoingHints.some(h => text.includes(h));

  if (looksOutgoing && (type === 'INVOICE_IN' || type === 'INVOICE_OUT')) return 'INVOICE_OUT';
  if (looksOutgoing && (type === 'PROFORMA' || type === 'PROFORMA_IN' || type === 'PROFORMA_OUT')) return 'PROFORMA_OUT';
  if (type === 'INVOICE_IN') return 'INVOICE_IN';
  if (type === 'INVOICE_OUT') return 'INVOICE_OUT';
  if (type === 'PROFORMA_IN') return 'PROFORMA_IN';
  if (type === 'PROFORMA_OUT') return 'PROFORMA_OUT';
  if (type === 'DELIVERY_NOTE' || type === 'DELIVERY') return 'DELIVERY_NOTE';
  if (type === 'OFFER') return 'OFFER_IN';
  if (type === 'PROFORMA') {
    return looksOutgoing ? 'PROFORMA_OUT' : 'PROFORMA_IN';
  }
  return 'OTHER';
}

function isWeakDocNumber(value) {
  const clean = norm(value).toLowerCase();
  if (!clean) return true;
  return [
    'оригинал',
    'original',
    'no.',
    'no',
    'number',
    'page',
    'pro',
    'puv',
    'та.',
    'effect.',
    'italy',
    'трябва',
  ].includes(clean);
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function deriveDocNumber(data, filename) {
  const current = norm(data.invoiceNo || data.docNumber);
  const name = norm(filename);
  const trustedFilenameNumber = firstMatch(name, [
    /\[Ф\]\s*([0-9]{5,})/i,
    /Ф-ра\s*([0-9]{4,})/i,
    /ФАКТУРА[-_\s№No.]*([0-9]{4,})/i,
    /Фактура\s*№\s*([0-9]{3,})/i,
    /Faktura[_\s-]*([0-9]{3,})/i,
    /INV[-\s]*([0-9]{3,})/i,
    /Invoice[-_\s]*([0-9]{4,})/i,
    /(SOFI[0-9]{6,})/i,
    /No\.?\s*([0-9]{4,})/i,
  ]);
  if (trustedFilenameNumber) return trustedFilenameNumber;
  if (!isWeakDocNumber(current)) return current;

  const derived = firstMatch(name, [
    /^([0-9]{4,})[_\s-]/i,
    /^([0-9]{7,})\.pdf$/i,
  ]);
  return derived || current;
}

function counterpartyTypeFor(docType) {
  return docType.endsWith('_OUT') || docType === 'OFFER_OUT' ? 'CLIENT' : 'SUPPLIER';
}

function vatTypeFor(currency) {
  if (currency === 'BGN') return 'STANDARD_BG';
  if (currency === 'EUR') return 'EU_INTRA';
  return 'NON_VAT';
}

function docKey(docType, docNumber, currency, amountTotal) {
  return `${docType}|${docNumber}|${currency}|${Number(amountTotal).toFixed(2)}`;
}

async function findOrCreateCounterparty(name, type, currency) {
  const clean = norm(name);
  if (!clean) return null;

  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: clean, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;

  const created = await prisma.counterparty.create({
    data: { name: clean, type, currency: currency || 'EUR', country: currency === 'BGN' ? 'BG' : 'EU' },
    select: { id: true },
  });
  return created.id;
}

async function main() {
  console.log(`=== PROMOTE MINERU RUN TO BIZDOCS ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  console.log({ runId: RUN_ID, minConfidence: MIN_CONFIDENCE, onlyType: ONLY_TYPE || 'ALL' });

  const docs = await prisma.document.findMany({
    where: { extractedData: { path: ['mineruRunId'], equals: RUN_ID } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      driveFileId: true,
      filename: true,
      type: true,
      status: true,
      confidence: true,
      extractedData: true,
      suggestedAction: true,
    },
  });

  const sourceIds = [...new Set(docs.map(d => d.extractedData?.sourceFileId).filter(Boolean))];
  const sourceFiles = sourceIds.length
    ? await prisma.sourceFile.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, filename: true, folder: true, fromEmail: true, receivedAt: true },
      })
    : [];
  const sourceById = new Map(sourceFiles.map(sf => [sf.id, sf]));

  const existingBySource = sourceIds.length
    ? await prisma.bizDocument.findMany({
        where: { sourceFileId: { in: sourceIds }, status: { notIn: ['REJECTED', 'ARCHIVED'] } },
        select: { id: true, sourceFileId: true },
      })
    : [];
  const sourceToBiz = new Map(existingBySource.map(b => [b.sourceFileId, b.id]));

  const existingDocs = await prisma.bizDocument.findMany({
    where: {
      status: { notIn: ['REJECTED', 'ARCHIVED'] },
      docNumber: { not: null },
      amountTotal: { gt: 0 },
    },
    select: { id: true, docType: true, docNumber: true, currency: true, amountTotal: true },
  });
  const exactToBiz = new Map(existingDocs.map(b => [
    docKey(b.docType, b.docNumber, b.currency, b.amountTotal),
    b.id,
  ]));

  const stats = {
    totalDocs: docs.length,
    eligible: 0,
    created: 0,
    linkedExistingSource: 0,
    linkedExistingExact: 0,
    skippedLowConfidence: 0,
    skippedMissingFields: 0,
    skippedNonBusiness: 0,
    skippedTypeFilter: 0,
    byType: {},
    createByType: {},
  };
  const samples = [];

  for (const doc of docs) {
    const data = doc.extractedData || {};
    const docType = inferBizDocType(doc, data);
    stats.byType[docType] = (stats.byType[docType] || 0) + 1;

    if (ONLY_TYPE && docType !== ONLY_TYPE) {
      stats.skippedTypeFilter++;
      continue;
    }
    if (!['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_IN', 'PROFORMA_OUT', 'DELIVERY_NOTE'].includes(docType)) {
      stats.skippedNonBusiness++;
      continue;
    }

    const conf = confidencePercent(doc, data);
    if (conf < MIN_CONFIDENCE) {
      stats.skippedLowConfidence++;
      continue;
    }

    const docNumber = deriveDocNumber(data, doc.filename);
    const docDate = asDate(data.docDate || data.date);
    const amountTotal = toNumber(data.amountTotal ?? data.amount);
    const currency = norm(data.currency || 'EUR').toUpperCase();
    if (!docNumber || isWeakDocNumber(docNumber) || !docDate || !amountTotal || !currency) {
      stats.skippedMissingFields++;
      continue;
    }

    stats.eligible++;
    const sourceFileId = data.sourceFileId || null;
    const sourceFile = sourceById.get(sourceFileId);

    const sourceExistingId = sourceFileId ? sourceToBiz.get(sourceFileId) : null;
    if (sourceExistingId) {
      stats.linkedExistingSource++;
      if (APPLY && doc.status !== 'LINKED') {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            status: 'LINKED',
            processedAt: new Date(),
            extractedData: { ...data, bizDocumentId: sourceExistingId, mineruPromotedAt: new Date().toISOString() },
          },
        });
      }
      continue;
    }

    const exactKey = docKey(docType, docNumber, currency, amountTotal);
    const exactExistingId = exactToBiz.get(exactKey);
    if (exactExistingId) {
      stats.linkedExistingExact++;
      if (sourceFileId) sourceToBiz.set(sourceFileId, exactExistingId);
      if (APPLY) {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            status: 'LINKED',
            processedAt: new Date(),
            extractedData: { ...data, bizDocumentId: exactExistingId, mineruPromotedAt: new Date().toISOString() },
          },
        });
      }
      continue;
    }

    const counterpartyName = data.supplierName || data.clientName || data.counterpartyName || data.supplierOrBankName;
    const counterpartyId = await findOrCreateCounterparty(counterpartyName, counterpartyTypeFor(docType), currency);
    stats.createByType[docType] = (stats.createByType[docType] || 0) + 1;
    if (samples.length < 25) {
      samples.push({ docType, docNumber, amountTotal, currency, docDate: docDate.toISOString().slice(0, 10), conf, filename: doc.filename });
    }

    if (APPLY) {
      const created = await prisma.bizDocument.create({
        data: {
          sourceFileId,
          counterpartyId,
          docType,
          docNumber,
          docDate,
          dueDate: asDate(data.dueDate),
          currency,
          amountNet: asDecimal(data.amountNet ?? data.amount),
          vatAmount: asDecimal(data.vatAmount),
          amountTotal: asDecimal(amountTotal),
          vatType: vatTypeFor(currency),
          // Docs without a resolved counterparty must be human-reviewed before
          // they can count toward dashboard/VAT totals.
          status: conf >= 80 && counterpartyId ? 'REVIEWED' : 'NEEDS_REVIEW',
          confidence: new Prisma.Decimal(conf),
          notes: [
            `MinerU promoted ${new Date().toISOString()}: Document ${doc.id}`,
            sourceFile ? `${sourceFile.filename}` : doc.filename,
            conf < 90 ? `review: confidence ${conf.toFixed(1)}` : null,
          ].filter(Boolean).join(' | ').slice(0, 1000),
        },
        select: { id: true },
      });
      exactToBiz.set(exactKey, created.id);
      if (sourceFileId) sourceToBiz.set(sourceFileId, created.id);
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          status: 'LINKED',
          processedAt: new Date(),
          extractedData: { ...data, bizDocumentId: created.id, mineruPromotedAt: new Date().toISOString() },
        },
      });
    }
    stats.created++;
  }

  console.log(JSON.stringify({ stats, samples }, null, 2));
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
