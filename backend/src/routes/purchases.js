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
  const purchase = await prisma.purchase.create({
    data: { ...req.body, date: new Date(req.body.date), year: new Date(req.body.date).getFullYear() }
  });
  res.status(201).json(purchase);
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
