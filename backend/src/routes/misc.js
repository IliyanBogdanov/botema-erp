const express = require('express');
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// ─── Expenses ─────────────────────────────────────────────────────────────────
const expensesRouter = express.Router();

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

expensesRouter.delete('/:id', auth, async (req, res) => {
  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── Suppliers ────────────────────────────────────────────────────────────────
const suppliersRouter = express.Router();
const EUR_RATE = 1.95583;

suppliersRouter.get('/', auth, async (req, res) => {
  const { year } = req.query;
  const dateFilter = year
    ? { date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } }
    : {};

  const [suppliers, purchaseTotals] = await Promise.all([
    prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { purchases: true } } },
    }),
    prisma.purchase.groupBy({
      by: ['supplierId', 'currency'],
      where: dateFilter,
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  // Aggregate totals per supplier in EUR
  const spendMap = {};
  const countMap = {};
  for (const row of purchaseTotals) {
    const eur = row.currency === 'BGN'
      ? Number(row._sum.amount) / EUR_RATE
      : Number(row._sum.amount);
    spendMap[row.supplierId] = (spendMap[row.supplierId] || 0) + eur;
    countMap[row.supplierId] = (countMap[row.supplierId] || 0) + (row._count.id || 0);
  }

  const enriched = suppliers.map(s => ({
    ...s,
    purchaseCount: s._count.purchases,
    totalSpentEur: Math.round((spendMap[s.id] || 0) * 100) / 100,
    totalSpentBgn: Math.round((spendMap[s.id] || 0) * EUR_RATE * 100) / 100,
    filteredPurchaseCount: countMap[s.id] || 0,
  }));

  // Sort by spend descending
  enriched.sort((a, b) => b.totalSpentEur - a.totalSpentEur);

  res.json(enriched);
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

// ─── Company ──────────────────────────────────────────────────────────────────
const companyRouter = express.Router();

companyRouter.get('/', auth, async (req, res) => {
  const { brand } = req.query;
  const where = brand ? { brand } : {};
  const companies = await prisma.company.findMany({ where, orderBy: { name: 'asc' } });
  res.json(companies);
});

// PATCH /api/company/:id — update or upsert company record
companyRouter.patch('/:id', auth, async (req, res) => {
  try {
    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(company);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/company — create or update company by brand
companyRouter.post('/', auth, async (req, res) => {
  try {
    const { brand = 'STUDIO_BOTEMA', ...rest } = req.body;
    const existing = await prisma.company.findFirst({ where: { brand } });
    let company;
    if (existing) {
      company = await prisma.company.update({ where: { id: existing.id }, data: rest });
    } else {
      // Provide defaults for required fields to avoid DB errors on partial saves
      company = await prisma.company.create({
        data: {
          brand,
          name: rest.name || brand,
          eik: rest.eik || `EIK-${Date.now()}`,
          vat: rest.vat || '',
          address: rest.address || '',
          city: rest.city || '',
          mol: rest.mol || '',
          bankIban: rest.bankIban || '',
          bankBic: rest.bankBic || '',
          bankName: rest.bankName || '',
          ...rest,
        },
      });
    }
    res.json(company);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = { expensesRouter, suppliersRouter, documentsRouter, companyRouter };
