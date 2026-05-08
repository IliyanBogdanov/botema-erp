require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/lib/prisma');
const {
  downloadDriveFile,
  parseDocumentWithAI,
  parseFromFilename,
  guessSupplierFromPath,
} = require('../src/lib/aiParser');

const BGN_PER_EUR = 1.95583;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function toNumber(value) {
  if (value == null || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/,/g, '.').replace(/\s+/g, '') : value;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function pickText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function extractFolderFromDriveUrl(driveUrl) {
  if (!driveUrl) return 'documents';
  const clean = String(driveUrl).split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join('/');
  return 'documents';
}

let aiGate = Promise.resolve();
let nextAiAt = 0;

async function waitForAiSlot() {
  const previousGate = aiGate;
  let releaseGate;
  aiGate = new Promise(resolve => {
    releaseGate = resolve;
  });

  await previousGate;
  const waitMs = Math.max(0, nextAiAt - Date.now());
  if (waitMs > 0) await sleep(waitMs);
  nextAiAt = Date.now() + 600;
  releaseGate();
}

async function parseWithRateLimit(filename, folder, buffer) {
  await waitForAiSlot();
  return parseDocumentWithAI(filename, folder, buffer);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const executing = new Set();

  for (const item of items) {
    const task = Promise.resolve().then(() => worker(item));
    executing.add(task);
    task.finally(() => executing.delete(task));

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled(executing);
}

function suggestedActionFor(docType) {
  if (docType === 'INVOICE_IN') return 'CREATE_PURCHASE';
  if (docType === 'INVOICE_OUT') return 'CREATE_INVOICE';
  return 'ARCHIVE_ONLY';
}

async function parsePurchases() {
  const purchases = await prisma.purchase.findMany({
    where: { amount: 0, driveFileId: { not: null } },
    include: { supplier: true },
    orderBy: [{ year: 'asc' }, { date: 'asc' }],
  });

  console.log(`Found ${purchases.length} purchases to parse`);

  let parsed = 0;
  let failed = 0;
  let skipped = 0;

  await mapWithConcurrency(purchases, 5, async (purchase) => {
    const label = `${purchase.id} (${purchase.supplier?.name || 'Unknown supplier'})`;

    try {
      console.log(`→ Parsing purchase ${label}, driveFileId=${purchase.driveFileId}`);
      const buffer = await downloadDriveFile(purchase.driveFileId);
      const folder = `${purchase.supplier?.name || 'supplier'}/${purchase.year}`;
      const filename = `${purchase.driveFileId}.pdf`;
      const result = await parseWithRateLimit(filename, folder, buffer);
      const amountTotal = toNumber(result?.amountTotal);

      if (amountTotal && amountTotal > 0) {
        await prisma.purchase.update({
          where: { id: purchase.id },
          data: {
            amount: amountTotal,
            currency: pickText(result?.currency, purchase.currency) || purchase.currency,
            invoiceNo: pickText(result?.invoiceNo, purchase.invoiceNo),
            description: pickText(result?.description, purchase.description),
          },
        });
        console.log(`  ✓ Updated ${amountTotal.toFixed(2)} ${pickText(result?.currency, purchase.currency) || purchase.currency}`);
        parsed += 1;
      } else {
        console.log('  ⚠ No amount found, leaving existing value at 0');
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`  ✗ Purchase ${label} failed: ${error.message}`);
      await sleep(1000);
    }
  });

  return { parsed, failed, skipped };
}

async function parseDocuments() {
  const pendingDocIds = await prisma.$queryRawUnsafe(`
    SELECT id
    FROM documents
    WHERE status = 'PENDING' AND "extractedData" IS NULL
    ORDER BY "createdAt" ASC
    LIMIT 100
  `);

  const docs = pendingDocIds.length
    ? await prisma.document.findMany({ where: { id: { in: pendingDocIds.map(row => row.id) } } })
    : [];

  docs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  console.log(`\nFound ${docs.length} pending documents to parse`);

  let parsed = 0;
  let failed = 0;
  let fallbackOnly = 0;

  await mapWithConcurrency(docs, 5, async (doc) => {
    const folder = extractFolderFromDriveUrl(doc.driveUrl);
    const supplierHint = guessSupplierFromPath(folder, doc.filename);

    try {
      console.log(`→ Parsing document ${doc.id} (${doc.filename})`);
      let result;
      let usedFallback = false;

      if (doc.driveFileId) {
        try {
          const buffer = await downloadDriveFile(doc.driveFileId);
          result = await parseWithRateLimit(doc.filename, folder, buffer);
        } catch (downloadError) {
          console.warn(`  ⚠ Download/AI failed for ${doc.filename}: ${downloadError.message}. Falling back to filename parsing.`);
          result = parseFromFilename(doc.filename, folder);
          usedFallback = true;
        }
      } else {
        result = parseFromFilename(doc.filename, folder);
        usedFallback = true;
      }

      const extractedData = supplierHint && !result?.supplierHint
        ? { ...result, supplierHint }
        : result;

      await prisma.document.update({
        where: { id: doc.id },
        data: {
          extractedData,
          confidence: toNumber(result?.confidence) ?? 50,
          suggestedAction: suggestedActionFor(result?.docType),
          processedAt: new Date(),
        },
      });

      if (usedFallback) fallbackOnly += 1;
      parsed += 1;
      console.log(`  ✓ ${result?.docType || 'OTHER'} | ${toNumber(result?.amountTotal) ?? '?'} ${result?.currency || ''} | conf: ${toNumber(result?.confidence) ?? 50}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ Document ${doc.filename} failed: ${error.message}`);
      await sleep(1000);
    }
  });

  return { parsed, failed, fallbackOnly };
}

async function main() {
  console.log('=== Studio Botema Bulk Parser ===\n');

  const purchaseResult = await parsePurchases();
  console.log(`\n✅ Purchases: ${purchaseResult.parsed} parsed, ${purchaseResult.failed} failed, ${purchaseResult.skipped} skipped`);

  const docResult = await parseDocuments();
  console.log(`\n✅ Documents: ${docResult.parsed} parsed, ${docResult.failed} failed, ${docResult.fallbackOnly} fallback-only`);

  const totalsByCurrency = await prisma.purchase.groupBy({
    by: ['currency'],
    _sum: { amount: true },
    _count: { id: true },
  });

  const totalPurchasesEur = totalsByCurrency.reduce((sum, row) => {
    const amount = Number(row._sum.amount || 0);
    if (row.currency === 'BGN') return sum + (amount / BGN_PER_EUR);
    return sum + amount;
  }, 0);

  console.log('\n💰 Totals by currency:', JSON.stringify(totalsByCurrency));
  console.log(`💶 Total purchases (EUR equivalent): ${totalPurchasesEur.toFixed(2)}`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
