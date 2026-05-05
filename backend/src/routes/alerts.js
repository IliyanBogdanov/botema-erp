const express = require('express');
const { auth } = require('../middleware/auth');
const { generateAlerts, sendDailyDigest } = require('../lib/alertEngine');
const prisma = require('../lib/prisma');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const { status = 'ACTIVE', type, severity, limit = 100 } = req.query;
    await generateAlerts(prisma);
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

router.post('/digest', auth, async (req, res) => {
  try {
    const result = await sendDailyDigest(prisma);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
