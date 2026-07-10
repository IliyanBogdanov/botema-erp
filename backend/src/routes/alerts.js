const express = require('express');
const { auth } = require('../middleware/auth');
const { generateAlerts, sendDailyDigest } = require('../lib/alertEngine');
const prisma = require('../lib/prisma');

const router = express.Router();

// Lightweight badge endpoint — count only, no generation, no row transfer
router.get('/count', auth, async (req, res) => {
  try {
    const count = await prisma.alert.count({
      where: { status: 'ACTIVE', OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }] },
    });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alert generation is EXPENSIVE (scans documents/invoices/projects) — it runs
// via POST /alerts/generate and the daily cron, NOT on every list request.
// (The sidebar used to poll this route every 60s, which alone burned the
// Supabase egress quota.)
let lastGenerate = 0;
router.get('/', auth, async (req, res) => {
  try {
    const { status = 'ACTIVE', type, severity, limit = 100 } = req.query;
    // Refresh at most once per hour, piggybacked on a real page visit
    if (Date.now() - lastGenerate > 60 * 60 * 1000) {
      lastGenerate = Date.now();
      generateAlerts(prisma).catch(e => console.error('generateAlerts:', e.message));
    }
    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (severity) where.severity = severity;
    if (status === 'ACTIVE') {
      where.OR = [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }];
    }
    const alerts = await prisma.alert.findMany({
      where,
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: parseInt(limit),
      include: {
        document: { select: { id: true, filename: true, driveUrl: true, status: true } },
        invoice: { select: { id: true, number: true, amountTotal: true, currency: true, status: true } },
        purchase: { select: { id: true, invoiceNo: true, amount: true, currency: true } },
        project: { select: { id: true, code: true, name: true } },
      },
    });
    res.json(alerts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const data = {};
    if (req.body.status) data.status = req.body.status;
    if (req.body.status === 'RESOLVED') data.resolvedAt = new Date();
    if (req.body.snoozedUntil) {
      data.status = 'SNOOZED';
      data.snoozedUntil = new Date(req.body.snoozedUntil);
    }
    const alert = await prisma.alert.update({ where: { id: req.params.id }, data });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', auth, async (req, res) => {
  try {
    const alerts = await generateAlerts(prisma);
    res.json({ count: alerts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alerts/bulk-resolve — resolve many alerts at once by filter
router.post('/bulk-resolve', auth, async (req, res) => {
  try {
    const { type, severity, status = 'ACTIVE' } = req.body;
    const where = { status };
    if (type) where.type = type;
    if (severity) where.severity = severity;
    const result = await prisma.alert.updateMany({
      where,
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    res.json({ resolved: result.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/digest', auth, async (req, res) => {
  try {
    const result = await sendDailyDigest(prisma);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
