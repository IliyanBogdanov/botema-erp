require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const START_DATE = new Date(process.argv[2] || '2024-11-01T00:00:00.000Z');
const BGN_PER_EUR = 1.95583;
const AUTHORITATIVE_BIZ_DOC_STATUSES = ['REVIEWED', 'IMPORTED', 'MATCHED'];
const WEAK_DOC_NUMBERS = new Set([
  'оригинал',
  'original',
  'no',
  'no.',
  'number',
  'page',
  'pro',
  'puv',
  'та.',
  'effect.',
  'italy',
  'familiar',
  'трябва',
]);
const NON_INVOICE_MARKERS = [
  'price',
  'listino',
  'catalog',
  'portfolio',
  'quotation',
  'bank',
  'statement',
  'извлечение',
  'превод',
];

const toNumber = value => Number(value || 0);
const toEur = (amount, currency) => String(currency).toUpperCase() === 'BGN'
  ? toNumber(amount) / BGN_PER_EUR
  : toNumber(amount);

function sourceDateWhere(field = 'receivedAt') {
  return {
    OR: [
      { [field]: { gte: START_DATE } },
      { createdAt: { gte: START_DATE } },
    ],
  };
}

function docKeyForSourceFile(sourceFile) {
  if (sourceFile.type === 'DRIVE') return sourceFile.driveFileId || null;
  if (sourceFile.type === 'GMAIL') {
    const raw = String(sourceFile.gmailMsgId || '');
    let messageId = raw;
    if (raw.includes(':')) messageId = raw.split(':')[0];
    else if (raw.length >= 17) messageId = raw.substring(0, 16);
    return messageId ? `gmail:${messageId}:${sourceFile.filename}` : null;
  }
  return null;
}

function sourceFileFilter(row) {
  const text = `${row.filename || ''} ${row.folder || ''} ${row.subject || ''}`.toLowerCase();
  const nonFinancial = [
    'price list',
    'pricelist',
    'catalogue',
    'catalog',
    'brochure',
    'technical sheet',
    'базови цени',
    'ценова листа',
    'каталог',
    'брошура',
  ].some(marker => text.includes(marker));
  return !nonFinancial;
}

function qualityReasonsForBizDoc(row) {
  const reasons = [];
  const docNumber = String(row.docNumber || '').trim().toLowerCase();
  const amount = toNumber(row.amountTotal);
  const confidence = toNumber(row.confidence);
  const sourceText = `${row.sourceFile?.filename || ''} ${row.sourceFile?.folder || ''}`.toLowerCase();

  if (row.sourceFile && (!docNumber || WEAK_DOC_NUMBERS.has(docNumber))) reasons.push('weak_doc_number');
  if (!row.docDate) reasons.push('missing_doc_date');
  if (!row.currency) reasons.push('missing_currency');
  if (!amount || amount <= 0) reasons.push('missing_amount');
  if (amount > 250000) reasons.push('huge_amount');
  if (confidence > 0 && confidence < 80) reasons.push('low_confidence');
  if (NON_INVOICE_MARKERS.some(marker => sourceText.includes(marker))) reasons.push('non_invoice_source_hint');
  return reasons;
}

async function main() {
  const sourceFiles = await prisma.sourceFile.findMany({
    where: {
      ...sourceDateWhere(),
      OR: [
        { filename: { endsWith: '.pdf', mode: 'insensitive' } },
        { mimeType: { contains: 'pdf', mode: 'insensitive' } },
      ],
      AND: [{
        OR: [
          { type: 'DRIVE', driveFileId: { not: null } },
          { type: 'GMAIL', gmailMsgId: { not: null } },
        ],
      }],
    },
    select: {
      id: true,
      type: true,
      filename: true,
      folder: true,
      subject: true,
      notes: true,
      driveFileId: true,
      gmailMsgId: true,
      receivedAt: true,
      createdAt: true,
    },
  });
  const financialSources = sourceFiles.filter(sourceFileFilter);
  const keys = financialSources.map(docKeyForSourceFile).filter(Boolean);
  const parsedDocs = keys.length ? await prisma.document.findMany({
    where: {
      driveFileId: { in: keys },
      extractedData: { path: ['mineruRunId'], equals: 'mineru-only-full-20260702' },
    },
    select: { driveFileId: true, confidence: true, status: true, extractedData: true },
  }) : [];
  const parsedKeys = new Set(parsedDocs.map(d => d.driveFileId));
  const remainingSources = financialSources.filter(row => !parsedKeys.has(docKeyForSourceFile(row)));

  const authoritativeInvoiceIn = await prisma.bizDocument.findMany({
    where: {
      docType: 'INVOICE_IN',
      status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
      amountTotal: { gt: 0 },
      docDate: { gte: START_DATE },
    },
    select: {
      id: true,
      docNumber: true,
      docDate: true,
      currency: true,
      amountTotal: true,
      confidence: true,
      status: true,
      sourceFile: { select: { filename: true, folder: true } },
    },
  });
  const badInvoiceIn = authoritativeInvoiceIn
    .map(row => ({ row, reasons: qualityReasonsForBizDoc(row) }))
    .filter(item => item.reasons.length);

  const invoiceInTotalEur = authoritativeInvoiceIn.reduce((sum, row) => sum + toEur(row.amountTotal, row.currency), 0);

  const [
    paymentsTotal,
    paymentsMatched,
    paymentsUnmatched,
    invoicesTotal,
    invoicesPaid,
    invoicesPending,
    bizDocTotal,
  ] = await Promise.all([
    prisma.payment.count(),
    prisma.payment.count({ where: { status: 'MATCHED' } }),
    prisma.payment.count({ where: { status: 'UNMATCHED' } }),
    prisma.invoice.count({ where: { status: { not: 'CANCELLED' } } }),
    prisma.invoice.count({ where: { status: 'PAID' } }),
    prisma.invoice.count({ where: { status: 'PENDING' } }),
    prisma.bizDocument.count(),
  ]);

  const duplicateGroups = await prisma.$queryRaw`
    SELECT
      "docType",
      COALESCE("docNumber", '') AS "docNumber",
      currency,
      ROUND(COALESCE("amountTotal", 0)::numeric, 2)::text AS amount,
      COUNT(*)::int AS count
    FROM biz_documents
    WHERE status IN ('REVIEWED', 'IMPORTED', 'MATCHED')
      AND "docNumber" IS NOT NULL
      AND "amountTotal" > 0
    GROUP BY 1, 2, 3, 4
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 25
  `;

  const coveragePct = financialSources.length
    ? parsedDocs.length / financialSources.length * 100
    : 100;
  const invoiceQualityPct = authoritativeInvoiceIn.length
    ? (authoritativeInvoiceIn.length - badInvoiceIn.length) / authoritativeInvoiceIn.length * 100
    : 100;
  const bankReconPct = paymentsTotal ? paymentsMatched / paymentsTotal * 100 : 100;
  const invoicePaidPct = invoicesTotal ? invoicesPaid / invoicesTotal * 100 : 100;

  console.log(JSON.stringify({
    periodStart: START_DATE.toISOString().slice(0, 10),
    sourceCoverage: {
      financialPdfSources: financialSources.length,
      mineruParsed: parsedDocs.length,
      remaining: remainingSources.length,
      coveragePct: Number(coveragePct.toFixed(2)),
      remainingSample: remainingSources.slice(0, 25).map(row => ({
        id: row.id,
        type: row.type,
        filename: row.filename,
        failed: String(row.notes || '').includes('[MINERU_FAILED]'),
      })),
    },
    authoritativeCosts: {
      invoiceInCount: authoritativeInvoiceIn.length,
      invoiceInTotalEur: Number(invoiceInTotalEur.toFixed(2)),
      qualityPct: Number(invoiceQualityPct.toFixed(2)),
      questionableCount: badInvoiceIn.length,
      questionableSample: badInvoiceIn.slice(0, 25).map(({ row, reasons }) => ({
        id: row.id,
        docNumber: row.docNumber,
        amount: Number(row.amountTotal),
        currency: row.currency,
        date: row.docDate?.toISOString().slice(0, 10),
        status: row.status,
        filename: row.sourceFile?.filename,
        reasons,
      })),
    },
    reconciliation: {
      paymentsTotal,
      paymentsMatched,
      paymentsUnmatched,
      bankReconPct: Number(bankReconPct.toFixed(2)),
    },
    invoices: {
      invoicesTotal,
      invoicesPaid,
      invoicesPending,
      invoicePaidPct: Number(invoicePaidPct.toFixed(2)),
    },
    totals: {
      bizDocTotal,
      duplicateGroups: duplicateGroups.length,
      duplicateSample: duplicateGroups,
    },
  }, null, 2));
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
