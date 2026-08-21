const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// The supplier dropdown feeds Counterparty ids (see /api/suppliers). InventoryItem.supplierId
// is still a required legacy FK into Supplier — resolve/reuse a Supplier row by exact name
// match, same as purchases.js. counterpartyId is set directly.
async function resolveSupplier(rawId) {
  if (!rawId) return { supplierId: null, counterpartyId: null };
  const cp = await prisma.counterparty.findUnique({ where: { id: rawId } });
  if (!cp) return { supplierId: rawId, counterpartyId: null }; // legacy caller passing a real Supplier id
  const existing = await prisma.supplier.findFirst({ where: { name: { equals: cp.name, mode: 'insensitive' } } });
  const supplier = existing || await prisma.supplier.create({ data: { name: cp.name, country: cp.country || 'BG', currency: cp.currency || 'EUR' } });
  return { supplierId: supplier.id, counterpartyId: cp.id };
}

// GET /api/inventory
router.get('/', auth, async (req, res) => {
  try {
    const { search, category, supplierId } = req.query;
    const where = {};
    if (category) where.category = category;
    if (supplierId) where.OR = [{ supplierId }, { counterpartyId: supplierId }];
    if (search) where.AND = [{ OR: [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ] }];

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { supplier: { select: { name: true } }, counterparty: { select: { name: true } }, project: { select: { code: true, name: true } } },
      orderBy: { updatedAt: 'desc' }
    });

    const itemsWithAvail = items.map(i => ({
      ...i, supplier: i.counterparty || i.supplier, available: Number(i.qtyIn) - Number(i.qtyOut)
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
        const resolved = await resolveSupplier(supplierId);
        item = await prisma.inventoryItem.create({
          data: { code, name, ...resolved, category: category || 'LIGHTING', location, account, projectId }
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
