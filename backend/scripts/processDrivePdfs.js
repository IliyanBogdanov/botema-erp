/**
 * processDrivePdfs.js
 * Downloads and processes unprocessed Drive PDF SourceFiles.
 * - Facebook/FB folders → Expense records (ADVERTISING)
 * - Supplier/incoming invoice folders → BizDocument INVOICE_IN
 *
 * Usage:
 *   node scripts/processDrivePdfs.js              # dry run
 *   node scripts/processDrivePdfs.js --apply       # write to DB
 *   node scripts/processDrivePdfs.js --apply --limit 50
 *   node scripts/processDrivePdfs.js --apply --mode facebook
 *   node scripts/processDrivePdfs.js --apply --mode suppliers
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { google } = require('googleapis');
const { PrismaClient, Prisma } = require('@prisma/client');
const { parseDocumentWithAI } = require('../src/lib/aiParser');
const { analyzeDocument } = require('../src/lib/documentReview');

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1]) : 100;
})();
const MODE_ARG = (() => {
  const i = process.argv.indexOf('--mode');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : 'all';
})();

// Folder patterns → document category
const FACEBOOK_PATTERNS = ['facebook', '/fb/', 'fb invoices', 'фб фактури', 'fb ', 'рекламни услуги', 'рекламни'];
const SUPPLIER_PATTERNS = [
  'входящи фактури', 'imports/', 'purchases/',
  'polaris', 'lodes', 'alphaluc', 'каримок', 'bonaldo', 'боналдо',
  'atelier sedap', 'ателие седап', 'зиета', 'zieta',
  'formani', 'формани', 'antrax', 'антракс',
  'omega light', 'омега лайт', 'ака лайт',
  'ros-bg', 'dhl', 'fercam', 'speedy', 'спиди',
];

function getMode(folder) {
  const f = (folder || '').toLowerCase();
  if (FACEBOOK_PATTERNS.some(p => f.includes(p))) return 'facebook';
  if (SUPPLIER_PATTERNS.some(p => f.includes(p))) return 'supplier';
  return 'other';
}

function getAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

async function downloadDriveFile(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

async function findOrCreateCounterparty(name, type = 'SUPPLIER') {
  if (!name) return null;
  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;
  const created = await prisma.counterparty.create({
    data: { name, type, country: 'BG', currency: 'EUR' },
    select: { id: true },
  });
  return created.id;
}

async function main() {
  console.log(`=== PROCESS DRIVE PDFs${APPLY ? ' (APPLY)' : ' (DRY RUN)'} | mode=${MODE_ARG} | limit=${LIMIT} ===`);

  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // Build folder filter
  const folderOR = [];
  if (MODE_ARG === 'facebook' || MODE_ARG === 'all') {
    FACEBOOK_PATTERNS.forEach(p => folderOR.push({ folder: { contains: p, mode: 'insensitive' } }));
  }
  if (MODE_ARG === 'suppliers' || MODE_ARG === 'all') {
    SUPPLIER_PATTERNS.forEach(p => folderOR.push({ folder: { contains: p, mode: 'insensitive' } }));
  }

  const where = {
    type: 'DRIVE',
    processedAt: null,
    filename: { endsWith: '.pdf', mode: 'insensitive' },
    driveFileId: { not: null },
    ...(folderOR.length > 0 ? { OR: folderOR } : {}),
  };

  const total = await prisma.sourceFile.count({ where });
  const files = await prisma.sourceFile.findMany({
    where,
    select: { id: true, driveFileId: true, filename: true, folder: true, receivedAt: true },
    orderBy: { receivedAt: 'desc' },
    take: LIMIT,
  });

  console.log(`Total matching unprocessed Drive PDFs: ${total}`);
  console.log(`Processing this batch: ${files.length}`);

  let expensesCreated = 0, bizDocsCreated = 0, skipped = 0, failed = 0;

  for (const sf of files) {
    const mode = getMode(sf.folder);
    const isFacebook = mode === 'facebook';

    // Check if already have a Document for this drive file
    const existing = await prisma.document.findFirst({
      where: { driveFileId: sf.driveFileId },
      select: { id: true },
    });
    if (existing) {
      console.log(`SKIP (doc exists): ${sf.filename}`);
      if (APPLY) await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
      skipped++;
      continue;
    }

    console.log(`\nProcessing [${mode}/${sf.folder?.split('/').pop()}]: ${sf.filename}`);

    try {
      const pdfBuffer = await downloadDriveFile(drive, sf.driveFileId);
      const folderHint = isFacebook ? 'Facebook invoices' : (sf.folder || '');
      const parsed = await parseDocumentWithAI(sf.filename, folderHint, pdfBuffer);

      console.log(`  → docType=${parsed.docType} amount=${parsed.amountTotal} ${parsed.currency} conf=${parsed.confidence}`);

      // Low-confidence or missing amount: store as NEEDS_REVIEW instead of silently discarding
      if (!parsed.amountTotal || parsed.confidence < 60) {
        console.log(`  LOW CONFIDENCE / NO AMOUNT → saving as NEEDS_REVIEW`);
        if (APPLY) {
          await prisma.document.create({
            data: {
              driveFileId: sf.driveFileId,
              driveUrl: `https://drive.google.com/file/d/${sf.driveFileId}`,
              filename: sf.filename,
              type: 'OTHER',
              status: 'NEEDS_REVIEW',
              extractedData: { ...parsed, driveFolder: sf.folder },
              confidence: (parsed.confidence || 0) / 100,
              suggestedAction: 'ARCHIVE_ONLY',
              riskFlags: ['LOW_CONFIDENCE', ...(!parsed.amountTotal ? ['MISSING_AMOUNT'] : [])],
            },
          });
          await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
        }
        skipped++;
        continue;
      }

      if (APPLY) {
        const review = await analyzeDocument(prisma, parsed);
        // Always create a Document record for dedup
        await prisma.document.create({
          data: {
            driveFileId: sf.driveFileId,
            driveUrl: `https://drive.google.com/file/d/${sf.driveFileId}`,
            filename: sf.filename,
            type: parsed.docType === 'INVOICE_IN' ? 'INVOICE_IN'
              : parsed.docType === 'INVOICE_OUT' ? 'INVOICE_OUT'
              : parsed.docType === 'EXPENSE' ? 'OTHER'
              : parsed.docType === 'PROFORMA' ? 'PROFORMA'
              : parsed.docType === 'DELIVERY_NOTE' ? 'DELIVERY'
              : 'OTHER',
            status: isFacebook ? 'PENDING' : (review.riskFlags.length > 0 ? 'NEEDS_REVIEW' : 'PENDING'),
            extractedData: { ...parsed, driveFolder: sf.folder },
            confidence: (parsed.confidence || 50) / 100,
            suggestedAction: isFacebook ? 'ARCHIVE_ONLY' : review.suggestedAction,
            riskFlags: review.riskFlags.length > 0 ? review.riskFlags : null,
          },
        });

        if (isFacebook || parsed.docType === 'EXPENSE') {
          // Create Expense record
          const expDate = parsed.docDate ? new Date(parsed.docDate) : (sf.receivedAt || new Date());
          const dupExpense = await prisma.expense.findFirst({
            where: {
              supplier: { contains: 'Facebook', mode: 'insensitive' },
              amount: new Prisma.Decimal(parsed.amountTotal),
              date: expDate,
            },
            select: { id: true },
          });
          if (!dupExpense) {
            await prisma.expense.create({
              data: {
                date: expDate,
                category: 'ADVERTISING',
                supplier: parsed.supplierName || 'Facebook / Meta',
                description: parsed.description || sf.filename,
                amount: new Prisma.Decimal(parsed.amountTotal),
                currency: parsed.currency || 'EUR',
                year: expDate.getFullYear(),
              },
            });
            console.log(`  ✅ Expense created: ${parsed.amountTotal} ${parsed.currency} (ADVERTISING)`);
            expensesCreated++;
          } else {
            console.log(`  → Expense already exists`);
            skipped++;
          }
        } else if (parsed.amountTotal && parsed.confidence >= 70 &&
          ['INVOICE_IN', 'PROFORMA', 'DELIVERY_NOTE', 'OFFER', 'OTHER'].includes(parsed.docType)) {
          // Create BizDocument for any confirmed incoming financial document
          const counterpartyId = await findOrCreateCounterparty(parsed.supplierName);

          // Only check for duplicate when invoiceNo is known — null invoiceNo must NOT match all docs
          const bizExisting = parsed.invoiceNo
            ? await prisma.bizDocument.findFirst({
                where: { docNumber: parsed.invoiceNo, counterpartyId: counterpartyId || undefined },
                select: { id: true },
              })
            : null;

          if (!bizExisting) {
            const bizDocType = parsed.docType === 'INVOICE_IN' ? 'INVOICE_IN'
              : parsed.docType === 'PROFORMA' ? 'PROFORMA_IN'
              : parsed.docType === 'DELIVERY_NOTE' ? 'DELIVERY_NOTE'
              : parsed.docType === 'OFFER' ? 'OFFER_IN'
              : 'OTHER';
            const review = await analyzeDocument(prisma, { ...parsed, docType: bizDocType });
            await prisma.bizDocument.create({
              data: {
                counterpartyId,
                sourceFileId: sf.id,
                docType: bizDocType,
                docNumber: parsed.invoiceNo || null,
                docDate: parsed.docDate ? new Date(parsed.docDate) : (sf.receivedAt || new Date()),
                currency: parsed.currency || 'EUR',
                amountNet: parsed.amountNet != null ? new Prisma.Decimal(parsed.amountNet) : null,
                vatAmount: parsed.vatAmount != null ? new Prisma.Decimal(parsed.vatAmount) : null,
                amountTotal: new Prisma.Decimal(parsed.amountTotal),
                vatType: 'STANDARD_BG',
                status: review.riskFlags.length > 0 ? 'NEEDS_REVIEW' : 'IMPORTED',
                confidence: new Prisma.Decimal(parsed.confidence || 70),
                notes: `Drive: ${sf.folder?.split('/').slice(-2).join('/')} | ${sf.filename}`.substring(0, 200),
              },
            });
            console.log(`  ✅ BizDoc created: ${parsed.invoiceNo || '?'} ${parsed.amountTotal} ${parsed.currency} [${bizDocType}]`);
            bizDocsCreated++;
          } else {
            console.log(`  → BizDoc already exists for ${parsed.invoiceNo}`);
            skipped++;
          }
        }

        await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
      }
    } catch (err) {
      console.error(`  ❌ ${sf.filename}: ${err.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n=== DONE ===`);
  console.log({ expensesCreated, bizDocsCreated, skipped, failed });
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
