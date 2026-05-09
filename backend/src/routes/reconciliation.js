const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');
const { autoMatch, getStats } = require('../lib/reconciliationEngine');

// GET /api/reconciliation — all links
router.get('/', auth, async (req, res) => {
  try {
    const { linkType } = req.query;
    const links = await prisma.reconciliationLink.findMany({
      where: linkType ? { linkType } : undefined,
      include: {
        sourceDoc: { select: { id: true, docType: true, docNumber: true, counterpartyId: true } },
        targetDoc: { select: { id: true, docType: true, docNumber: true } },
        payment: { select: { id: true, amount: true, currency: true, paymentDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(links);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/missing
router.get('/missing', auth, async (req, res) => {
  try {
    const missing = await prisma.missingDocument.findMany({
      where: { status: 'OPEN' },
      include: {
        counterparty: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true } },
        relatedDoc: { select: { id: true, docType: true, docNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(missing);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/coverage
router.get('/coverage', auth, async (req, res) => {
  try {
    const coverage = await prisma.coverage.findMany({ orderBy: [{ source: 'asc' }, { year: 'desc' }] });
    res.json(coverage);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/stats?year=2025
router.get('/stats', auth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : null;
    const stats = await getStats(year);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reconciliation/auto-match?year=2025
router.post('/auto-match', auth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : null;
    const result = await autoMatch({ year });
    res.json(result);
  } catch (e) {
    console.error('auto-match error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
