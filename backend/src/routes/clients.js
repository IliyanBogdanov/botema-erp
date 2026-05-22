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

router.get('/:id', auth, async (req, res) => {
  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { invoices: true, projects: true } } },
  });
  if (!client) return res.status(404).json({ error: 'Not found' });

  const invoices = await prisma.invoice.findMany({
    where: { clientId: req.params.id, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
    include: { project: { select: { id: true, code: true, name: true } } },
    orderBy: { date: 'desc' },
  });

  const BGN_PER_EUR = 1.95583;
  const toBGN = (amount, currency) =>
    currency === 'EUR' ? Number(amount) * BGN_PER_EUR : Number(amount);

  const totalRevenueBGN = invoices.reduce((s, inv) => s + toBGN(inv.amountNet, inv.currency), 0);
  const totalVatBGN = invoices.reduce((s, inv) => s + toBGN(inv.vatAmount, inv.currency), 0);
  const outstandingBGN = invoices
    .filter(inv => !['PAID'].includes(inv.status))
    .reduce((s, inv) => s + toBGN(inv.amountTotal, inv.currency), 0);

  const revenueByYear = invoices.reduce((acc, inv) => {
    const y = new Date(inv.date).getFullYear();
    acc[y] = (acc[y] || 0) + toBGN(inv.amountNet, inv.currency);
    return acc;
  }, {});

  res.json({
    ...client,
    invoiceCount: client._count.invoices,
    projectCount: client._count.projects,
    totalRevenueBGN: Math.round(totalRevenueBGN * 100) / 100,
    totalVatBGN: Math.round(totalVatBGN * 100) / 100,
    outstandingBGN: Math.round(outstandingBGN * 100) / 100,
    revenueByYear,
    invoices: invoices.map(inv => ({
      id: inv.id,
      number: inv.number,
      date: inv.date,
      dueDate: inv.dueDate,
      status: inv.status,
      amountNet: Number(inv.amountNet),
      amountTotal: Number(inv.amountTotal),
      currency: inv.currency,
      project: inv.project,
    })),
  });
});

router.get('/:id/stats', auth, async (req, res) => {
  const [invoices, revenue] = await Promise.all([
    prisma.invoice.findMany({ where: { clientId: req.params.id }, orderBy: { date: 'desc' }, take: 20 }),
    prisma.invoice.aggregate({ where: { clientId: req.params.id, status: { notIn: ['CANCELLED', 'ARCHIVED'] } }, _sum: { amountNet: true } })
  ]);
  res.json({ invoices, totalRevenue: Number(revenue._sum.amountNet || 0) });
});

module.exports = router;
