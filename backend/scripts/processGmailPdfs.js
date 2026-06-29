/**
 * processGmailPdfs.js
 * Downloads and processes unprocessed Gmail PDF SourceFiles from supplier domains.
 * Creates Document records (and optionally Purchase records for high-confidence invoices).
 *
 * Usage:
 *   node scripts/processGmailPdfs.js              # dry run, shows what would be processed
 *   node scripts/processGmailPdfs.js --apply       # actually process and write to DB
 *   node scripts/processGmailPdfs.js --apply --limit 30  # process up to 30 files
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { google } = require('googleapis');
const { PrismaClient, Prisma } = require('@prisma/client');
const { parseDocumentWithAI } = require('../src/lib/aiParser');
const { analyzeDocument } = require('../src/lib/documentReview');
const { createLogger } = require('../src/lib/logger');

const prisma = new PrismaClient();
const log = createLogger('processGmailPdfs');

const APPLY = process.argv.includes('--apply');
const ALL_DOMAINS = process.argv.includes('--all-domains');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1]) : 50;
})();

// Domains to process (supplier invoices / logistics)
const PROCESS_DOMAINS = [
  'polarislighting.bg',
  'lodes.com',
  'andreuworld.com',
  'antrax.com',
  'formani.com',
  'fercam.com',
  'sedap.com',
  'zieta.pl',
  'libero.it',
  'mantovangroup.com',
  'ros-bg.com',
  'transpress.bg',
  'teximbank.bg',
  // New domains — logistics & additional suppliers
  'dhl.com',
  'alog-bg.com',
  'offthewall.bg',
  'led-bg.com',
  'minileiste.com',
  'jysk.com',
  'acalight.gr',
  'luminavera.com',
  // Subscriptions → Expense
  'stripe.com',
  'github.com',
];

// Domains whose PDFs should become Expense records (not BizDocument)
const EXPENSE_DOMAINS = new Set(['stripe.com', 'github.com']);

// Map domain → supplier name
const DOMAIN_SUPPLIER = {
  'polarislighting.bg': 'Polaris Lighting',
  'lodes.com': 'Lodes S.r.l.',
  'andreuworld.com': 'Andreu World',
  'antrax.com': 'Antrax IT',
  'formani.com': 'Formani Holland B.V.',
  'fercam.com': 'Fercam',
  'sedap.com': 'Atelier Sedap',
  'zieta.pl': 'Zieta Prozessdesign',
  'mantovangroup.com': 'Mantovan Group',
  'dhl.com': 'DHL',
  'alog-bg.com': 'Alog BG',
  'offthewall.bg': 'Off The Wall',
  'led-bg.com': 'LED BG',
  'minileiste.com': 'Minileiste',
  'jysk.com': 'JYSK',
  'acalight.gr': 'ACA Light',
  'stripe.com': 'Stripe / Subscription',
  'github.com': 'GitHub',
};

function getAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

function parseMsgId(gmailMsgId) {
  if (!gmailMsgId || gmailMsgId.length < 17) return { messageId: gmailMsgId, attachmentId: null };
  const messageId = gmailMsgId.substring(0, 16);
  const attachmentId = gmailMsgId.substring(17); // skip the '-' separator
  return { messageId, attachmentId: attachmentId || null };
}

function extractDomain(fromEmail) {
  return (fromEmail || '').match(/@([^>)\s]+)/)?.[1]?.toLowerCase() || '';
}

async function downloadAttachment(gmail, messageId, filename) {
  // Attachment IDs expire — must re-fetch from the live message
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const parts = collectParts(msg.data.payload);
  const part = parts.find(p => p.filename === filename) || parts.find(p =>
    p.filename && p.filename.toLowerCase() === filename.toLowerCase()
  );
  if (!part?.body?.attachmentId) throw new Error(`Attachment not found in message: ${filename}`);
  const res = await gmail.users.messages.attachments.get({
    userId: 'me', messageId, id: part.body.attachmentId,
  });
  const base64 = (res.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

function collectParts(payload, result = []) {
  if (!payload) return result;
  if (payload.filename && payload.body?.attachmentId) result.push(payload);
  for (const p of (payload.parts || [])) collectParts(p, result);
  return result;
}

async function findOrCreateCounterparty(supplierName) {
  if (!supplierName) return null;
  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: supplierName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;
  const created = await prisma.counterparty.create({
    data: { name: supplierName, type: 'SUPPLIER', country: 'BG', currency: 'EUR' },
    select: { id: true },
  });
  return created.id;
}

async function findSupplier(supplierName) {
  if (!supplierName) return null;
  return prisma.supplier.findFirst({
    where: { name: { equals: supplierName, mode: 'insensitive' } },
    select: { id: true },
  });
}

async function main() {
  log.info('Starting Gmail PDF processing', { apply: APPLY, limit: LIMIT, allDomains: ALL_DOMAINS });

  const auth = getAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  // Get unprocessed Gmail PDF SourceFiles
  const allFiles = await prisma.sourceFile.findMany({
    where: {
      type: 'GMAIL',
      processedAt: null,
      filename: { endsWith: '.pdf', mode: 'insensitive' },
    },
    select: { id: true, gmailMsgId: true, filename: true, fromEmail: true, subject: true, folder: true, receivedAt: true },
    orderBy: { receivedAt: 'desc' },
  });

  const files = (ALL_DOMAINS
    ? allFiles
    : allFiles.filter(f => PROCESS_DOMAINS.includes(extractDomain(f.fromEmail)))
  ).slice(0, LIMIT);

  const knownCount = allFiles.filter(f => PROCESS_DOMAINS.includes(extractDomain(f.fromEmail))).length;
  log.info('Batch queried', { totalUnprocessed: allFiles.length, knownSupplier: knownCount, thisBatch: files.length });

  let created = 0, skipped = 0, failed = 0, bankTx = 0;

  for (const sf of files) {
    const domain = extractDomain(sf.fromEmail);
    const { messageId, attachmentId } = parseMsgId(sf.gmailMsgId);
    const supplierName = DOMAIN_SUPPLIER[domain] || null;

    // Check if already have a Document for this gmail source
    const gmailDocId = `gmail:${messageId}:${sf.filename}`;
    const existing = await prisma.document.findFirst({
      where: { driveFileId: gmailDocId },
      select: { id: true },
    });
    if (existing) {
      log.debug('Skip — document already exists', { filename: sf.filename, gmailDocId });
      if (APPLY) await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
      skipped++;
      continue;
    }

    if (!attachmentId) {
      log.debug('Skip — no attachmentId in stored gmailMsgId', { filename: sf.filename, gmailMsgId: sf.gmailMsgId });
      if (APPLY) await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
      skipped++;
      continue;
    }

    log.info('Processing file', { filename: sf.filename, domain, subject: sf.subject });

    try {
      const pdfBuffer = await downloadAttachment(gmail, messageId, sf.filename);
      // Use the shared parser with full fallback chain (Groq → OpenRouter → heuristic)
      const folderHint = sf.folder || `Gmail/${domain}`;
      const parsed = await parseDocumentWithAI(sf.filename, folderHint, pdfBuffer);

      log.info('AI parse result', { filename: sf.filename, docType: parsed.docType, invoiceNo: parsed.invoiceNo, amountTotal: parsed.amountTotal, currency: parsed.currency, confidence: parsed.confidence });

      const counterpartyId = await findOrCreateCounterparty(supplierName || parsed.supplierName);
      const supplier = await findSupplier(supplierName || parsed.supplierName);

      if (APPLY) {
        // Low-confidence or missing amount: save as NEEDS_REVIEW instead of silently discarding
        if (!parsed.amountTotal || parsed.confidence < 60) {
          log.warn('Low confidence / no amount — saving as NEEDS_REVIEW', { filename: sf.filename, confidence: parsed.confidence, amountTotal: parsed.amountTotal });
          await prisma.document.create({
            data: {
              driveFileId: gmailDocId,
              driveUrl: '',
              filename: sf.filename,
              type: 'OTHER',
              status: 'NEEDS_REVIEW',
              extractedData: { ...parsed, gmailMessageId: messageId, gmailSubject: sf.subject, from: sf.fromEmail },
              confidence: (parsed.confidence || 0) / 100,
              suggestedAction: 'ARCHIVE_ONLY',
              riskFlags: ['LOW_CONFIDENCE', ...(!parsed.amountTotal ? ['MISSING_AMOUNT'] : [])],
            },
          });
          await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
          skipped++;
          continue;
        }

        // Create Document record using analyzeDocument for proper risk flags
        const review = await analyzeDocument(prisma, { ...parsed, supplierName: supplierName || parsed.supplierName });
        await prisma.document.create({
          data: {
            driveFileId: gmailDocId,
            driveUrl: '',
            filename: sf.filename,
            type: parsed.docType === 'INVOICE_IN' ? 'INVOICE_IN'
              : parsed.docType === 'PROFORMA' ? 'PROFORMA'
                : parsed.docType === 'DELIVERY_NOTE' ? 'DELIVERY'
                  : 'OTHER',
            status: review.riskFlags.length > 0 ? 'NEEDS_REVIEW' : 'PENDING',
            extractedData: {
              ...parsed,
              gmailMessageId: messageId,
              gmailSubject: sf.subject,
              from: sf.fromEmail,
              supplierName: supplierName || parsed.supplierName,
            },
            confidence: (parsed.confidence || 50) / 100,
            suggestedAction: review.suggestedAction,
            riskFlags: review.riskFlags.length > 0 ? review.riskFlags : null,
          },
        });
        // Expense records for subscription domains (Stripe, GitHub)
        if (EXPENSE_DOMAINS.has(domain) && parsed.amountTotal && parsed.confidence >= 60) {
          const expDate = parsed.docDate ? new Date(parsed.docDate) : (sf.receivedAt || new Date());
          const dupExpense = await prisma.expense.findFirst({
            where: {
              supplier: { contains: DOMAIN_SUPPLIER[domain] || domain, mode: 'insensitive' },
              amount: new Prisma.Decimal(parsed.amountTotal),
              date: expDate,
            },
            select: { id: true },
          });
          if (!dupExpense) {
            await prisma.expense.create({
              data: {
                date: expDate,
                category: 'SOFTWARE',
                supplier: parsed.supplierName || DOMAIN_SUPPLIER[domain] || domain,
                description: parsed.description || parsed.invoiceNo || sf.filename,
                amount: new Prisma.Decimal(parsed.amountTotal),
                currency: parsed.currency || 'EUR',
                year: expDate.getFullYear(),
              },
            });
            log.info('Expense created', { filename: sf.filename, amount: parsed.amountTotal, currency: parsed.currency, category: 'SOFTWARE' });
          } else {
            log.debug('Expense already exists — skip', { filename: sf.filename });
          }
        }

        // Create BizDocument for financial docs from non-expense domains
        if (!EXPENSE_DOMAINS.has(domain) && parsed.amountTotal && parsed.confidence >= 70 &&
          ['INVOICE_IN', 'PROFORMA', 'DELIVERY_NOTE', 'OFFER', 'OTHER'].includes(parsed.docType)) {
          const bizDocType = parsed.docType === 'INVOICE_IN' ? 'INVOICE_IN'
            : parsed.docType === 'PROFORMA' ? 'PROFORMA_IN'
              : parsed.docType === 'DELIVERY_NOTE' ? 'DELIVERY_NOTE'
                : parsed.docType === 'OFFER' ? 'OFFER_IN'
                  : 'OTHER';

          // Only check for duplicate when invoiceNo is known — null must NOT match all docs for counterparty
          const bizExisting = parsed.invoiceNo
            ? await prisma.bizDocument.findFirst({
              where: { docNumber: parsed.invoiceNo, counterpartyId: counterpartyId || undefined },
              select: { id: true },
            })
            : null;

          if (!bizExisting) {
            const bizReview = await analyzeDocument(prisma, { ...parsed, docType: bizDocType });
            const bizData = {
              counterpartyId,
              docType: bizDocType,
              docNumber: parsed.invoiceNo || null,
              docDate: parsed.docDate ? new Date(parsed.docDate) : sf.receivedAt || new Date(),
              dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
              currency: parsed.currency || 'EUR',
              amountNet: parsed.amountNet != null ? new Prisma.Decimal(parsed.amountNet) : null,
              vatAmount: parsed.vatAmount != null ? new Prisma.Decimal(parsed.vatAmount) : null,
              amountTotal: new Prisma.Decimal(parsed.amountTotal),
              vatType: 'STANDARD_BG',
              status: bizReview.riskFlags.length > 0 ? 'NEEDS_REVIEW' : 'IMPORTED',
              confidence: new Prisma.Decimal(parsed.confidence || 70),
              notes: `Gmail: ${sf.subject?.substring(0, 100)} | ${sf.fromEmail?.substring(0, 80)}`,
            };
            await prisma.bizDocument.create({ data: { ...bizData, sourceFileId: sf.id } });

            // Create Purchase record only for INVOICE_IN with known supplier
            if (bizDocType === 'INVOICE_IN' && supplier && parsed.invoiceNo) {
              const purchaseExists = await prisma.purchase.findFirst({
                where: { invoiceNo: parsed.invoiceNo, supplierId: supplier.id },
                select: { id: true },
              });
              if (!purchaseExists) {
                await prisma.purchase.create({
                  data: {
                    invoiceNo: parsed.invoiceNo,
                    date: parsed.docDate ? new Date(parsed.docDate) : sf.receivedAt || new Date(),
                    supplierId: supplier.id,
                    currency: parsed.currency || 'EUR',
                    amount: new Prisma.Decimal(parsed.amountTotal),
                    description: parsed.description || sf.filename,
                    status: 'PENDING',
                    year: parsed.docDate ? new Date(parsed.docDate).getFullYear() : new Date().getFullYear(),
                  },
                });
                log.info('Purchase created', { filename: sf.filename, invoiceNo: parsed.invoiceNo, amount: parsed.amountTotal, currency: parsed.currency });
              }
            }

            log.info('BizDocument created', { filename: sf.filename, invoiceNo: parsed.invoiceNo, bizDocType, status: bizReview.riskFlags.length > 0 ? 'NEEDS_REVIEW' : 'IMPORTED' });
          } else {
            log.debug('BizDocument already exists — skip', { filename: sf.filename, invoiceNo: parsed.invoiceNo });
          }
        }

        await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
      }

      created++;
    } catch (err) {
      log.error('Failed to process file', { filename: sf.filename, domain, error: err.message, stack: err.stack?.split('\n')[1]?.trim() });
      failed++;
    }

    // Rate limit: 3s between Gemini calls
    await new Promise(r => setTimeout(r, 3000));
  }

  log.info('Batch complete', { created, skipped, failed, bankTx, total: files.length });
}

main()
  .catch(err => { log.error('Fatal error', { error: err.message, stack: err.stack }); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
