const cron = require('node-cron');
const prisma = require('../lib/prisma');
const { gmailBackfill, driveBackfill } = require('../lib/backfill');
const { autoMatch } = require('../lib/reconciliationEngine');
const { parseDocumentWithAI, downloadDriveFile, guessSupplierFromPath } = require('../lib/aiParser');

const PURCHASE_KEYWORDS = ['фактура', 'invoice', 'purchase', 'доставка', 'lodes', 'polaris', 'exenza', 'formani', 'zieta', 'omega', 'fercam', 'siltem', 'tridonic', 'dhl'];
const SKIP_KEYWORDS = ['оферт', 'offer', 'изходящ', 'outgoing', 'issued', 'invoice-0000'];

async function runNightlyImport() {
  console.log('[nightly-import] Starting full pipeline...');
  const year = new Date().getFullYear();

  // Step 1: Gmail scan (previous + current year)
  for (const y of [year - 1, year]) {
    try {
      await gmailBackfill(y, msg => console.log('[nightly-import]', msg));
    } catch (e) {
      console.error(`[nightly-import] Gmail ${y} error:`, e.message);
    }
  }

  // Step 2: Drive scan
  const folderId = process.env.DRIVE_INVOICES_FOLDER_ID;
  if (folderId) {
    try {
      await driveBackfill(folderId, 'Drive', year, msg => console.log('[nightly-import]', msg));
    } catch (e) {
      console.error('[nightly-import] Drive error:', e.message);
    }
  }

  // Step 3: Parse new Drive PDFs → Purchase records
  try {
    const sourceFiles = await prisma.sourceFile.findMany({
      where: { fileType: 'DRIVE', mimeType: 'application/pdf' },
      take: 300,
    });

    let parsed = 0;
    let skipped = 0;
    for (const sf of sourceFiles) {
      const combined = ((sf.filePath || '') + ' ' + (sf.fileName || '')).toLowerCase();
      if (!PURCHASE_KEYWORDS.some(k => combined.includes(k))) { skipped++; continue; }
      if (SKIP_KEYWORDS.some(k => combined.includes(k))) { skipped++; continue; }

      const exists = await prisma.purchase.findFirst({ where: { driveFileId: sf.externalId } });
      if (exists) { skipped++; continue; }

      try {
        await new Promise(r => setTimeout(r, 2000));
        const buf = await downloadDriveFile(sf.externalId);
        const ai = await parseDocumentWithAI(sf.fileName, sf.filePath, buf);
        const supplierId = guessSupplierFromPath(sf.filePath, sf.fileName);
        await prisma.purchase.create({
          data: {
            supplierId,
            driveFileId: sf.externalId,
            invoiceNumber: ai.invoiceNo || sf.fileName,
            invoiceDate: ai.docDate ? new Date(ai.docDate) : new Date(),
            amount: parseFloat(ai.amountTotal) || 0,
            currency: ai.currency || 'EUR',
            description: ai.description || sf.fileName,
            status: 'RECEIVED',
          },
        });
        parsed++;
      } catch { /* individual file failure — continue */ }
    }
    console.log(`[nightly-import] Parsed ${parsed} new purchases, skipped ${skipped}`);
  } catch (e) {
    console.error('[nightly-import] Parse step error:', e.message);
  }

  // Step 4: Reparse zero-amount purchases
  try {
    const zeros = await prisma.purchase.findMany({
      where: { amount: 0, driveFileId: { not: null } },
      take: 50,
    });
    let fixed = 0;
    for (const p of zeros) {
      try {
        await new Promise(r => setTimeout(r, 2000));
        const buf = await downloadDriveFile(p.driveFileId);
        const ai = await parseDocumentWithAI(p.invoiceNumber || '', '', buf);
        const amt = parseFloat(ai.amountTotal);
        if (amt > 0) {
          await prisma.purchase.update({ where: { id: p.id }, data: { amount: amt } });
          fixed++;
        }
      } catch { /* continue */ }
    }
    console.log(`[nightly-import] Fixed ${fixed} zero-amount purchases`);
  } catch (e) {
    console.error('[nightly-import] Reparse step error:', e.message);
  }

  // Step 5: Auto-match reconciliation
  for (const y of [year - 1, year]) {
    try {
      const result = await autoMatch({ year: y });
      console.log(`[nightly-import] Reconcile ${y}: matched=${result.matched || 0}`);
    } catch (e) {
      console.error(`[nightly-import] Reconcile ${y} error:`, e.message);
    }
  }

  // Step 6: Sync matched payments → invoice status PAID
  try {
    const links = await prisma.reconciliationLink.findMany({
      where: { linkType: 'PAYMENT_TO_INVOICE', targetDocId: { not: null } },
      include: {
        payment: { select: { status: true } },
        targetDoc: { select: { docNumber: true, docType: true } },
      },
    });
    let synced = 0;
    for (const link of links) {
      if (!['MATCHED', 'PARTIAL'].includes(link.payment?.status)) continue;
      if (link.targetDoc?.docType !== 'INVOICE_OUT') continue;
      const num = link.targetDoc.docNumber;
      if (!num) continue;
      const stripped = num.replace(/^0+/, '') || num;
      const padded = stripped.padStart(10, '0');
      const updated = await prisma.invoice.updateMany({
        where: { number: { in: [num, stripped, padded] }, status: { not: 'PAID' } },
        data: { status: 'PAID' },
      });
      synced += updated.count;
    }
    console.log(`[nightly-import] Synced ${synced} invoices to PAID`);
  } catch (e) {
    console.error('[nightly-import] Sync step error:', e.message);
  }

  console.log('[nightly-import] Done.');
}

function startNightlyImportJob() {
  cron.schedule('0 2 * * *', runNightlyImport, { timezone: 'Europe/Sofia' });
  console.log('[nightly-import] Scheduled daily at 02:00 Europe/Sofia');
}

module.exports = { startNightlyImportJob, runNightlyImport };
