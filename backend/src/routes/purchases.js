const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const { year, supplierId, projectId } = req.query;
  const where = {};
  if (year) where.year = parseInt(year);
  if (supplierId) where.supplierId = supplierId;
  if (projectId) where.projectId = projectId;
  const purchases = await prisma.purchase.findMany({
    where, include: { supplier: { select: { name: true } }, project: { select: { code: true, name: true } } },
    orderBy: { date: 'desc' }
  });
  res.json(purchases);
});

router.post('/', auth, async (req, res) => {
  try {
    const { supplierId, projectId, ...rest } = req.body;
    // /api/suppliers now serves Counterparty rows, but Purchase.supplierId still
    // points at the legacy Supplier table — resolve counterparty ids to a Supplier.
    let resolvedSupplierId = supplierId || null;
    if (resolvedSupplierId) {
      const existing = await prisma.supplier.findUnique({ where: { id: resolvedSupplierId } });
      if (!existing) {
        const cp = await prisma.counterparty.findUnique({ where: { id: resolvedSupplierId } });
        if (!cp) return res.status(400).json({ error: 'Unknown supplier id' });
        const byName = await prisma.supplier.findFirst({ where: { name: { equals: cp.name, mode: 'insensitive' } } });
        resolvedSupplierId = byName
          ? byName.id
          : (await prisma.supplier.create({
              data: { name: cp.name, country: cp.country || 'BG', currency: cp.currency || 'EUR', email: cp.email || null },
            })).id;
      }
    }
    const purchase = await prisma.purchase.create({
      data: {
        ...rest,
        supplierId: resolvedSupplierId,
        projectId: projectId || null,
        date: new Date(req.body.date),
        year: new Date(req.body.date).getFullYear(),
      },
    });
    res.status(201).json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const purchase = await prisma.purchase.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        supplier: true,
        project: { select: { id: true, code: true, name: true } },
      },
    });
    res.json(purchase);
  } catch {
    res.status(404).json({ error: 'Purchase not found' });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const { amount, currency, invoiceNo, description, status, projectId, date } = req.body;
    const data = {};
    if (amount !== undefined) data.amount = Number(amount);
    if (currency) data.currency = currency;
    if (invoiceNo !== undefined) data.invoiceNo = invoiceNo;
    if (description !== undefined) data.description = description;
    if (status) data.status = status;
    if (projectId !== undefined) data.projectId = projectId || null;
    if (date) { data.date = new Date(date); data.year = new Date(date).getFullYear(); }
    const purchase = await prisma.purchase.update({ where: { id: req.params.id }, data });
    res.json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
