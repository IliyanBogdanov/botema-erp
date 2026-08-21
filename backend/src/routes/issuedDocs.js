const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

const DOC_TYPES = ['PROFORMA', 'OFFER', 'PROTOCOL', 'WARRANTY', 'DELIVERY_NOTE', 'CREDIT_NOTE'];

// GET /api/issued-docs
router.get('/', auth, async (req, res) => {
  try {
    const { type, clientId, projectId, year, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, parseInt(limit));

    const where = { type: { in: type ? [type] : DOC_TYPES } };
    if (clientId) where.OR = [{ clientId }, { counterpartyId: clientId }];
    if (projectId) where.projectId = projectId;
    if (year) {
      const y = parseInt(year);
      where.date = { gte: new Date(`${y}-01-01`), lt: new Date(`${y + 1}-01-01`) };
    }

    const [total, docs] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, eik: true, vat: true, address: true, city: true, mol: true } },
          counterparty: { select: { id: true, name: true, eik: true, vat: true, address: true, city: true, mol: true } },
          project: { select: { id: true, code: true, name: true } },
          items: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { date: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    res.json({ total, page: pageNum, limit: limitNum, data: docs.map(d => ({ ...d, client: d.counterparty || d.client })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/issued-docs/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const doc = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        client: true,
        counterparty: true,
        project: { select: { id: true, code: true, name: true } },
        items: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ...doc, client: doc.counterparty || doc.client });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/issued-docs
router.post('/', auth, async (req, res) => {
  try {
    const { items, ...docData } = req.body;
    if (!DOC_TYPES.includes(docData.type)) {
      return res.status(400).json({ error: `Invalid type. Allowed: ${DOC_TYPES.join(', ')}` });
    }

    // Auto-number if not provided
    if (!docData.number) {
      const typePrefix = { PROFORMA: 'PF', OFFER: 'OF', PROTOCOL: 'PR', WARRANTY: 'WR', DELIVERY_NOTE: 'DN', CREDIT_NOTE: 'CN' };
      const prefix = typePrefix[docData.type] || 'DOC';
      const year = new Date().getFullYear();
      const count = await prisma.invoice.count({ where: { type: docData.type } });
      docData.number = `${prefix}-${year}-${String(count + 1).padStart(4, '0')}`;
    }

    // Calculate totals from items if provided
    const itemsData = (items || []).map((item, i) => {
      const qty = parseFloat(item.qty) || 1;
      const unitPrice = parseFloat(item.unitPrice) || 0;
      const vatPct = parseFloat(item.vatPct ?? 20);
      const net = qty * unitPrice;
      const vat = net * (vatPct / 100);
      return {
        description: item.description || '',
        qty, unitPrice, vatPct,
        total: net + vat,
        unit: item.unit || 'бр.',
        imageUrl: item.imageUrl || null,
        sortOrder: i,
      };
    });

    const amountNet = itemsData.reduce((s, it) => s + (it.qty * it.unitPrice), 0);
    const vatAmount = itemsData.reduce((s, it) => s + (it.qty * it.unitPrice * (it.vatPct / 100)), 0);

    const doc = await prisma.invoice.create({
      data: {
        ...docData,
        date: new Date(docData.date || Date.now()),
        dueDate: docData.dueDate ? new Date(docData.dueDate) : null,
        amountNet: amountNet || parseFloat(docData.amountNet) || 0,
        vatAmount: vatAmount || parseFloat(docData.vatAmount) || 0,
        amountTotal: (amountNet + vatAmount) || parseFloat(docData.amountTotal) || 0,
        status: docData.status || 'PENDING',
        createdById: req.user?.id,
        items: itemsData.length > 0 ? { create: itemsData } : undefined,
      },
      include: {
        client: true,
        counterparty: true,
        project: { select: { id: true, code: true, name: true } },
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });

    res.status(201).json({ ...doc, client: doc.counterparty || doc.client });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/issued-docs/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const { items, ...docData } = req.body;
    const updates = { ...docData };
    if (docData.date) updates.date = new Date(docData.date);
    if (docData.dueDate) updates.dueDate = new Date(docData.dueDate);

    const doc = await prisma.invoice.update({
      where: { id: req.params.id },
      data: updates,
      include: {
        client: true,
        project: { select: { id: true, code: true, name: true } },
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    res.json(doc);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/issued-docs/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.invoice.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
