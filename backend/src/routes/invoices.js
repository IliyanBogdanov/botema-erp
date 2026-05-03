const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { auth } = require('../middleware/auth');

// GET /api/invoices
router.get('/', auth, async (req, res) => {
  try {
    const { year, brand, status, clientId, search, page = 1, limit = 50 } = req.query;
    const where = {};
    if (year)     where.date = { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) };
    if (brand)    where.brand = brand;
    if (status)   where.status = status;
    if (clientId) where.clientId = clientId;
    if (search)   where.OR = [
      { number: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
    ];

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { client: { select: { id: true, name: true } }, project: { select: { id: true, code: true, name: true } } },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({ data: invoices, total, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { client: true, project: true, items: true, createdBy: { select: { name: true } } }
    });
    if (!invoice) return res.status(404).json({ error: 'Not found' });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices
router.post('/', auth, async (req, res) => {
  try {
    const { clientId, projectId, type, brand, currency, date, dueDate,
            description, notes, items } = req.body;

    // Calculate totals
    const amountNet = items.reduce((s, i) => s + (i.qty * i.unitPrice), 0);
    const vatAmount = items.reduce((s, i) => s + (i.qty * i.unitPrice * i.vatPct / 100), 0);
    const amountTotal = amountNet + vatAmount;

    // Generate number
    const last = await prisma.invoice.findFirst({ orderBy: { number: 'desc' }, where: { brand } });
    const nextNum = last ? parseInt(last.number.replace(/\D/g, '')) + 1 : 1;
    const number = String(nextNum).padStart(10, '0');

    const invoice = await prisma.invoice.create({
      data: {
        number, clientId, projectId, type, brand, currency,
        date: new Date(date), dueDate: dueDate ? new Date(dueDate) : null,
        description, notes, amountNet, vatAmount, amountTotal,
        status: 'PENDING',
        createdById: req.user.id,
        items: { create: items.map(i => ({
          description: i.description, qty: i.qty,
          unitPrice: i.unitPrice, vatPct: i.vatPct || 20,
          total: i.qty * i.unitPrice * (1 + (i.vatPct || 20) / 100)
        }))}
      },
      include: { client: true, project: true, items: true }
    });
    res.status(201).json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/invoices/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: req.body,
      include: { client: true, project: true }
    });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.invoice.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
