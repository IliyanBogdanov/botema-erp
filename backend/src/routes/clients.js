// clients.js
const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const { search, brand } = req.query;
  const where = {};
  if (brand) where.brand = brand;
  if (search) where.OR = [
    { name: { contains: search, mode: 'insensitive' } },
    { eik: { contains: search } },
  ];
  const clients = await prisma.client.findMany({
    where, orderBy: { name: 'asc' },
    include: { _count: { select: { invoices: true } } }
  });
  res.json(clients);
});

router.post('/', auth, async (req, res) => {
  const client = await prisma.client.create({ data: req.body });
  res.status(201).json(client);
});

router.patch('/:id', auth, async (req, res) => {
  const client = await prisma.client.update({ where: { id: req.params.id }, data: req.body });
  res.json(client);
});

router.get('/:id/stats', auth, async (req, res) => {
  const [invoices, revenue] = await Promise.all([
    prisma.invoice.findMany({ where: { clientId: req.params.id }, orderBy: { date: 'desc' }, take: 20 }),
    prisma.invoice.aggregate({ where: { clientId: req.params.id, status: { not: 'CANCELLED' } }, _sum: { amountNet: true } })
  ]);
  res.json({ invoices, totalRevenue: Number(revenue._sum.amountNet || 0) });
});

module.exports = router;
