const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// GET /api/inventory
router.get('/', auth, async (req, res) => {
  try {
    const { search, category, supplierId } = req.query;
    const where = {};
    if (category) where.category = category;
    if (supplierId) where.supplierId = supplierId;
    if (search) where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { supplier: { select: { name: true } }, project: { select: { code: true, name: true } } },
      orderBy: { updatedAt: 'desc' }
    });

    const itemsWithAvail = items.map(i => ({
      ...i, available: Number(i.qtyIn) - Number(i.qtyOut)
    }));

    res.json(itemsWithAvail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/movement — Add stock movement
router.post('/movement', auth, async (req, res) => {
  try {
    const { itemId, code, name, supplierId, category, type, qty, date, reference, notes, location, projectId, account } = req.body;

    let item;
    if (itemId) {
      item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    } else {
      // Find by code or create new
      item = await prisma.inventoryItem.findFirst({ where: { code } });
      if (!item) {
        item = await prisma.inventoryItem.create({
          data: { code, name, supplierId, category: category || 'LIGHTING', location, account, projectId }
        });
      }
    }

    // Update qty
    const update = type === 'IN' || type === 'SAMPLE'
      ? { qtyIn: { increment: qty } }
      : { qtyOut: { increment: qty } };

    const [updatedItem, movement] = await Promise.all([
      prisma.inventoryItem.update({ where: { id: item.id }, data: { ...update, location: location || undefined } }),
      prisma.stockMovement.create({ data: { itemId: item.id, type, qty, date: new Date(date), reference, notes } })
    ]);

    res.json({ item: { ...updatedItem, available: Number(updatedItem.qtyIn) - Number(updatedItem.qtyOut) }, movement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/:id/movements
router.get('/:id/movements', auth, async (req, res) => {
  try {
    const movements = await prisma.stockMovement.findMany({
      where: { itemId: req.params.id },
      orderBy: { date: 'desc' }
    });
    res.json(movements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
