const express = require('express');
const { auth } = require('../middleware/auth');
const { reviewDocument, analyzeDocument } = require('../lib/documentReview');
const { generateAlerts } = require('../lib/alertEngine');
const { downloadDriveFile } = require('../lib/aiParser');
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

// GET /api/documents/:id/file  — stream the Drive PDF to browser (inline viewer)
router.get('/:id/file', auth, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.driveFileId) return res.status(404).json({ error: 'No Drive file attached' });

    const buffer = await downloadDriveFile(doc.driveFileId);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${doc.filename || 'document.pdf'}"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/:id/link  — manually link document to invoice or purchase
router.post('/:id/link', auth, async (req, res) => {
  try {
    const { invoiceId, purchaseId } = req.body;
    if (!invoiceId && !purchaseId) return res.status(400).json({ error: 'invoiceId or purchaseId required' });

    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const updateData = { status: 'LINKED' };
    if (invoiceId) updateData.invoiceId = invoiceId;
    if (purchaseId) updateData.purchaseId = purchaseId;

    // Also copy driveFileId back to the linked record
    if (invoiceId && doc.driveFileId) {
      await prisma.invoice.updateMany({
        where: { id: invoiceId, driveFileId: null },
        data: { driveFileId: doc.driveFileId },
      });
    }
    if (purchaseId && doc.driveFileId) {
      await prisma.purchase.updateMany({
        where: { id: purchaseId, driveFileId: null },
        data: { driveFileId: doc.driveFileId },
      });
    }

    const updated = await prisma.document.update({ where: { id: doc.id }, data: updateData });
    res.json(updated);
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
    res.json(result);
    generateAlerts(prisma).catch(err => console.error('generateAlerts error:', err));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;


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
    res.json(result);
    // Run alert generation in background so the response isn't delayed ~20s
    generateAlerts(prisma).catch(err => console.error('generateAlerts error:', err));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
