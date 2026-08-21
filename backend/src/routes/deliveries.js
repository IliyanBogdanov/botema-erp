const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// ─── GET /api/deliveries ──────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { type, status, projectId, orderId, year, page = '1', limit = '50' } = req.query;
    const where = {};
    if (type) where.deliveryType = type;
    if (status) where.status = status;
    if (projectId) where.projectId = projectId;
    if (orderId) where.orderId = orderId;
    if (year) {
      const y = parseInt(year);
      where.deliveryDate = { gte: new Date(`${y}-01-01`), lt: new Date(`${y + 1}-01-01`) };
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const [total, deliveries] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.findMany({
        where,
        include: {
          order: { select: { id: true, orderType: true, status: true, clientId: true, supplierId: true } },
          project: { select: { id: true, code: true, name: true } },
          movements: {
            include: { inventoryItem: { select: { id: true, sku: true, name: true, unit: true } } },
          },
        },
        orderBy: { deliveryDate: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    res.json({ total, page: pageNum, limit: limitNum, data: deliveries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/deliveries/:id ──────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: {
        order: { include: { lines: true, client: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } } },
        project: { select: { id: true, code: true, name: true } },
        movements: { include: { inventoryItem: true } },
      },
    });
    if (!delivery) return res.status(404).json({ error: 'Not found' });
    res.json(delivery);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/deliveries ─────────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { movements, ...deliveryData } = req.body;
    const delivery = await prisma.delivery.create({
      data: {
        ...deliveryData,
        movements: movements ? { create: movements } : undefined,
      },
      include: {
        order: { select: { id: true, orderType: true } },
        project: { select: { id: true, code: true, name: true } },
        movements: { include: { inventoryItem: { select: { id: true, sku: true, name: true } } } },
      },
    });
    res.status(201).json(delivery);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── PATCH /api/deliveries/:id ────────────────────────────────────────────────
router.patch('/:id', auth, async (req, res) => {
  try {
    const { movements, ...deliveryData } = req.body;
    const delivery = await prisma.delivery.update({
      where: { id: req.params.id },
      data: deliveryData,
      include: {
        order: { select: { id: true, orderType: true } },
        project: { select: { id: true, code: true, name: true } },
        movements: { include: { inventoryItem: { select: { id: true, sku: true, name: true } } } },
      },
    });
    res.json(delivery);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/deliveries/:id ───────────────────────────────────────────────
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.delivery.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
