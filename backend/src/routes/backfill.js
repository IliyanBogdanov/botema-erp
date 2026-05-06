const express = require('express');
const router = express.Router();
const { auth, requireRole } = require('../middleware/auth');
const adminOnly = requireRole('ADMIN');
const { gmailBackfill, driveBackfill, importInventoryFromRows } = require('../lib/backfill');
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
