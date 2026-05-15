const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const adminOnly = requireRole('ADMIN');
const { gmailBackfill, driveBackfill, importInventoryFromRows } = require('../lib/backfill');
const { downloadDriveFile, parseDocumentWithAI, parseFromFilename, guessSupplierFromPath, guessFolderType, isOutgoingFolder } = require('../lib/aiParser');
const { autoMatch } = require('../lib/reconciliationEngine');
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
                  // English month-based structure (2024/2025)
                  { folder: { contains: 'January', mode: 'insensitive' } },
                  { folder: { contains: 'February', mode: 'insensitive' } },
                  { folder: { contains: 'March', mode: 'insensitive' } },
                  { folder: { contains: 'April', mode: 'insensitive' } },
                  { folder: { contains: 'May', mode: 'insensitive' } },
                  { folder: { contains: 'June', mode: 'insensitive' } },
                  { folder: { contains: 'July', mode: 'insensitive' } },
                  { folder: { contains: 'August', mode: 'insensitive' } },
                  { folder: { contains: 'September', mode: 'insensitive' } },
                  { folder: { contains: 'October', mode: 'insensitive' } },
                  { folder: { contains: 'November', mode: 'insensitive' } },
                  { folder: { contains: 'December', mode: 'insensitive' } },
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
            await new Promise(r => setTimeout(r, 2000));
          } catch (dlErr) {
            log(`  AI failed [${dlErr.status || dlErr.statusCode || 'ERR'}]: ${dlErr.message.substring(0, 150)} — using heuristic fallback`);
            parsed = parseFromFilename(file.filename, file.folder);
          }

          log(`  → invoiceNo=${parsed.invoiceNo} date=${parsed.docDate} total=${parsed.amountTotal} ${parsed.currency} conf=${parsed.confidence}`);

          results.push({ file: file.filename, parsed, supplierId });

          if (!dryRun) {
            // Use receivedAt as fallback date if AI/heuristic didn't find one
            const effectiveDate = parsed.docDate
              ? new Date(parsed.docDate)
              : file.receivedAt
                ? new Date(file.receivedAt)
                : new Date();
            const year = effectiveDate.getFullYear();

            if (existing && forceUpdate) {
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
                  date: effectiveDate,
                  supplierId: supplierId || undefined, // null if unknown — stored for manual review
                  currency: parsed.currency || 'EUR',
                  amount: parsed.amountTotal || 0,
                  description: parsed.description || file.filename,
                  status: parsed.amountTotal ? 'PAID' : 'PENDING',
                  year: isNaN(year) ? new Date().getFullYear() : year,
                  driveFileId: file.driveFileId,
                },
              });
              created++;
              if (!supplierId) log(`  ✅ Purchase created (no supplier matched — needs manual review)`);
              else if (!parsed.docDate) log(`  ✅ Purchase created (used receivedAt as date)`);
              else log(`  ✅ Purchase created (amount=${parsed.amountTotal || 'unknown'})`);
            }
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

// POST /api/backfill/purchases-to-bizdocs
// Migrates existing Purchase (INVOICE_IN) and Invoice (INVOICE_OUT) records
// into the BizDocument model so they can be reconciled with bank payments.
router.post('/purchases-to-bizdocs', auth, adminOnly, async (req, res) => {
  const { dryRun = false, includePurchases = true, includeInvoices = true } = req.body || {};

  const jobId = `p2b-${Date.now()}`;
  jobs[jobId] = { jobId, type: 'purchases-to-bizdocs', status: 'running', started: new Date(), log: [], result: null };
  res.json({ accepted: true, jobId, message: `Migration started. Poll GET /api/backfill/job/${jobId}` });

  (async () => {
    const log = msg => {
      console.log('[p2bd]', msg);
      jobs[jobId].log.push(msg);
      if (jobs[jobId].log.length > 500) jobs[jobId].log.shift();
    };

    try {
      let cpCreated = 0, purchasesDone = 0, invoicesDone = 0, skipped = 0;

      // Cache to avoid repeated DB lookups for same counterparty name
      const cpCache = {};
      const findOrCreateCp = async (name, type, currency = 'EUR', country = 'BG') => {
        const key = `${type}:${(name || '').toLowerCase().trim()}`;
        if (cpCache[key]) return cpCache[key];

        let cp = await prisma.counterparty.findFirst({
          where: { name: { equals: name.trim(), mode: 'insensitive' }, type },
          select: { id: true },
        });
        if (!cp) {
          cp = await prisma.counterparty.create({
            data: { name: name.trim(), type, country: country || 'BG', currency: currency || 'EUR' },
            select: { id: true },
          });
          cpCreated++;
          log(`  [NEW CP] ${type}: ${name}`);
        }
        cpCache[key] = cp;
        return cp;
      };

      // ── 1. Purchases → BizDocument INVOICE_IN ──────────────────────────────
      if (includePurchases) {
        const purchases = await prisma.purchase.findMany({
          include: { supplier: { select: { name: true, currency: true, country: true } } },
          orderBy: { date: 'asc' },
        });
        log(`Found ${purchases.length} purchases to migrate`);

        for (const p of purchases) {
          const alreadyDone = await prisma.bizDocument.findFirst({
            where: { internalRef: p.id },
            select: { id: true },
          });
          if (alreadyDone) { skipped++; continue; }

          const supplierName = p.supplier?.name || 'Неизвестен доставчик';
          let counterpartyId = null;
          try {
            const cp = await findOrCreateCp(
              supplierName, 'SUPPLIER',
              p.supplier?.currency || 'EUR',
              p.supplier?.country || 'BG',
            );
            counterpartyId = cp.id;
          } catch (e) {
            log(`  WARN: CP lookup failed for ${supplierName}: ${e.message}`);
          }

          if (!dryRun) {
            await prisma.bizDocument.create({
              data: {
                docType: 'INVOICE_IN',
                docNumber: p.invoiceNo || null,
                docDate: p.date,
                amountTotal: p.amount,
                currency: p.currency || 'EUR',
                vatType: 'STANDARD_BG',
                status: 'IMPORTED',
                counterpartyId,
                internalRef: p.id,
                externalRef: p.driveFileId || null,
                confidence: 90,
                notes: `Мигрирано от Purchase ${p.id}`,
              },
            });
          }
          purchasesDone++;
          if (purchasesDone % 25 === 0) log(`  ... ${purchasesDone} purchases migrated`);
        }
        log(`Purchases: ${purchasesDone} created, ${skipped} already migrated`);
      }

      // ── 2. Invoices → BizDocument INVOICE_OUT ──────────────────────────────
      if (includeInvoices) {
        const invoices = await prisma.invoice.findMany({
          include: { client: { select: { name: true, eik: true } } },
          orderBy: { date: 'asc' },
        });
        log(`Found ${invoices.length} invoices to migrate`);
        let invSkipped = 0;

        for (const inv of invoices) {
          const alreadyDone = await prisma.bizDocument.findFirst({
            where: { internalRef: inv.id },
            select: { id: true },
          });
          if (alreadyDone) { invSkipped++; continue; }

          const clientName = inv.client?.name || 'Неизвестен клиент';
          let counterpartyId = null;
          try {
            const cp = await findOrCreateCp(clientName, 'CLIENT', inv.currency || 'BGN', 'BG');
            counterpartyId = cp.id;
          } catch (e) {
            log(`  WARN: CP lookup failed for client ${clientName}: ${e.message}`);
          }

          if (!dryRun) {
            await prisma.bizDocument.create({
              data: {
                docType: 'INVOICE_OUT',
                docNumber: inv.number,
                docDate: inv.date,
                dueDate: inv.dueDate || null,
                amountNet: inv.amountNet,
                vatAmount: inv.vatAmount,
                amountTotal: inv.amountTotal,
                currency: inv.currency || 'BGN',
                vatType: 'STANDARD_BG',
                status: 'IMPORTED',
                counterpartyId,
                internalRef: inv.id,
                confidence: 95,
                notes: `Мигрирано от Invoice ${inv.id}`,
              },
            });
          }
          invoicesDone++;
        }
        log(`Invoices: ${invoicesDone} created, ${invSkipped} already migrated`);
      }

      jobs[jobId].status = 'done';
      jobs[jobId].result = {
        purchasesMigrated: purchasesDone,
        invoicesMigrated: invoicesDone,
        counterpartiesCreated: cpCreated,
        skipped,
        dryRun,
      };
      log(`Migration complete! Purchases: ${purchasesDone}, Invoices: ${invoicesDone}, New CPs: ${cpCreated}`);
    } catch (err) {
      jobs[jobId].status = 'error';
      jobs[jobId].error = err.message;
      log(`FATAL: ${err.message}`);
    }
  })();
});

// POST /api/backfill/link-counterparties
// Fuzzy-matches bank-imported counterparties (type: OTHER) to known suppliers (type: SUPPLIER)
// and re-links Payment records so reconciliation Step 2 (counterparty+amount) can work.
router.post('/link-counterparties', auth, adminOnly, async (req, res) => {
  const { dryRun = false } = req.body || {};

  // Keyword map: patterns in bank name → supplier canonical name (lowercase)
  const BANK_TO_SUPPLIER = [
    { patterns: ['лодес', 'lodes'],                                       name: 'Lodes' },
    { patterns: ['алфалуче', 'alphaluce', 'алфа луче'],                   name: 'Alphaluce' },
    { patterns: ['поларис', 'polaris'],                                    name: 'Polaris' },
    { patterns: ['новалуче', 'novaluce'],                                  name: 'Novaluce' },
    { patterns: ['ака лайтинг', 'aca lighting', 'ака'],                   name: 'ACA Lighting' },
    { patterns: ['амбиентек', 'ambientec'],                                name: 'Ambientec' },
    { patterns: ['антракс', 'antrax'],                                     name: 'Antrax' },
    { patterns: ['седап', 'atelier sedap', 'ателие седап'],                name: 'Atelier Sedap' },
    { patterns: ['братя брага', 'fratelli braga', 'braga'],               name: 'Fratelli Braga' },
    { patterns: ['формани', 'formani'],                                    name: 'Formani' },
    { patterns: ['каримоку', 'karimoku'],                                  name: 'Karimoku' },
    { patterns: ['kraab', 'краб'],                                         name: 'Kraab' },
    { patterns: ['совет итали', 'sovet'],                                  name: 'Sovet Italia' },
    { patterns: ['дхл', 'dhl express'],                                    name: 'DHL' },
    { patterns: ['омега лайт', 'omega light', 'omega'],                   name: 'Omega Light' },
    { patterns: ['спиди', 'speedy'],                                       name: 'Speedy' },
    { patterns: ['зиета', 'zieta'],                                        name: 'Zieta' },
    { patterns: ['макро', 'macro'],                                        name: 'Macro' },
    { patterns: ['микроинвест', 'microinvest'],                           name: 'Microinvest' },
    { patterns: ['еконт', 'econt'],                                        name: 'Econt' },
    { patterns: ['дхл', 'dhl'],                                            name: 'DHL' },
    { patterns: ['боналдо', 'bonaldo'],                                    name: 'Bonaldo' },
    { patterns: ['топ диджитал', 'top digital'],                          name: 'Top Digital' },
    { patterns: ['фейсбук', 'facebook', 'meta'],                          name: 'Facebook/Meta Ads' },
    { patterns: ['гугъл', 'google ads', 'google'],                        name: 'Google Ads' },
    { patterns: ['супърхостинг', 'superhosting'],                         name: 'Superhosting' },
    { patterns: ['нест студио', 'nest studio'],                           name: 'Nest Studio' },
    { patterns: ['ултралайт', 'ultralight', 'рашев', 'rashev'],           name: 'Rashev Ultralight' },
    { patterns: ['зира дизайн', 'zira design'],                          name: 'Zira Design' },
    { patterns: ['наем', 'rent', 'шоурум', 'showroom', 'наемател'],      name: 'Наем/Шоурум' },
    { patterns: ['счетоводн', 'accountan', 'одитор'],                    name: 'Счетоводство' },
    { patterns: ['ват ', 'watt', 'ватт'],                                  name: 'Watt' },
  ];

  function normalizeBankName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/["“”]/g, '')
      .replace(/\bеоод\b|\bоод\b|\bад\b|\bет\b|\bдззд\b|\bgmbh\b|\bltd\b|\bllc\b|\bs\.a\b|\binc\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function matchSupplier(bankName) {
    const norm = normalizeBankName(bankName);
    for (const { patterns, name } of BANK_TO_SUPPLIER) {
      if (patterns.some(p => norm.includes(p))) return name;
    }
    return null;
  }

  const jobId = `link-cp-${Date.now()}`;
  const job = { jobId, type: 'link-counterparties', status: 'running', started: new Date(), log: [], result: null };
  jobs[jobId] = job;

  res.json({ accepted: true, jobId, message: `CP linking started. Poll GET /api/backfill/job/${jobId}` });

  (async () => {
    const log = msg => {
      console.log('[link-cp]', msg);
      job.log.push(msg);
      if (job.log.length > 300) job.log.shift();
    };

    try {
      // Get all bank-imported counterparties (type OTHER)
      const bankCPs = await prisma.counterparty.findMany({
        where: { type: 'OTHER' },
        select: { id: true, name: true },
      });
      log(`Found ${bankCPs.length} bank counterparties to process`);

      // Cache of supplier counterparties we find/create
      const supplierCpCache = {};
      const findOrCreateSupplierCp = async (supplierName) => {
        if (supplierCpCache[supplierName]) return supplierCpCache[supplierName];
        let cp = await prisma.counterparty.findFirst({
          where: { name: { equals: supplierName, mode: 'insensitive' }, type: 'SUPPLIER' },
          select: { id: true },
        });
        if (!cp) {
          cp = await prisma.counterparty.create({
            data: { name: supplierName, type: 'SUPPLIER', country: 'BG', currency: 'EUR' },
            select: { id: true },
          });
          log(`  [NEW SUPPLIER CP] ${supplierName}`);
        }
        supplierCpCache[supplierName] = cp;
        return cp;
      };

      let linked = 0, noMatch = 0, paymentsUpdated = 0;

      for (const bankCp of bankCPs) {
        const supplierName = matchSupplier(bankCp.name);
        if (!supplierName) {
          noMatch++;
          continue;
        }

        const supplierCp = await findOrCreateSupplierCp(supplierName);
        log(`  MATCH: "${bankCp.name}" → "${supplierName}" (${supplierCp.id})`);
        linked++;

        if (!dryRun) {
          // Re-point all Payments from this bank CP to the supplier CP
          const updateResult = await prisma.payment.updateMany({
            where: { counterpartyId: bankCp.id },
            data: { counterpartyId: supplierCp.id },
          });
          paymentsUpdated += updateResult.count;

          // Also update the bank CP type to avoid re-processing
          await prisma.counterparty.update({
            where: { id: bankCp.id },
            data: { type: 'OTHER', notes: `Linked to ${supplierName} (${supplierCp.id})` },
          });
        }
      }

      job.status = 'done';
      job.result = { bankCPsProcessed: bankCPs.length, linked, noMatch, paymentsUpdated, dryRun };
      log(`Done: ${linked} matched, ${noMatch} unmatched, ${paymentsUpdated} payments re-linked`);
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      log(`FATAL: ${err.message}`);
    }
  })();
});

// POST /api/backfill/run-all — Full sequential import pipeline (Gmail + Drive + Parse + Reconcile)
router.post('/run-all', auth, adminOnly, (req, res) => {
  const jobId = `run-all-${Date.now()}`;
  jobs[jobId] = { jobId, type: 'run-all', status: 'running', started: new Date(), log: [], result: {} };

  res.json({ accepted: true, jobId, message: `Full import pipeline started. Poll GET /api/backfill/job/${jobId}` });

  (async () => {
    const job = jobs[jobId];
    const log = msg => {
      console.log('[run-all]', msg);
      job.log.push(msg);
      if (job.log.length > 1000) job.log.shift();
    };

    try {
      const YEARS = [2023, 2024, 2025, 2026];

      // ── Step 1: Gmail scan for each year ──────────────────────────────────
      log('▶ Step 1/6: Gmail scan (2023–2026)...');
      for (const year of YEARS) {
        try {
          log(`  Scanning Gmail ${year}...`);
          const result = await gmailBackfill(year, (done, total, msg) => {
            if (done % 10 === 0 || done === total) log(`    Gmail ${year}: ${done}/${total} — ${msg}`);
          });
          log(`  ✅ Gmail ${year}: ${result?.processed || 0} emails processed, ${result?.attachments || 0} PDFs found`);
          job.result[`gmail_${year}`] = result;
        } catch (e) {
          log(`  ⚠️ Gmail ${year} error: ${e.message}`);
        }
      }

      // ── Step 2: Drive scan ────────────────────────────────────────────────
      log('▶ Step 2/6: Drive scan...');
      const driveFolderId = process.env.DRIVE_INVOICES_FOLDER_ID;
      if (driveFolderId) {
        try {
          const driveResult = await driveBackfill(driveFolderId, 'Drive', new Date().getFullYear(), (done, total, name) => {
            if (done % 20 === 0 || done === total) log(`    Drive: ${done}/${total} — ${name}`);
          });
          log(`  ✅ Drive: ${driveResult?.processed || 0} files scanned`);
          job.result.drive = driveResult;
        } catch (e) {
          log(`  ⚠️ Drive error: ${e.message}`);
        }
      } else {
        log('  ⚠️ DRIVE_INVOICES_FOLDER_ID not set — skipping Drive scan');
      }

      // ── Step 3: Parse new Drive PDFs as purchases ─────────────────────────
      log('▶ Step 3/6: Parsing new Drive PDFs into Purchase records...');
      try {
        const allFiles = await prisma.sourceFile.findMany({
          where: {
            type: 'DRIVE',
            driveFileId: { not: null },
            OR: [
              { mimeType: { contains: 'pdf', mode: 'insensitive' } },
              { filename: { endsWith: '.pdf', mode: 'insensitive' } },
            ],
          },
          orderBy: { receivedAt: 'desc' },
          take: 500,
        });
        const EXCLUDE = ['изходящи', 'outgoing', 'оферти', 'оферта', 'delivery', 'доставк'];
        const INCLUDE_FOLDERS = [
          'входящи', 'purchases', 'imports', 'лодес', 'поларис', 'фактур', 'поръчк',
          'january', 'february', 'march', 'april', 'may', 'june', 'july',
          'august', 'september', 'october', 'november', 'december',
        ];
        const files = allFiles.filter(f => {
          const fl = f.folder.toLowerCase();
          if (EXCLUDE.some(kw => fl.includes(kw))) return false;
          return INCLUDE_FOLDERS.some(kw => fl.includes(kw));
        });
        log(`  Found ${files.length} purchase-folder Drive files`);
        let created = 0, skipped = 0, failed = 0;
        for (const file of files) {
          try {
            const existing = await prisma.purchase.findFirst({ where: { driveFileId: file.driveFileId } });
            if (existing) { skipped++; continue; }
            const supplierId = guessSupplierFromPath(file.folder, file.filename);
            let parsed;
            try {
              const pdfBuffer = await downloadDriveFile(file.driveFileId);
              parsed = await parseDocumentWithAI(file.filename, file.folder, pdfBuffer);
              await new Promise(r => setTimeout(r, 2000));
            } catch { parsed = parseFromFilename(file.filename, file.folder); }
            const effectiveDate = parsed.docDate ? new Date(parsed.docDate) : file.receivedAt ? new Date(file.receivedAt) : new Date();
            await prisma.purchase.create({
              data: {
                invoiceNo: parsed.invoiceNo || undefined,
                date: effectiveDate,
                supplierId: supplierId || undefined,
                currency: parsed.currency || 'EUR',
                amount: parsed.amountTotal || 0,
                description: parsed.description || file.filename,
                status: parsed.amountTotal ? 'PAID' : 'PENDING',
                year: effectiveDate.getFullYear(),
                driveFileId: file.driveFileId,
              },
            });
            created++;
            if (created % 10 === 0) log(`    Parsed ${created} new purchases...`);
          } catch (e) { failed++; }
        }
        log(`  ✅ Parse new: created=${created} skipped=${skipped} failed=${failed}`);
        job.result.parsePurchases = { created, skipped, failed };
      } catch (e) {
        log(`  ⚠️ Parse purchases error: ${e.message}`);
      }

      // ── Step 4: Reparse zero-amount purchases ─────────────────────────────
      log('▶ Step 4/6: Reparsing zero-amount purchases...');
      try {
        const zeroPurchases = await prisma.purchase.findMany({
          where: { amount: 0, driveFileId: { not: null } },
          take: 100,
        });
        log(`  Found ${zeroPurchases.length} zero-amount purchases to fix`);
        let reparsed = 0, reFailed = 0;
        for (const p of zeroPurchases) {
          try {
            const pdfBuffer = await downloadDriveFile(p.driveFileId);
            const sf = await prisma.sourceFile.findFirst({ where: { driveFileId: p.driveFileId } });
            const folder = sf?.folder || '';
            const parsed = await parseDocumentWithAI(p.description || p.driveFileId, folder, pdfBuffer);
            await new Promise(r => setTimeout(r, 2000));
            if (parsed.amountTotal && parsed.amountTotal > 0) {
              await prisma.purchase.update({
                where: { id: p.id },
                data: {
                  amount: parsed.amountTotal,
                  currency: parsed.currency || p.currency,
                  invoiceNo: parsed.invoiceNo || p.invoiceNo,
                  status: 'PAID',
                },
              });
              reparsed++;
              if (reparsed % 5 === 0) log(`    Fixed ${reparsed} zero-amount purchases...`);
            }
          } catch { reFailed++; }
        }
        log(`  ✅ Reparse: fixed=${reparsed} failed=${reFailed}`);
        job.result.reparsed = { fixed: reparsed, failed: reFailed };
      } catch (e) {
        log(`  ⚠️ Reparse error: ${e.message}`);
      }

      // ── Step 5: Auto-match reconciliation for each year ───────────────────
      log('▶ Step 5/6: Auto-match reconciliation (2023–2026)...');
      let totalMatched = 0;
      for (const year of YEARS) {
        try {
          const result = await autoMatch({ year });
          log(`  ✅ Reconcile ${year}: matched=${result.matched} partial=${result.partial} unmatched=${result.unmatched}`);
          totalMatched += result.matched || 0;
          job.result[`reconcile_${year}`] = result;
        } catch (e) {
          log(`  ⚠️ Reconcile ${year} error: ${e.message}`);
        }
      }
      log(`  Total newly matched: ${totalMatched}`);

      // ── Step 6: Sync invoice statuses ─────────────────────────────────────
      log('▶ Step 6/6: Syncing invoice statuses...');
      try {
        const links = await prisma.reconciliationLink.findMany({
          where: { linkType: 'PAYMENT_TO_INVOICE', targetDocId: { not: null } },
          include: {
            payment: { select: { status: true } },
            targetDoc: { select: { docNumber: true, docType: true } },
          },
        });
        const matchedLinks = links.filter(l =>
          (l.payment?.status === 'MATCHED' || l.payment?.status === 'PARTIAL') &&
          l.targetDoc?.docType === 'INVOICE_OUT'
        );
        let synced = 0;
        for (const link of matchedLinks) {
          const docNumber = link.targetDoc?.docNumber;
          if (!docNumber) continue;
          const strippedNum = docNumber.replace(/^0+/, '') || docNumber;
          const paddedNum = strippedNum.padStart(10, '0');
          const invoice = await prisma.invoice.findFirst({
            where: { number: { in: [docNumber, strippedNum, paddedNum] }, status: { not: 'PAID' } },
            select: { id: true },
          });
          if (invoice) {
            await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID' } });
            synced++;
          }
        }
        log(`  ✅ Synced ${synced} invoices to PAID`);
        job.result.syncedInvoices = synced;
      } catch (e) {
        log(`  ⚠️ Sync error: ${e.message}`);
      }

      job.status = 'done';
      log('✅ Full import pipeline complete!');
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      job.log.push(`FATAL: ${err.message}`);
    }
  })();
});

module.exports = router;
