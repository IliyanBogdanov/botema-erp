const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

const fx = require('../lib/fx');
const { AUTHORITATIVE_BIZ_DOC_STATUSES, netCostAmount } = require('../lib/costs');

const EUR_RATE = fx.BGN_PER_EUR;

function toBGN(amount, currency) {
  return fx.toBgn(amount, currency);
}

// Project costs come from BizDocument INVOICE_IN (authoritative statuses, net of
// VAT) — the same source as the dashboard. The legacy Purchase relation had no
// status filter and is no longer linked to projects.
const PROJECT_COST_DOCS = {
  where: { docType: 'INVOICE_IN', status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES } },
  select: { amountNet: true, vatAmount: true, amountTotal: true, currency: true },
};

const projectCostsBGN = docs => (docs || []).reduce((s, d) => s + toBGN(netCostAmount(d), d.currency), 0);

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
      bizDocuments: PROJECT_COST_DOCS,
    },
    orderBy: { year: 'desc' },
  });
  await fx.loadRates();

  const enriched = projects.map(p => {
    const revenueBGN = p.invoices
      .filter(i => i.status !== 'CANCELLED')
      .reduce((s, i) => s + toBGN(i.amountNet, i.currency || 'BGN'), 0);

    const costsBGN = projectCostsBGN(p.bizDocuments);

    const profitBGN = revenueBGN - costsBGN;
    // No linked cost documents means costs are untracked, not zero — a "100%"
    // margin here would be a false claim, so leave it unknown instead.
    const marginPct = (revenueBGN > 0 && p.bizDocuments.length > 0) ? Math.round((profitBGN / revenueBGN) * 100) : null;

    return {
      ...p,
      revenueBGN: Math.round(revenueBGN),
      costsBGN: Math.round(costsBGN),
      profitBGN: Math.round(profitBGN),
      marginPct,
      invoiceCount: p.invoices.filter(i => i.status !== 'CANCELLED').length,
      purchaseCount: p.bizDocuments.length,
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
      bizDocuments: PROJECT_COST_DOCS,
    },
    orderBy: [{ status: 'asc' }, { year: 'desc' }],
  });
  await fx.loadRates();

  const result = projects.map(p => {
    const revenueBGN = p.invoices
      .filter(i => i.status !== 'CANCELLED')
      .reduce((s, i) => s + toBGN(i.amountNet, i.currency || 'BGN'), 0);

    const costsBGN = projectCostsBGN(p.bizDocuments);

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
      marginPct: (revenueBGN > 0 && p.bizDocuments.length > 0) ? Math.round((profitBGN / revenueBGN) * 100) : null,
      invoiceCount: p.invoices.filter(i => i.status !== 'CANCELLED').length,
      purchaseCount: p.bizDocuments.length,
    };
  });

  // Summary totals
  const totalRevenue = result.reduce((s, p) => s + p.revenueBGN, 0);
  const totalCosts = result.reduce((s, p) => s + p.costsBGN, 0);
  const totalProfit = totalRevenue - totalCosts;
  const projectsWithCosts = result.filter(p => p.purchaseCount > 0).length;

  res.json({
    projects: result,
    totals: {
      revenueBGN: totalRevenue,
      costsBGN: totalCosts,
      profitBGN: totalProfit,
      marginPct: (totalRevenue > 0 && totalCosts > 0) ? Math.round((totalProfit / totalRevenue) * 100) : null,
      projectsWithCosts,
      projectsTotal: result.length,
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
  await fx.loadRates();

  // Net (без ДДС) — consistent with the list view and dashboard P&L
  const totalRevenueBGN = project.invoices
    .filter(inv => inv.status !== 'CANCELLED')
    .reduce((s, inv) => s + toBGN(Number(inv.amountNet ?? inv.amountTotal), inv.currency), 0);
  const costDocs = project.bizDocuments.filter(d => d.docType === 'INVOICE_IN' && AUTHORITATIVE_BIZ_DOC_STATUSES.includes(d.status));
  const totalCostsBGN = projectCostsBGN(costDocs);

  res.json({
    ...project,
    totalRevenue: totalRevenueBGN,
    totalCosts: totalCostsBGN,
    margin: totalRevenueBGN - totalCostsBGN,
    marginPct: (totalRevenueBGN > 0 && costDocs.length > 0) ? Math.round(((totalRevenueBGN - totalCostsBGN) / totalRevenueBGN) * 100) : null,
  });
});

module.exports = router;
