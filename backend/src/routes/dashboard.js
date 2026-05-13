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
      purchaseRows,
      recentInvoices,
      projectStats,
      invoiceCount,
      paymentStats,
      overdueResult,
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
          SUM(CASE WHEN currency = 'EUR' THEN "amountNet" * 1.95583 ELSE "amountNet" END) as revenue,
          brand
        FROM invoices
        WHERE EXTRACT(YEAR FROM date) = ${yearNum}
          AND status != 'CANCELLED'
        GROUP BY month, brand
        ORDER BY month
      `,
      prisma.invoice.groupBy({
        by: ['clientId'],
        where: { date: { gte: startDate, lte: endDate }, status: { not: 'CANCELLED' } },
        _sum: { amountNet: true },
        orderBy: { _sum: { amountNet: 'desc' } },
        take: 10
      }),
      prisma.purchase.groupBy({
        by: ['supplierId', 'currency'],
        where: { date: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
        _count: { id: true },
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
      // Auto-mark overdue invoices as side-effect
      prisma.invoice.updateMany({
        where: { status: 'PENDING', dueDate: { lt: new Date() } },
        data: { status: 'OVERDUE' },
      }),
    ]);

    const clientIds = topClients.map(c => c.clientId).filter(Boolean);
    const clientNames = clientIds.length ? await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true }
    }) : [];
    const clientMap = Object.fromEntries(clientNames.map(c => [c.id, c.name]));

    const purchaseTotalsByCurrency = purchaseRows.reduce((acc, row) => {
      const amount = toNumber(row._sum.amount);
      acc[row.currency] = (acc[row.currency] || 0) + amount;
      return acc;
    }, {});

    const supplierIds = [...new Set(purchaseRows.map(row => row.supplierId).filter(Boolean))];
    const supplierNames = supplierIds.length ? await prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true }
    }) : [];
    const supplierMap = Object.fromEntries(supplierNames.map(s => [s.id, s.name]));

    const supplierTotals = purchaseRows.reduce((acc, row) => {
      const amountEur = toEur(row._sum.amount, row.currency);
      acc[row.supplierId] = (acc[row.supplierId] || 0) + amountEur;
      return acc;
    }, {});

    const topSuppliers = Object.entries(supplierTotals)
      .map(([supplierId, amount]) => ({
        name: supplierMap[supplierId] || 'Unknown',
        amount: Number(amount.toFixed(2)),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const totalPurchasesEur = Object.entries(purchaseTotalsByCurrency)
      .reduce((sum, [currency, amount]) => sum + toEur(amount, currency), 0);
    const totalPurchasesBgn = Object.entries(purchaseTotalsByCurrency)
      .reduce((sum, [currency, amount]) => sum + toBgn(amount, currency), 0);
    const totalPurchasesCount = purchaseRows.reduce((sum, row) => sum + Number(row._count.id || 0), 0);

    const revenueNum = revenueInvoices.reduce((s, inv) => s + toBgn(inv.amountNet, inv.currency), 0);
    const vatCollected = revenueInvoices.reduce((s, inv) => s + toBgn(inv.vatAmount, inv.currency), 0);
    const costsNum = Number(totalPurchasesBgn || 0);
    const available = Number(totalInventory._sum.qtyIn || 0) - Number(totalInventory._sum.qtyOut || 0);

    res.json({
      kpis: {
        revenue: Number(revenueNum.toFixed(2)),
        vatCollected: Number(vatCollected.toFixed(2)),
        costs: Number(costsNum.toFixed(2)),
        totalPurchasesEur: Number(totalPurchasesEur.toFixed(2)),
        totalPurchasesBgn: Number(totalPurchasesBgn.toFixed(2)),
        totalPurchasesCount,
        purchaseTotalsByCurrency,
        invoiceCount,
        grossMargin: revenueNum > 0 ? ((revenueNum - costsNum) / revenueNum * 100).toFixed(1) : 0,
        inventoryCount: available,
        pendingCount: pendingInvoices.length,
        pendingAmount: pendingInvoices.reduce((sum, invoice) => sum + toBgn(invoice.amountTotal, invoice.currency), 0),
      },
      revenueByMonth,
      topClients: topClients.map(c => ({
        name: clientMap[c.clientId] || 'Unknown',
        revenue: Number(c._sum.amountNet || 0)
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

    const [invoices, purchases] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) },
          status: { not: 'CANCELLED' },
        },
        select: { date: true, currency: true, amountNet: true, vatAmount: true, amountTotal: true },
      }),
      prisma.purchase.findMany({
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
      months[m].revenue += toBgn(inv.amountNet, inv.currency);
    }

    for (const pur of purchases) {
      const m = new Date(pur.date).getMonth();
      months[m].costs += toBgn(pur.amount, pur.currency);
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

module.exports = router;
