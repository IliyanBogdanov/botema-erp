const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

const EUR_RATE = 1.95583;

function toBGN(amount, currency) {
  return currency === 'EUR' ? Number(amount) * EUR_RATE : Number(amount);
}

router.get('/', auth, async (req, res) => {
  const { status, year } = req.query;
  const where = {};
  if (status) where.status = status;
  if (year) where.year = parseInt(year);

  const projects = await prisma.project.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      invoices: { select: { amountNet: true, amountTotal: true, currency: true, status: true } },
      purchases: { select: { amount: true, currency: true } },
    },
    orderBy: { year: 'desc' },
  });

  const enriched = projects.map(p => {
    const revenueBGN = p.invoices
      .filter(i => i.status !== 'CANCELLED')
      .reduce((s, i) => s + toBGN(i.amountNet, i.currency || 'BGN'), 0);

    const costsBGN = p.purchases
      .reduce((s, i) => s + toBGN(i.amount, i.currency || 'EUR'), 0);

    const profitBGN = revenueBGN - costsBGN;
    const marginPct = revenueBGN > 0 ? Math.round((profitBGN / revenueBGN) * 100) : null;

    return {
      ...p,
      revenueBGN: Math.round(revenueBGN),
      costsBGN: Math.round(costsBGN),
      profitBGN: Math.round(profitBGN),
      marginPct,
      invoiceCount: p.invoices.filter(i => i.status !== 'CANCELLED').length,
      purchaseCount: p.purchases.length,
      // Legacy aliases (keep for compatibility)
      totalRevenue: Math.round(revenueBGN),
      totalCosts: Math.round(costsBGN),
    };
  });

  res.json(enriched);
});

// GET /api/projects/pnl — aggregate P&L across all projects
router.get('/pnl', auth, async (req, res) => {
  const { year } = req.query;
  const where = {};
  if (year) where.year = parseInt(year);

  const projects = await prisma.project.findMany({
    where,
    include: {
      client: { select: { id: true, name: true } },
      invoices: { select: { amountNet: true, currency: true, status: true, date: true } },
      purchases: { select: { amount: true, currency: true, date: true } },
    },
    orderBy: [{ status: 'asc' }, { year: 'desc' }],
  });

  const result = projects.map(p => {
    const revenueBGN = p.invoices
      .filter(i => i.status !== 'CANCELLED')
      .reduce((s, i) => s + toBGN(i.amountNet, i.currency || 'BGN'), 0);

    const costsBGN = p.purchases
      .reduce((s, i) => s + toBGN(i.amount, i.currency || 'EUR'), 0);

    const profitBGN = revenueBGN - costsBGN;

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      year: p.year,
      clientName: p.client?.name || null,
      revenueBGN: Math.round(revenueBGN),
      costsBGN: Math.round(costsBGN),
      profitBGN: Math.round(profitBGN),
      marginPct: revenueBGN > 0 ? Math.round((profitBGN / revenueBGN) * 100) : null,
      invoiceCount: p.invoices.filter(i => i.status !== 'CANCELLED').length,
      purchaseCount: p.purchases.length,
    };
  });

  // Summary totals
  const totalRevenue = result.reduce((s, p) => s + p.revenueBGN, 0);
  const totalCosts = result.reduce((s, p) => s + p.costsBGN, 0);
  const totalProfit = totalRevenue - totalCosts;

  res.json({
    projects: result,
    totals: {
      revenueBGN: totalRevenue,
      costsBGN: totalCosts,
      profitBGN: totalProfit,
      marginPct: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 100) : null,
    },
  });
});

router.post('/', auth, async (req, res) => {
  const project = await prisma.project.create({ data: { ...req.body, year: req.body.year || new Date().getFullYear() } });
  res.status(201).json(project);
});

router.patch('/:id', auth, async (req, res) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: req.body });
  res.json(project);
});

router.get('/:id', auth, async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      client: true,
      invoices: { include: { client: { select: { name: true } } } },
      purchases: { include: { supplier: { select: { name: true } } } },
      inventory: { include: { supplier: { select: { name: true } } } },
      orders: {
        include: {
          counterparty: { select: { id: true, name: true } },
          lines: true,
          deliveries: { select: { id: true, status: true, deliveryDate: true, deliveryType: true } },
        },
        orderBy: { orderDate: 'asc' },
      },
      bizDocuments: {
        include: { counterparty: { select: { id: true, name: true } } },
        orderBy: { docDate: 'asc' },
      },
      payments: {
        orderBy: { paymentDate: 'asc' },
      },
    },
  });
  if (!project) return res.status(404).json({ error: 'Not found' });

  const EUR_RATE = 1.95583;
  const totalRevenueBGN = project.invoices.reduce((s, inv) => {
    const total = Number(inv.amountTotal);
    return s + (inv.currency === 'EUR' ? total * EUR_RATE : total);
  }, 0);
  const totalCostsBGN = project.purchases.reduce((s, p) => {
    const amt = Number(p.amount);
    return s + (p.currency === 'EUR' ? amt * EUR_RATE : amt);
  }, 0);

  res.json({
    ...project,
    totalRevenue: totalRevenueBGN,
    totalCosts: totalCostsBGN,
    margin: totalRevenueBGN - totalCostsBGN,
    marginPct: totalRevenueBGN > 0 ? Math.round(((totalRevenueBGN - totalCostsBGN) / totalRevenueBGN) * 100) : null,
  });
});

module.exports = router;
