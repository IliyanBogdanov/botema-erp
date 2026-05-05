const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const adminOnly = requireRole('ADMIN');
const { gmailBackfill, driveBackfill, importInventoryFromRows } = require('../lib/backfill');
const prisma = require('../lib/prisma');

// POST /api/backfill/gmail/:year  — scan Gmail for a year
router.post('/gmail/:year', auth, adminOnly, async (req, res) => {
  const year = parseInt(req.params.year);
  if (isNaN(year) || year < 2020 || year > 2030) {
    return res.status(400).json({ error: 'Invalid year' });
  }

  // Stream progress via SSE or just respond async
  res.setHeader('Content-Type', 'application/json');

  console.log(`[backfill] Starting Gmail backfill for ${year}...`);
  try {
    const result = await gmailBackfill(year, (done, total, msg) => {
      console.log(`[backfill] Gmail ${year}: ${done}/${total} — ${msg}`);
    });
    console.log(`[backfill] Gmail ${year} done:`, result);
    res.json({ success: true, year, ...result });
  } catch (e) {
    console.error('[backfill] Gmail error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/backfill/drive  — scan a Drive folder
// Body: { folderId, folderPath, year }
router.post('/drive', auth, adminOnly, async (req, res) => {
  const { folderId, folderPath, year } = req.body;
  if (!folderId || !year) return res.status(400).json({ error: 'folderId and year required' });

  console.log(`[backfill] Starting Drive backfill: ${folderPath} (${year})...`);
  try {
    const result = await driveBackfill(
      folderId,
      folderPath || `Drive/${year}`,
      parseInt(year),
      (done, total, name) => console.log(`[backfill] Drive: ${done}/${total} — ${name}`)
    );
    res.json({ success: true, year, folderPath, ...result });
  } catch (e) {
    console.error('[backfill] Drive error:', e.message);
    res.status(500).json({ error: e.message });
  }
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

module.exports = router;
