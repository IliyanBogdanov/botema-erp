const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// GET /api/biz-documents
router.get('/', auth, async (req, res) => {
  try {
    const { status, docType, counterpartyId, projectId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (docType) where.docType = docType;
    if (counterpartyId) where.counterpartyId = counterpartyId;
    if (projectId) where.projectId = projectId;

    const docs = await prisma.bizDocument.findMany({
      where,
      include: {
        counterparty: { select: { id: true, name: true, type: true } },
        project: { select: { id: true, code: true, name: true } },
        sourceFile: { select: { id: true, filename: true, driveUrl: true } },
        lines: true,
        reconciliationLinks: true,
        linkedTo: true,
        missingDocuments: true,
      },
      orderBy: { docDate: 'desc' },
    });
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/biz-documents/graph — all linked doc chains for network view
router.get('/graph', auth, async (req, res) => {
  try {
    const links = await prisma.reconciliationLink.findMany({
      include: {
        sourceDoc: {
          select: {
            id: true, docType: true, docNumber: true, status: true,
            amountTotal: true, currency: true, docDate: true,
            counterparty: { select: { id: true, name: true } },
            project: { select: { id: true, code: true, name: true } },
          },
        },
        targetDoc: {
          select: {
            id: true, docType: true, docNumber: true, status: true,
            amountTotal: true, currency: true, docDate: true,
            counterparty: { select: { id: true, name: true } },
            project: { select: { id: true, code: true, name: true } },
          },
        },
        payment: {
          select: { id: true, amount: true, currency: true, paymentDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // Build chains. Payment links often only have a target document; use it as
    // the root so the graph is not collapsed into a single null bucket.
    const chains = new Map();
    for (const link of links) {
      const root = link.sourceDoc || link.targetDoc;
      if (!root) continue;
      const key = root.id;
      if (!chains.has(key)) {
        chains.set(key, { root, links: [] });
      }
      chains.get(key).links.push({
        linkType: link.linkType,
        confidence: link.confidence,
        target: link.sourceDoc && link.targetDoc ? link.targetDoc : null,
        payment: link.payment,
      });
    }

    const stats = { totalLinks: links.length, byType: {} };
    for (const link of links) {
      stats.byType[link.linkType] = (stats.byType[link.linkType] || 0) + 1;
    }

    res.json({ chains: [...chains.values()], stats, total: chains.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/biz-documents/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await prisma.bizDocument.findUnique({
      where: { id: req.params.id },
      include: {
        counterparty: true,
        project: true,
        sourceFile: true,
        lines: true,
        reconciliationLinks: {
          include: {
            targetDoc: { select: { id: true, docType: true, docNumber: true } },
            payment: { select: { id: true, amount: true, currency: true, paymentDate: true } },
          },
        },
        linkedTo: {
          include: {
            sourceDoc: { select: { id: true, docType: true, docNumber: true } },
          },
        },
        missingDocuments: true,
      },
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/biz-documents/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const doc = await prisma.bizDocument.update({
      where: { id: req.params.id },
      data: { status, ...(notes && { notes }) },
    });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
