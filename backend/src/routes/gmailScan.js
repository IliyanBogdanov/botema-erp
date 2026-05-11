/**
 * POST /api/gmail/scan        — trigger a manual scan (runs in background)
 * GET  /api/gmail/scan/status — last scan job status + log
 * POST /api/gmail/scan/history — import ALL historical emails (same as scan, no filter)
 */

const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { runGmailScan, getLastJobStatus } = require('../jobs/gmailScanJob');
const prisma = require('../lib/prisma');

// POST /api/gmail-scan — start scan in background, return immediately
router.post('/', auth, (req, res) => {
  const job = getLastJobStatus();
  if (job.status === 'running') {
    return res.json({ running: true, job });
  }
  // Start in background — don't await
  runGmailScan(prisma).catch(err => console.error('[GmailScan route] error:', err));
  res.json({ started: true, message: 'Gmail scan started. Check /api/gmail-scan/status for progress.' });
});

// GET /api/gmail-scan/status
router.get('/status', auth, (req, res) => {
  res.json(getLastJobStatus());
});

module.exports = router;
