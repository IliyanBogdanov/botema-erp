const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

const BGN_PER_EUR = 1.95583;

const toNumber = value => Number(value || 0);
const toEur = (amount, currency) => {
  const numericAmount = toNumber(amount);
  if (currency === 'BGN') return numericAmount / BGN_PER_EUR;
  return numericAmount;
};
const toBgn = (amount, currency) => {
  const numericAmount = toNumber(amount);
  if (currency === 'EUR') return numericAmount * BGN_PER_EUR;
  return numericAmount;
};

// GET /api/dashboard — Main KPIs
router.get('/', auth, async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const yearNum = parseInt(year, 10);
    const startDate = new Date(`${yearNum}-01-01T00:00:00.000Z`);
    const endDate = new Date(`${yearNum}-12-31T23:59:59.999Z`);

    const [
      revenueInvoices,
      pendingInvoices,
      totalInventory,
      revenueByMonth,
      topClients,
      expenseRows,
      bizCostRows,
      recentInvoices,
      projectStats,
      invoiceCount,
      paymentStats,
      pendingTotals,
    ] = await Promise.all([
      // Fetch individually so we can do proper currency conversion
      prisma.invoice.findMany({
        where: { date: { gte: startDate, lte: endDate }, status: { not: 'CANCELLED' } },
        select: { amountNet: true, vatAmount: true, amountTotal: true, currency: true },
      }),
      prisma.invoice.findMany({
        where: { status: 'PENDING' },
        include: { client: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 10
      }),
      prisma.inventoryItem.aggregate({
        _sum: { qtyIn: true, qtyOut: true }
      }),
      prisma.$queryRaw`
        SELECT 
          EXTRACT(MONTH FROM date) as month,
          SUM(CASE WHEN currency = 'EUR' THEN "amountNet" ELSE "amountNet" / 1.95583 END) as revenue,
          brand
        FROM invoices
        WHERE EXTRACT(YEAR FROM date) = ${yearNum}
          AND status != 'CANCELLED'
        GROUP BY month, brand
        ORDER BY month
      `,
      // Currency-aware top clients via raw SQL
      prisma.$queryRaw`
        SELECT "clientId",
          SUM(CASE WHEN currency = 'EUR' THEN "amountNet" ELSE "amountNet" / 1.95583 END) AS revenue_eur
        FROM invoices
        WHERE date >= ${startDate} AND date <= ${endDate}
          AND status != 'CANCELLED'
          AND "clientId" IS NOT NULL
        GROUP BY "clientId"
        ORDER BY revenue_eur DESC
        LIMIT 10
      `,
      // Overhead expenses (rent, salaries, accounting, subscriptions, etc.)
      prisma.expense.findMany({
        where: { date: { gte: startDate, lte: endDate } },
        select: { amount: true, currency: true },
      }),
      // Use BizDocument INVOICE_IN as the authoritative cost source (more complete than Purchase)
      prisma.bizDocument.findMany({
        where: {
          docType: 'INVOICE_IN',
          status: { not: 'REJECTED' },
          amountTotal: { gt: 0 },
          docDate: { gte: startDate, lte: endDate },
        },
        select: { amountTotal: true, currency: true, counterpartyId: true },
      }),
      prisma.invoice.findMany({
        include: { client: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8
      }),
      prisma.project.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
      prisma.invoice.count({
        where: { date: { gte: startDate, lte: endDate }, status: { not: 'CANCELLED' } },
      }),
      prisma.payment.groupBy({ by: ['status'], _count: true }),
      prisma.invoice.findMany({
        where: { status: 'PENDING' },
        select: { amountTotal: true, currency: true },
      }),
    ]);

    const clientIds = topClients.map(c => c.clientId).filter(Boolean);
    const clientNames = clientIds.length ? await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true }
    }) : [];
    const clientMap = Object.fromEntries(clientNames.map(c => [c.id, c.name]));

    // Build cost totals from BizDocument INVOICE_IN
    const purchaseTotalsByCurrency = bizCostRows.reduce((acc, row) => {
      const amount = toNumber(row.amountTotal);
      acc[row.currency] = (acc[row.currency] || 0) + amount;
      return acc;
    }, {});

    const cpIds = [...new Set(bizCostRows.map(r => r.counterpartyId).filter(Boolean))];
    const cpNames = cpIds.length ? await prisma.counterparty.findMany({
      where: { id: { in: cpIds } },
      select: { id: true, name: true }
    }) : [];
    const cpMap = Object.fromEntries(cpNames.map(c => [c.id, c.name]));

    const supplierTotals = bizCostRows.reduce((acc, row) => {
      if (!row.counterpartyId) return acc;
      const amountEur = toEur(toNumber(row.amountTotal), row.currency);
      acc[row.counterpartyId] = (acc[row.counterpartyId] || 0) + amountEur;
      return acc;
    }, {});

    const topSuppliers = Object.entries(supplierTotals)
      .map(([cpId, amount]) => ({
        name: cpMap[cpId] || 'Unknown',
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const totalPurchasesEur = Object.entries(purchaseTotalsByCurrency)
      .reduce((sum, [currency, amount]) => sum + toEur(amount, currency), 0);
    const totalPurchasesBgn = Object.entries(purchaseTotalsByCurrency)
      .reduce((sum, [currency, amount]) => sum + toBgn(amount, currency), 0);
    const totalPurchasesCount = bizCostRows.length;

    // Overhead expenses (EUR)
    const expensesEur = expenseRows.reduce((s, e) => s + toEur(e.amount, e.currency), 0);
    const expensesBgn = expenseRows.reduce((s, e) => s + toBgn(e.amount, e.currency), 0);

    const revenueNum = revenueInvoices.reduce((s, inv) => s + toBgn(inv.amountNet, inv.currency), 0);
    const revenueEur = revenueInvoices.reduce((s, inv) => s + toEur(inv.amountNet, inv.currency), 0);
    const vatCollected = revenueInvoices.reduce((s, inv) => s + toBgn(inv.vatAmount, inv.currency), 0);
    const vatCollectedEur = revenueInvoices.reduce((s, inv) => s + toEur(inv.vatAmount, inv.currency), 0);
    // Total costs = purchases + overhead expenses
    const costsNum = Number((totalPurchasesBgn + expensesBgn) || 0);
    const costsEur = Number((totalPurchasesEur + expensesEur) || 0);
    const available = Number(totalInventory._sum.qtyIn || 0) - Number(totalInventory._sum.qtyOut || 0);

    res.json({
      kpis: {
        revenue: Number(revenueNum.toFixed(2)),
        revenueEur: Number(revenueEur.toFixed(2)),
        vatCollected: Number(vatCollected.toFixed(2)),
        vatCollectedEur: Number(vatCollectedEur.toFixed(2)),
        costs: Number(costsNum.toFixed(2)),
        costsEur: Number(costsEur.toFixed(2)),
        totalPurchasesEur: Number(totalPurchasesEur.toFixed(2)),
        totalPurchasesBgn: Number(totalPurchasesBgn.toFixed(2)),
        totalPurchasesCount,
        purchaseTotalsByCurrency,
        expensesEur: Number(expensesEur.toFixed(2)),
        invoiceCount,
        grossMargin: revenueNum > 0 ? ((revenueNum - costsNum) / revenueNum * 100).toFixed(1) : 0,
        inventoryCount: available,
        pendingCount: pendingTotals.length,
        pendingAmount: pendingTotals.reduce((sum, invoice) => sum + toBgn(invoice.amountTotal, invoice.currency), 0),
      },
      revenueByMonth,
      topClients: topClients.map(c => ({
        name: clientMap[c.clientId] || 'Unknown',
        revenue: Number(Number(c.revenue_eur || 0).toFixed(2)),
      })),
      topSuppliers,
      pendingInvoices,
      recentInvoices: recentInvoices.map(invoice => ({
        id: invoice.id,
        number: invoice.number,
        clientName: invoice.client?.name || invoice.number,
        total: Number(invoice.amountTotal || 0),
        currency: invoice.currency,
      })),
      projectStats: Object.fromEntries(projectStats.map(p => [p.status, p._count.id])),
      bankReconciliation: {
        total: paymentStats.reduce((s, p) => s + (p._count || 0), 0),
        matched: paymentStats.find(p => p.status === 'MATCHED')?._count || 0,
        partial: paymentStats.find(p => p.status === 'PARTIAL')?._count || 0,
        unmatched: paymentStats.find(p => p.status === 'UNMATCHED')?._count || 0,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/monthly-pnl?year=2025
// Revenue, costs, gross profit per month
router.get('/monthly-pnl', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year || new Date().getFullYear());

    const [invoices, bizCosts, expenses] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) },
          status: { not: 'CANCELLED' },
        },
        select: { date: true, currency: true, amountNet: true, vatAmount: true, amountTotal: true },
      }),
      // BizDocument INVOICE_IN is the authoritative cost source
      prisma.bizDocument.findMany({
        where: {
          docType: 'INVOICE_IN',
          status: { not: 'REJECTED' },
          amountTotal: { gt: 0 },
          docDate: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) },
        },
        select: { docDate: true, currency: true, amountTotal: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } },
        select: { date: true, currency: true, amount: true },
      }),
    ]);

    const MONTH_NAMES = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      label: MONTH_NAMES[i],
      revenue: 0,
      costs: 0,
      profit: 0,
      margin: 0,
    }));

    for (const inv of invoices) {
      const m = new Date(inv.date).getMonth();
      months[m].revenue += toEur(inv.amountNet, inv.currency);
    }

    for (const biz of bizCosts) {
      const m = new Date(biz.docDate).getMonth();
      months[m].costs += toEur(toNumber(biz.amountTotal), biz.currency);
    }

    for (const exp of expenses) {
      const m = new Date(exp.date).getMonth();
      months[m].costs += toEur(exp.amount, exp.currency);
    }

    for (const m of months) {
      m.revenue = Number(m.revenue.toFixed(2));
      m.costs   = Number(m.costs.toFixed(2));
      m.profit  = Number((m.revenue - m.costs).toFixed(2));
      m.margin  = m.revenue > 0 ? Number(((m.revenue - m.costs) / m.revenue * 100).toFixed(1)) : 0;
    }

    // Yearly totals
    const totals = months.reduce((acc, m) => ({
      revenue: acc.revenue + m.revenue,
      costs:   acc.costs   + m.costs,
      profit:  acc.profit  + m.profit,
    }), { revenue: 0, costs: 0, profit: 0 });
    totals.margin = totals.revenue > 0
      ? Number((totals.profit / totals.revenue * 100).toFixed(1))
      : 0;

    res.json({ year, months, totals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/data-health
// Returns data quality metrics: bank import status, reconciliation coverage, unverified invoices.
router.get('/data-health', auth, async (req, res) => {
  try {
    const [
      totalPayments,
      matchedPayments,
      unmatchedPayments,
      totalInvoices,
      paidInvoices,
      pendingInvoices,
      overdueInvoices,
      totalExpenses,
      totalBizDocs,
    ] = await Promise.all([
      prisma.payment.count(),
      prisma.payment.count({ where: { status: 'MATCHED' } }),
      prisma.payment.count({ where: { status: 'UNMATCHED' } }),
      prisma.invoice.count({ where: { status: { not: 'CANCELLED' } } }),
      prisma.invoice.count({ where: { status: 'PAID' } }),
      prisma.invoice.count({ where: { status: 'PENDING' } }),
      prisma.invoice.count({ where: { status: 'OVERDUE' } }),
      prisma.expense.count(),
      prisma.bizDocument.count(),
    ]);

    const reconciliationRate = totalPayments > 0
      ? Math.round(matchedPayments / totalPayments * 100)
      : 0;

    const invoicePaidRate = totalInvoices > 0
      ? Math.round(paidInvoices / totalInvoices * 100)
      : 0;

    res.json({
      bankImport: {
        total: totalPayments,
        matched: matchedPayments,
        unmatched: unmatchedPayments,
        reconciliationRate,
        status: totalPayments === 0 ? 'empty' : reconciliationRate >= 80 ? 'good' : reconciliationRate >= 50 ? 'partial' : 'poor',
      },
      invoices: {
        total: totalInvoices,
        paid: paidInvoices,
        pending: pendingInvoices,
        overdue: overdueInvoices,
        invoicePaidRate,
        status: invoicePaidRate >= 80 ? 'good' : invoicePaidRate >= 50 ? 'partial' : 'poor',
      },
      expenses: {
        total: totalExpenses,
        status: totalExpenses > 0 ? 'good' : 'empty',
      },
      bizDocs: {
        total: totalBizDocs,
        status: totalBizDocs > 0 ? 'good' : 'empty',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
