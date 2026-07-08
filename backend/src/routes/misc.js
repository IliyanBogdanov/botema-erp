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
  try {
    const { supplierId, supplier, ...rest } = req.body;
    // Expense.supplier is a plain name string; the frontend modal sends a
    // counterparty id — resolve it to the name.
    let supplierName = supplier || '';
    if (!supplierName && supplierId) {
      const cp = await prisma.counterparty.findUnique({ where: { id: supplierId } })
        || await prisma.supplier.findUnique({ where: { id: supplierId } });
      supplierName = cp?.name || '';
    }
    const expense = await prisma.expense.create({
      data: {
        ...rest,
        supplier: supplierName,
        date: new Date(req.body.date),
        year: new Date(req.body.date).getFullYear(),
      },
    });
    res.status(201).json(expense);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

expensesRouter.delete('/:id', auth, async (req, res) => {
  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// ─── Suppliers ────────────────────────────────────────────────────────────────
// Rewritten (2026-07-08 audit) over Counterparty + BizDocument INVOICE_IN with
// authoritative statuses — the same source and filters as the dashboard, so the
// supplier numbers match the dashboard top-suppliers widget. The legacy
// Supplier/Purchase tables had no status filter and missed Gmail/Drive documents.
const suppliersRouter = express.Router();
const fx = require('../lib/fx');
const { AUTHORITATIVE_BIZ_DOC_STATUSES, netCostAmount } = require('../lib/costs');

suppliersRouter.get('/', auth, async (req, res) => {
  const { year } = req.query;
  const dateFilter = year
    ? { docDate: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T23:59:59.999Z`) } }
    : {};
  await fx.loadRates();

  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: 'INVOICE_IN',
      status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
      amountTotal: { not: null },
      counterpartyId: { not: null },
      ...dateFilter,
    },
    select: { counterpartyId: true, amountTotal: true, amountNet: true, vatAmount: true, currency: true },
  });

  const allTimeCounts = await prisma.bizDocument.groupBy({
    by: ['counterpartyId'],
    where: {
      docType: 'INVOICE_IN',
      status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
      counterpartyId: { not: null },
    },
    _count: { id: true },
  });
  const allTimeCountMap = Object.fromEntries(allTimeCounts.map(r => [r.counterpartyId, r._count.id]));

  const spendMap = {};
  const countMap = {};
  for (const doc of docs) {
    const eur = fx.toEur(netCostAmount(doc), doc.currency);
    spendMap[doc.counterpartyId] = (spendMap[doc.counterpartyId] || 0) + eur;
    countMap[doc.counterpartyId] = (countMap[doc.counterpartyId] || 0) + 1;
  }

  const cpIds = Object.keys(allTimeCountMap);
  const counterparties = cpIds.length ? await prisma.counterparty.findMany({
    where: { id: { in: cpIds } },
  }) : [];

  const enriched = counterparties.map(cp => ({
    ...cp,
    purchaseCount: allTimeCountMap[cp.id] || 0,
    totalSpentEur: Math.round((spendMap[cp.id] || 0) * 100) / 100,
    totalSpentBgn: Math.round((spendMap[cp.id] || 0) * fx.BGN_PER_EUR * 100) / 100,
    filteredPurchaseCount: countMap[cp.id] || 0,
    discount: null,
  }));

  enriched.sort((a, b) => b.totalSpentEur - a.totalSpentEur);
  res.json(enriched);
});

suppliersRouter.get('/:id', auth, async (req, res) => {
  const cp = await prisma.counterparty.findUnique({ where: { id: req.params.id } });
  if (!cp) return res.status(404).json({ error: 'Not found' });
  await fx.loadRates();

  const docs = await prisma.bizDocument.findMany({
    where: {
      counterpartyId: req.params.id,
      docType: 'INVOICE_IN',
      status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
      amountTotal: { not: null },
    },
    include: { project: { select: { id: true, code: true, name: true } } },
    orderBy: { docDate: 'desc' },
  });

  const totalsByYear = docs.reduce((acc, d) => {
    const y = d.docDate ? new Date(d.docDate).getUTCFullYear() : 'unknown';
    acc[y] = (acc[y] || 0) + fx.toEur(netCostAmount(d), d.currency);
    return acc;
  }, {});
  for (const y of Object.keys(totalsByYear)) totalsByYear[y] = Math.round(totalsByYear[y] * 100) / 100;

  const totalEur = Object.values(totalsByYear).reduce((s, v) => s + v, 0);

  res.json({
    ...cp,
    purchaseCount: docs.length,
    totalSpentEur: Math.round(totalEur * 100) / 100,
    totalsByYear,
    purchases: docs.map(d => ({
      id: d.id,
      invoiceNo: d.docNumber,
      date: d.docDate,
      year: d.docDate ? new Date(d.docDate).getUTCFullYear() : null,
      amount: Number(d.amountTotal),
      currency: d.currency,
      amountEur: Number(fx.toEur(Number(d.amountTotal), d.currency).toFixed(2)),
      description: d.notes,
      status: d.status,
      project: d.project,
    })),
  });
});

suppliersRouter.post('/', auth, async (req, res) => {
  const { name, country, currency, email } = req.body;
  const cp = await prisma.counterparty.create({
    data: { name, type: 'SUPPLIER', country: country || 'BG', currency: currency || 'EUR', email: email || null },
  });
  res.status(201).json(cp);
});

suppliersRouter.patch('/:id', auth, async (req, res) => {
  const { name, country, currency, email, notes } = req.body;
  const cp = await prisma.counterparty.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(country !== undefined ? { country } : {}),
      ...(currency !== undefined ? { currency } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(notes !== undefined ? { notes } : {}),
    },
  });
  res.json(cp);
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
