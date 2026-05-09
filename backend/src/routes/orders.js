const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// ─── GET /api/orders ──────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { type, status, projectId, counterpartyId, year, page = '1', limit = '50' } = req.query;
    const where = {};
    if (type) where.orderType = type;
    if (status) where.status = status;
    if (projectId) where.projectId = projectId;
    if (counterpartyId) where.counterpartyId = counterpartyId;
    if (year) {
      const y = parseInt(year);
      where.orderDate = { gte: new Date(`${y}-01-01`), lt: new Date(`${y + 1}-01-01`) };
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          counterparty: { select: { id: true, name: true } },
          project: { select: { id: true, code: true, name: true } },
          lines: { include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true } } } },
          deliveries: { select: { id: true, deliveryType: true, status: true, deliveryDate: true } },
        },
        orderBy: { orderDate: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    res.json({ total, page: pageNum, limit: limitNum, data: orders });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/orders/:id ──────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        counterparty: true,
        project: { select: { id: true, code: true, name: true } },
        lines: { include: { inventoryItem: true } },
        deliveries: {
          include: {
            movements: { include: { inventoryItem: { select: { id: true, sku: true, name: true } } } },
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/orders ─────────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { lines, ...orderData } = req.body;
    const order = await prisma.order.create({
      data: {
        ...orderData,
        lines: lines ? { create: lines } : undefined,
      },
      include: {
        counterparty: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true } },
        lines: true,
      },
    });
    res.status(201).json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/orders/:id ────────────────────────────────────────────────────
router.patch('/:id', auth, async (req, res) => {
  try {
    const { lines, ...orderData } = req.body;
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: orderData,
      include: {
        counterparty: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true } },
        lines: true,
        deliveries: { select: { id: true, status: true } },
      },
    });
    res.json(order);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/orders/:id ───────────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.order.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
