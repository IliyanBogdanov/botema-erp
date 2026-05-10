const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// GET /api/counterparties
router.get('/', auth, async (req, res) => {
  try {
    const { type, search } = req.query;
    const where = {};
    if (type) where.type = type;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const counterparties = await prisma.counterparty.findMany({
      where,
      include: { contacts: true, _count: { select: { bizDocuments: true, payments: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(counterparties);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/counterparties/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const cp = await prisma.counterparty.findUnique({
      where: { id: req.params.id },
      include: {
        contacts: true,
        bizDocuments: { orderBy: { docDate: 'desc' }, take: 20 },
        payments: { orderBy: { paymentDate: 'desc' }, take: 10 },
      },
    });
    if (!cp) return res.status(404).json({ error: 'Not found' });
    res.json(cp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
