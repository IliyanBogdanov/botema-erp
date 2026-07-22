const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

async function getDuplicateGroups(limit = 25) {
  return prisma.$queryRaw`
    SELECT
      "docType",
      "docNumber",
      currency,
      COALESCE("counterpartyId", '') AS "counterpartyId",
      ROUND(COALESCE("amountTotal", 0)::numeric, 2)::text AS amount,
      COUNT(*)::int AS cnt
    FROM biz_documents
    WHERE "docNumber" IS NOT NULL
      AND status NOT IN ('REJECTED', 'ARCHIVED')
    GROUP BY 1, 2, 3, 4, 5
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, "docType" ASC, "docNumber" ASC
    LIMIT ${limit}
  `;
}

// GET /api/biz-documents
router.get('/', auth, async (req, res) => {
  try {
    const { status, docType, counterpartyId, projectId, year } = req.query;
    const where = {};
    // Without an explicit status filter, hide rejected/archived noise by default
    where.status = status ? status : { notIn: ['REJECTED', 'ARCHIVED'] };
    if (docType) where.docType = docType;
    if (counterpartyId) where.counterpartyId = counterpartyId;
    if (projectId) where.projectId = projectId;
    if (year) {
      where.docDate = {
        gte: new Date(`${year}-01-01T00:00:00.000Z`),
        lte: new Date(`${year}-12-31T23:59:59.999Z`),
      };
    }

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

// GET /api/biz-documents/review-queue
router.get('/review-queue', auth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const where = {
      status: { notIn: ['MATCHED', 'ARCHIVED', 'REJECTED'] },
      OR: [
        { status: 'NEEDS_REVIEW' },
        { confidence: { lt: 75 } },
        { docNumber: null },
        { docDate: null },
        { amountTotal: null },
      ],
    };
    const [docs, duplicateGroups, statusCounts] = await Promise.all([
      prisma.bizDocument.findMany({
        where,
        include: {
          counterparty: { select: { id: true, name: true, type: true } },
          project: { select: { id: true, code: true, name: true } },
          sourceFile: { select: { id: true, filename: true, driveUrl: true, folder: true, fromEmail: true } },
          reconciliationLinks: { select: { id: true, linkType: true, confidence: true } },
          linkedTo: { select: { id: true, linkType: true, confidence: true } },
        },
        orderBy: [
          { confidence: 'asc' },
          { docDate: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
      }),
      getDuplicateGroups(25),
      prisma.bizDocument.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const enrichedDocs = docs.map(doc => {
      const reasons = [];
      if (doc.status === 'NEEDS_REVIEW') reasons.push('NEEDS_REVIEW');
      if (Number(doc.confidence || 0) < 75) reasons.push('LOW_CONFIDENCE');
      if (!doc.docNumber) reasons.push('MISSING_INVOICE_NO');
      if (!doc.docDate) reasons.push('MISSING_DATE');
      if (!doc.amountTotal) reasons.push('MISSING_AMOUNT');
      return { ...doc, reviewReason: [...new Set(reasons)] };
    });

    const stats = {
      needsReview: enrichedDocs.length,
      duplicateGroups: duplicateGroups.length,
      byStatus: statusCounts.reduce((acc, row) => {
        acc[row.status] = row._count._all;
        return acc;
      }, {}),
    };

    res.json({ stats, docs: enrichedDocs, duplicateGroups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/biz-documents/:id
// POST /api/biz-documents — manual entry (used by the Purchases "нова доставка" form)
router.post('/', auth, async (req, res) => {
  try {
    const { docType, docDate, docNumber, counterpartyId, projectId, currency, amountTotal, status, notes } = req.body;
    if (!counterpartyId) return res.status(400).json({ error: 'counterpartyId е задължителен' });
    const doc = await prisma.bizDocument.create({
      data: {
        docType: docType || 'INVOICE_IN',
        docDate: docDate ? new Date(docDate) : new Date(),
        docNumber: docNumber || null,
        counterpartyId,
        projectId: projectId || null,
        currency: currency || 'EUR',
        amountTotal,
        amountNet: amountTotal,
        status: status || 'REVIEWED',
        confidence: 100,
        notes: notes || 'Ръчно въведено',
      },
      include: { counterparty: { select: { id: true, name: true } }, project: { select: { id: true, code: true, name: true } } },
    });
    res.status(201).json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PATCH /api/biz-documents/:id — edit basic fields (used by the Purchases edit form)
router.patch('/:id', auth, async (req, res) => {
  try {
    const { docNumber, docDate, currency, amountTotal, status, notes } = req.body;
    const data = {};
    if (docNumber !== undefined) data.docNumber = docNumber;
    if (docDate !== undefined) data.docDate = new Date(docDate);
    if (currency !== undefined) data.currency = currency;
    if (amountTotal !== undefined) { data.amountTotal = amountTotal; data.amountNet = amountTotal; }
    if (status !== undefined) data.status = status;
    if (notes !== undefined) data.notes = notes;
    const doc = await prisma.bizDocument.update({
      where: { id: req.params.id },
      data,
      include: { counterparty: { select: { id: true, name: true } }, project: { select: { id: true, code: true, name: true } } },
    });
    res.json(doc);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

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
router.patch('/:id/status', auth, async (req, res) => {
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

// PATCH /api/biz-documents/:id/project — manual project assignment (no automated
// bridge exists: suppliers rarely reference our PO/offer codes, so this is filled
// in by hand as purchases are reviewed)
router.patch('/:id/project', auth, async (req, res) => {
  try {
    const { projectId } = req.body;
    const doc = await prisma.bizDocument.update({
      where: { id: req.params.id },
      data: { projectId: projectId || null },
      include: { project: { select: { id: true, code: true, name: true } } },
    });
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
