const express = require('express');
const { auth } = require('../middleware/auth');
const { reviewDocument, analyzeDocument } = require('../lib/documentReview');
const { generateAlerts } = require('../lib/alertEngine');
const prisma = require('../lib/prisma');

const router = express.Router();

router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const where = status ? { status } : {};
    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;
    const [docs, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { alerts: { where: { status: 'ACTIVE' }, orderBy: { detectedAt: 'desc' } } },
      }),
      prisma.document.count({ where }),
    ]);
    res.json({ data: docs, total, page: parseInt(page), pages: Math.ceil(total / take) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const doc = await prisma.document.update({ where: { id: req.params.id }, data: req.body });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/analyze', auth, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const analysis = await analyzeDocument(prisma, doc.extractedData || {});
    const updated = await prisma.document.update({ where: { id: doc.id }, data: analysis });
    await generateAlerts(prisma);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/review', auth, async (req, res) => {
  try {
    const result = await reviewDocument(prisma, req.params.id, req.body, req.user.id);
    await generateAlerts(prisma);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
