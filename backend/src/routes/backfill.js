const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const adminOnly = requireRole('ADMIN');
const { gmailBackfill, driveBackfill, importInventoryFromRows } = require('../lib/backfill');
const { downloadDriveFile, parseDocumentWithAI, parseFromFilename, guessSupplierFromPath, guessFolderType, isOutgoingFolder } = require('../lib/aiParser');
const prisma = require('../lib/prisma');

// In-memory job status store
const jobs = {};

// POST /api/backfill/gmail/:year  — scan Gmail for a year (async, fire-and-forget)
router.post('/gmail/:year', auth, adminOnly, (req, res) => {
  const year = parseInt(req.params.year);
  if (isNaN(year) || year < 2020 || year > 2030) {
    return res.status(400).json({ error: 'Invalid year' });
  }

  const jobId = `gmail-${year}-${Date.now()}`;
  jobs[jobId] = { jobId, type: 'gmail', year, status: 'running', started: new Date(), log: [], result: null };

  res.json({ accepted: true, jobId, message: `Gmail ${year} backfill started. Poll GET /api/backfill/job/${jobId} for status.` });

  gmailBackfill(year, (done, total, msg) => {
    const line = `${done}/${total} — ${msg}`;
    console.log(`[backfill] Gmail ${year}: ${line}`);
    jobs[jobId].log.push(line);
    if (jobs[jobId].log.length > 200) jobs[jobId].log.shift();
  }).then(result => {
    console.log(`[backfill] Gmail ${year} done:`, result);
    jobs[jobId].status = 'done';
    jobs[jobId].result = result;
    jobs[jobId].finished = new Date();
  }).catch(e => {
    console.error('[backfill] Gmail error:', e.message);
    jobs[jobId].status = 'error';
    jobs[jobId].error = e.message;
    jobs[jobId].finished = new Date();
  });
});

// POST /api/backfill/drive  — scan a Drive folder (async)
// Body: { folderId, folderPath, year }
router.post('/drive', auth, adminOnly, (req, res) => {
  const { folderId, folderPath, year } = req.body;
  if (!folderId || !year) return res.status(400).json({ error: 'folderId and year required' });

  const jobId = `drive-${year}-${Date.now()}`;
  jobs[jobId] = { jobId, type: 'drive', year, status: 'running', started: new Date(), log: [], result: null };

  res.json({ accepted: true, jobId, message: `Drive backfill started. Poll GET /api/backfill/job/${jobId} for status.` });

  driveBackfill(folderId, folderPath || `Drive/${year}`, parseInt(year), (done, total, name) => {
    const line = `${done}/${total} — ${name}`;
    console.log(`[backfill] Drive: ${line}`);
    jobs[jobId].log.push(line);
    if (jobs[jobId].log.length > 200) jobs[jobId].log.shift();
  }).then(result => {
    jobs[jobId].status = 'done';
    jobs[jobId].result = result;
    jobs[jobId].finished = new Date();
  }).catch(e => {
    console.error('[backfill] Drive error:', e.message);
    jobs[jobId].status = 'error';
    jobs[jobId].error = e.message;
    jobs[jobId].finished = new Date();
  });
});

// POST /api/backfill/inventory  — import rows from xlsx (parsed by frontend)
// Body: { rows: [{code, name, supplier, qtyIn, unit, unitPrice, notes}], projectId? }
router.post('/inventory', auth, adminOnly, async (req, res) => {
  const { rows, projectId } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' });
  }
  try {
    const result = await importInventoryFromRows(rows, projectId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/backfill/job/:jobId  — poll job status
router.get('/job/:jobId', auth, (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// GET /api/backfill/jobs  — list all jobs
router.get('/jobs', auth, adminOnly, (req, res) => {
  res.json(Object.values(jobs).sort((a, b) => new Date(b.started) - new Date(a.started)));
});

// POST /api/backfill/parse-purchases  — AI-parse Drive source files → create Purchase records
// Body: { limit?: number, dryRun?: boolean, forceUpdate?: boolean }
router.post('/parse-purchases', auth, adminOnly, async (req, res) => {
  const { limit = 30, dryRun = false, forceUpdate = false } = req.body || {};

  const jobId = `parse-${Date.now()}`;
  jobs[jobId] = { jobId, type: 'parse-purchases', status: 'running', started: new Date(), log: [], result: null };
  res.json({ accepted: true, jobId, message: `Parsing purchases (limit ${limit}, dryRun ${dryRun}). Poll GET /api/backfill/job/${jobId}` });

  // Run async
  (async () => {
    const log = msg => {
      console.log('[parse-purchases]', msg);
      jobs[jobId].log.push(msg);
      if (jobs[jobId].log.length > 500) jobs[jobId].log.shift();
    };

    try {
      let files;

      if (forceUpdate) {
        // For forceUpdate: find all purchases with amount=0 that have a driveFileId, and fetch their source files
        const zeroPurchases = await prisma.purchase.findMany({
          where: { amount: 0, driveFileId: { not: null } },
          take: parseInt(limit),
        });
        const driveIds = zeroPurchases.map(p => p.driveFileId).filter(Boolean);
        const sourceFiles = await prisma.sourceFile.findMany({
          where: { driveFileId: { in: driveIds } },
        });
        // Map driveFileId → sourceFile
        const sfMap = Object.fromEntries(sourceFiles.map(sf => [sf.driveFileId, sf]));
        // Build file-like objects from purchases (fallback if no sourceFile record)
        files = zeroPurchases.map(p => {
          const sf = sfMap[p.driveFileId];
          return sf || {
            driveFileId: p.driveFileId,
            filename: p.description || p.driveFileId,
            folder: '',
            mimeType: 'application/pdf',
          };
        });
        log(`Found ${files.length} zero-amount purchases to re-parse`);
      } else {
        // Normal mode: scan Drive source files in purchase folders
        const allFiles = await prisma.sourceFile.findMany({
          where: {
            type: 'DRIVE',
            driveFileId: { not: null },
            AND: [
              {
                OR: [
                  { mimeType: { contains: 'pdf', mode: 'insensitive' } },
                  { filename: { endsWith: '.pdf', mode: 'insensitive' } },
                ],
              },
              {
                OR: [
                  { folder: { contains: 'Purchases', mode: 'insensitive' } },
                  { folder: { contains: 'Imports', mode: 'insensitive' } },
                  { folder: { contains: 'Входящи', mode: 'insensitive' } },
                  { folder: { contains: 'Лодес', mode: 'insensitive' } },
                  { folder: { contains: 'Алфалуче', mode: 'insensitive' } },
                  { folder: { contains: 'Поларис', mode: 'insensitive' } },
                  { folder: { contains: 'Брага', mode: 'insensitive' } },
                  { folder: { contains: 'Зиета', mode: 'insensitive' } },
                  { folder: { contains: 'Каримоку', mode: 'insensitive' } },
                  { folder: { contains: 'Омега Лайт', mode: 'insensitive' } },
                  { folder: { contains: 'Ателие Седап', mode: 'insensitive' } },
                  { folder: { contains: 'АКА', mode: 'insensitive' } },
                  { folder: { contains: 'Поръчка', mode: 'insensitive' } },
                  { folder: { contains: 'Фактура ', mode: 'insensitive' } },
                  { folder: { contains: 'Фактури ', mode: 'insensitive' } },
                ],
              },
            ],
          },
          orderBy: { receivedAt: 'desc' },
          take: parseInt(limit) * 3,
        });
        const EXCLUDE = ['изходящи', 'outgoing', 'оферти', 'оферта'];
        files = allFiles
          .filter(f => {
            const fl = f.folder.toLowerCase();
            return !EXCLUDE.some(kw => fl.includes(kw));
          })
          .slice(0, parseInt(limit));
        log(`Found ${files.length} purchase-related Drive files`);
      }

      let created = 0, skipped = 0, failed = 0;
      const results = [];

      for (const file of files) {
        try {
          // In forceUpdate mode, files ARE the zero-amount purchases — always re-parse
          let existing = null;
          if (!forceUpdate) {
            existing = await prisma.purchase.findFirst({ where: { driveFileId: file.driveFileId } });
            if (existing) {
              skipped++;
              log(`SKIP (exists): ${file.filename}`);
              continue;
            }
          } else {
            existing = await prisma.purchase.findFirst({ where: { driveFileId: file.driveFileId } });
            log(`RE-PARSE (amount=0): ${file.filename}`);
          }

          // Skip outgoing folders and delivery notes (only want invoices/purchases)
          if (isOutgoingFolder(file.folder)) {
            skipped++;
            log(`SKIP (outgoing folder): ${file.filename}`);
            continue;
          }
          const folderLower = file.folder.toLowerCase();
          if (folderLower.includes('delivery') || folderLower.includes('deliveries') ||
              folderLower.includes('доставк')) {
            skipped++;
            log(`SKIP (delivery folder): ${file.filename}`);
            continue;
          }

          const supplierId = guessSupplierFromPath(file.folder, file.filename);
          log(`Parsing ${file.filename} (supplier: ${supplierId || 'unknown'}, folder: ${file.folder})...`);

          // Try AI parsing first, fall back to heuristic
          let parsed;
          try {
            const pdfBuffer = await downloadDriveFile(file.driveFileId);
            parsed = await parseDocumentWithAI(file.filename, file.folder, pdfBuffer);
            // Small delay to respect Gemini rate limits (15 RPM free tier)
            await new Promise(r => setTimeout(r, 4500));
          } catch (dlErr) {
            log(`  AI failed [${dlErr.status || dlErr.statusCode || 'ERR'}]: ${dlErr.message.substring(0, 150)} — using heuristic fallback`);
            parsed = parseFromFilename(file.filename, file.folder);
          }

          log(`  → invoiceNo=${parsed.invoiceNo} date=${parsed.docDate} total=${parsed.amountTotal} ${parsed.currency} conf=${parsed.confidence}`);

          results.push({ file: file.filename, parsed, supplierId });

          if (!dryRun && supplierId && parsed.docDate) {
            const year = new Date(parsed.docDate).getFullYear();
            if (existing && forceUpdate) {
              // Update existing purchase amount
              await prisma.purchase.update({
                where: { id: existing.id },
                data: {
                  amount: parsed.amountTotal || existing.amount,
                  currency: parsed.currency || existing.currency,
                  invoiceNo: parsed.invoiceNo || existing.invoiceNo,
                  status: parsed.amountTotal ? 'PAID' : existing.status,
                  description: parsed.description || existing.description,
                },
              });
              created++;
              log(`  ✅ Purchase updated (amount=${parsed.amountTotal || 'unknown'})`);
            } else {
              await prisma.purchase.create({
                data: {
                  invoiceNo: parsed.invoiceNo || undefined,
                  date: new Date(parsed.docDate),
                  supplierId,
                  currency: parsed.currency || 'EUR',
                  amount: parsed.amountTotal || 0,
                  description: parsed.description || file.filename,
                  status: parsed.amountTotal ? 'PAID' : 'PENDING',
                  year: isNaN(year) ? new Date().getFullYear() : year,
                  driveFileId: file.driveFileId,
                },
              });
              created++;
              log(`  ✅ Purchase created (amount=${parsed.amountTotal || 'unknown'})`);
            }
          } else if (!dryRun) {
            skipped++;
            const reason = !supplierId ? 'no supplier' : 'no date';
            log(`  ⚠️ Skipped (${reason})`);
          }
        } catch (fileErr) {
          failed++;
          log(`  ❌ Error: ${fileErr.message}`);
        }
      }

      jobs[jobId].status = 'done';
      jobs[jobId].result = { total: files.length, created, skipped, failed, results };
      log(`Done: created=${created} skipped=${skipped} failed=${failed}`);
    } catch (err) {
      jobs[jobId].status = 'error';
      jobs[jobId].error = err.message;
    }
  })();
});

// GET /api/backfill/coverage  — current backfill status
router.get('/coverage', auth, async (req, res) => {
  try {
    const coverage = await prisma.coverage.findMany({
      orderBy: [{ source: 'asc' }, { year: 'desc' }],
    });

    const summary = {
      total: coverage.length,
      done: coverage.filter(c => c.status === 'DONE').length,
      inProgress: coverage.filter(c => c.status === 'IN_PROGRESS').length,
      pending: coverage.filter(c => c.status === 'PENDING').length,
      totalFiles: coverage.reduce((s, c) => s + c.itemsFound, 0),
      processedFiles: coverage.reduce((s, c) => s + c.itemsDone, 0),
    };

    res.json({ summary, records: coverage });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/backfill/source-files  — list imported source files
router.get('/source-files', auth, async (req, res) => {
  try {
    const { type, year, search } = req.query;
    const where = {};
    if (type) where.type = type;
    if (year) where.folder = { contains: year };
    if (search) where.filename = { contains: search, mode: 'insensitive' };

    const files = await prisma.sourceFile.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    res.json({ count: files.length, files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/backfill/parse-documents  — create Document records from ALL Drive/Gmail PDF source files
// Body: { limit?: number, dryRun?: boolean }
router.post('/parse-documents', auth, adminOnly, async (req, res) => {
  const { limit = 100, dryRun = false } = req.body || {};

  const jobId = `parse-docs-${Date.now()}`;
  jobs[jobId] = { jobId, type: 'parse-documents', status: 'running', started: new Date(), log: [], result: null };
  res.json({ accepted: true, jobId, message: `Parsing documents (limit ${limit}, dryRun ${dryRun}). Poll GET /api/backfill/job/${jobId}` });

  (async () => {
    const log = msg => {
      console.log('[parse-documents]', msg);
      jobs[jobId].log.push(msg);
      if (jobs[jobId].log.length > 500) jobs[jobId].log.shift();
    };

    try {
      // Fetch all PDF source files (Drive + Gmail attachments)
      const allFiles = await prisma.sourceFile.findMany({
        where: {
          driveFileId: { not: null },
          OR: [
            { mimeType: { contains: 'pdf', mode: 'insensitive' } },
            { filename: { endsWith: '.pdf', mode: 'insensitive' } },
          ],
        },
        orderBy: { receivedAt: 'desc' },
        take: parseInt(limit) * 2,
      });

      // Filter out promotional/irrelevant files
      const SKIP_KEYWORDS = ['pricelist', 'price list', 'ценова листа', 'catalogue', 'каталог', 'newsletter'];
      const files = allFiles
        .filter(f => {
          const fl = (f.folder + ' ' + f.filename).toLowerCase();
          return !SKIP_KEYWORDS.some(kw => fl.includes(kw));
        })
        .slice(0, parseInt(limit));

      log(`Found ${files.length} PDF source files to process`);

      let created = 0, skipped = 0, failed = 0;

      // Detect document type from folder/filename
      const detectDocType = (folder, filename) => {
        const fl = (folder + ' ' + filename).toLowerCase();
        if (fl.includes('изходящи') || fl.includes('outgoing') || fl.includes('микро') || fl.includes('micro.bg')) return 'INVOICE_OUT';
        if (fl.includes('оферт') || fl.includes('offer') || fl.includes('проформ') || fl.includes('proform')) return 'PROFORMA';
        if (fl.includes('доставк') || fl.includes('delivery') || fl.includes('товарителница') || fl.includes('dn') || fl.includes('cmr')) return 'DELIVERY';
        if (fl.includes('фактура') || fl.includes('invoice') || fl.includes('входящи') || fl.includes('purchases')) return 'INVOICE_IN';
        return 'OTHER';
      };

      // Suggest action based on doc type
      const suggestAction = (docType, isOutgoing) => {
        if (isOutgoing || docType === 'INVOICE_OUT') return 'CREATE_INVOICE';
        if (docType === 'INVOICE_IN') return 'CREATE_PURCHASE';
        if (docType === 'DELIVERY') return 'ARCHIVE_ONLY';
        if (docType === 'PROFORMA') return 'ARCHIVE_ONLY';
        return 'ARCHIVE_ONLY';
      };

      for (const file of files) {
        try {
          // Skip if document already exists for this driveFileId
          const existing = await prisma.document.findFirst({
            where: { driveFileId: file.driveFileId },
          });
          if (existing) {
            skipped++;
            log(`SKIP (exists): ${file.filename}`);
            continue;
          }

          const outgoing = isOutgoingFolder(file.folder);
          const docType = detectDocType(file.folder, file.filename);
          const supplierId = !outgoing ? guessSupplierFromPath(file.folder, file.filename) : null;
          const parsed = parseFromFilename(file.filename, file.folder);

          log(`${file.filename} → type=${docType} supplier=${supplierId || '-'} outgoing=${outgoing}`);

          const extractedData = {
            invoiceNo: parsed.invoiceNo || null,
            date: parsed.docDate || null,
            supplierName: supplierId || null,
            description: parsed.description || file.filename,
            amount: parsed.amountTotal || null,
            currency: parsed.currency || 'BGN',
            folder: file.folder,
            source: file.type,
          };

          const riskFlags = [];
          if (!parsed.invoiceNo) riskFlags.push('MISSING_INVOICE_NO');
          if (!parsed.docDate) riskFlags.push('MISSING_DATE');
          if (!parsed.amountTotal) riskFlags.push('MISSING_AMOUNT');
          if (!supplierId && !outgoing) riskFlags.push('UNKNOWN_COUNTERPARTY');

          if (!dryRun) {
            await prisma.document.create({
              data: {
                driveFileId: file.driveFileId,
                driveUrl: file.driveUrl || `https://drive.google.com/file/d/${file.driveFileId}/view`,
                filename: file.filename,
                type: docType,
                status: 'PENDING',
                extractedData,
                confidence: parsed.confidence ? parseFloat(parsed.confidence) : (riskFlags.length === 0 ? 0.8 : 0.4),
                suggestedAction: suggestAction(docType, outgoing),
                riskFlags: riskFlags.length > 0 ? riskFlags : null,
              },
            });
            created++;
            log(`  ✅ Document created (type=${docType})`);
          } else {
            log(`  DRY-RUN: would create ${docType} doc`);
            created++;
          }
        } catch (fileErr) {
          failed++;
          log(`  ❌ ${file.filename}: ${fileErr.message}`);
        }
      }

      jobs[jobId].status = 'done';
      jobs[jobId].result = { total: files.length, created, skipped, failed };
      log(`Done: created=${created} skipped=${skipped} failed=${failed}`);
    } catch (err) {
      jobs[jobId].status = 'error';
      jobs[jobId].error = err.message;
    }
  })();
});

module.exports = router;
