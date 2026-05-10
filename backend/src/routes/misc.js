const express = require('express');
const prisma = require('../lib/prisma');

// ─── Expenses ─────────────────────────────────────────────────────────────────
const expensesRouter = express.Router();
const { auth } = require('../middleware/auth');

expensesRouter.get('/', auth, async (req, res) => {
  const { year } = req.query;
  const where = year ? { year: parseInt(year) } : {};
  const expenses = await prisma.expense.findMany({ where, orderBy: { date: 'desc' } });
  res.json(expenses);
});

expensesRouter.post('/', auth, async (req, res) => {
  const expense = await prisma.expense.create({
    data: { ...req.body, date: new Date(req.body.date), year: new Date(req.body.date).getFullYear() }
  });
  res.status(201).json(expense);
});

// ─── Suppliers ────────────────────────────────────────────────────────────────
const suppliersRouter = express.Router();

suppliersRouter.get('/', auth, async (req, res) => {
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: 'asc' } });
  res.json(suppliers);
});

suppliersRouter.post('/', auth, async (req, res) => {
  const supplier = await prisma.supplier.create({ data: req.body });
  res.status(201).json(supplier);
});

suppliersRouter.patch('/:id', auth, async (req, res) => {
  const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: req.body });
  res.json(supplier);
});

// ─── Documents ────────────────────────────────────────────────────────────────
const documentsRouter = express.Router();

documentsRouter.get('/', auth, async (req, res) => {
  const { status } = req.query;
  const where = status ? { status } : {};
  const docs = await prisma.document.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json(docs);
});

documentsRouter.patch('/:id', auth, async (req, res) => {
  const doc = await prisma.document.update({ where: { id: req.params.id }, data: req.body });
  res.json(doc);
});

module.exports = { expensesRouter, suppliersRouter, documentsRouter };

// ─── Company ──────────────────────────────────────────────────────────────────
const companyRouter = express.Router();

companyRouter.get('/', auth, async (req, res) => {
  const { brand } = req.query;
  const where = brand ? { brand } : {};
  const companies = await prisma.company.findMany({ where, orderBy: { name: 'asc' } });
  res.json(companies);
});

module.exports = { expensesRouter, suppliersRouter, documentsRouter, companyRouter };
