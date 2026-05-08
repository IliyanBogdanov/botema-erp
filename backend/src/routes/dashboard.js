const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// GET /api/dashboard — Main KPIs
router.get('/', auth, async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const yearNum = parseInt(year);
    const startDate = new Date(`${yearNum}-01-01`);
    const endDate = new Date(`${yearNum}-12-31`);

    const [
      totalRevenue,
      totalCosts,
      pendingInvoices,
      totalInventory,
      revenueByMonth,
      topClients,
      topSuppliers,
      recentInvoices,
      projectStats,
    ] = await Promise.all([
      // Total revenue for year
      prisma.invoice.aggregate({
        where: { date: { gte: startDate, lte: endDate }, status: { not: 'CANCELLED' } },
        _sum: { amountNet: true }
      }),
      // Total purchase costs
      prisma.purchase.aggregate({
        where: { date: { gte: startDate, lte: endDate } },
        _sum: { amount: true }
      }),
      // Pending invoices
      prisma.invoice.findMany({
        where: { status: 'PENDING' },
        include: { client: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 10
      }),
      // Inventory count
      prisma.inventoryItem.aggregate({
        _sum: { qtyIn: true, qtyOut: true }
      }),
      // Revenue by month
      prisma.$queryRaw`
        SELECT 
          EXTRACT(MONTH FROM date) as month,
          SUM("amountNet") as revenue,
          brand
        FROM invoices
        WHERE EXTRACT(YEAR FROM date) = ${yearNum}
          AND status != 'CANCELLED'
        GROUP BY month, brand
        ORDER BY month
      `,
      // Top clients
      prisma.invoice.groupBy({
        by: ['clientId'],
        where: { date: { gte: startDate, lte: endDate }, status: { not: 'CANCELLED' } },
        _sum: { amountNet: true },
        orderBy: { _sum: { amountNet: 'desc' } },
        take: 10
      }),
      // Top suppliers
      prisma.purchase.groupBy({
        by: ['supplierId'],
        where: { date: { gte: startDate, lte: endDate } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5
      }),
      // Recent invoices
      prisma.invoice.findMany({
        include: { client: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8
      }),
      // Project stats
      prisma.project.groupBy({
        by: ['status'],
        _count: { id: true }
      }),
    ]);

    // Hydrate top clients with names
    const clientIds = topClients.map(c => c.clientId);
    const clientNames = await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true }
    });
    const clientMap = Object.fromEntries(clientNames.map(c => [c.id, c.name]));

    const supplierIds = topSuppliers.map(s => s.supplierId);
    const supplierNames = await prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true }
    });
    const supplierMap = Object.fromEntries(supplierNames.map(s => [s.id, s.name]));

    const revenueNum = Number(totalRevenue._sum.amountNet || 0);
    const costsNum = Number(totalCosts._sum.amount || 0);
    const available = Number(totalInventory._sum.qtyIn || 0) - Number(totalInventory._sum.qtyOut || 0);

    res.json({
      kpis: {
        revenue: revenueNum,
        costs: costsNum,
        grossMargin: revenueNum > 0 ? ((revenueNum - costsNum) / revenueNum * 100).toFixed(1) : 0,
        inventoryCount: available,
        pendingCount: pendingInvoices.length,
        pendingAmount: pendingInvoices.reduce((s, i) => s + Number(i.amountTotal), 0),
      },
      revenueByMonth,
      topClients: topClients.map(c => ({
        name: clientMap[c.clientId] || 'Unknown',
        revenue: Number(c._sum.amountNet)
      })),
      topSuppliers: topSuppliers.map(s => ({
        name: supplierMap[s.supplierId] || 'Unknown',
        amount: Number(s._sum.amount)
      })),
      pendingInvoices,
      recentInvoices,
      projectStats: Object.fromEntries(projectStats.map(p => [p.status, p._count.id])),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
