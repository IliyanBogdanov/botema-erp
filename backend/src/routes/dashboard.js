const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

const fx = require('../lib/fx');
const { AUTHORITATIVE_BIZ_DOC_STATUSES, netCostAmount } = require('../lib/costs');
const { STAGE_ORDER, STAGE_LABELS } = require('../lib/dealStages');

const toNumber = value => Number(value || 0);
const toEur = fx.toEur;
const toBgn = fx.toBgn;

// GET /api/dashboard — Main KPIs
router.get('/', auth, async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const yearNum = parseInt(year, 10);
    const startDate = new Date(`${yearNum}-01-01T00:00:00.000Z`);
    const endDate = new Date(`${yearNum}-12-31T23:59:59.999Z`);
    await fx.loadRates();
    const usdPerEur = fx.ratesPerEur().USD || 1.14;

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
      bankFlows,
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
          SUM(CASE WHEN currency = 'EUR' THEN "amountNet"
                   WHEN currency = 'USD' THEN "amountNet" / ${usdPerEur}
                   ELSE "amountNet" / 1.95583 END) as revenue,
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
          SUM(CASE WHEN currency = 'EUR' THEN "amountNet"
                   WHEN currency = 'USD' THEN "amountNet" / ${usdPerEur}
                   ELSE "amountNet" / 1.95583 END) AS revenue_eur
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
      // Use BizDocument INVOICE_IN as the authoritative cost source (more complete than Purchase).
      // `not: null` (not `gt: 0`): credit notes are negative and must reduce costs.
      prisma.bizDocument.findMany({
        where: {
          docType: 'INVOICE_IN',
          status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
          amountTotal: { not: null },
          docDate: { gte: startDate, lte: endDate },
        },
        select: { amountTotal: true, amountNet: true, vatAmount: true, currency: true, counterpartyId: true },
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
      // Bank truth (leading source): categorized cash flows for the year
      prisma.payment.findMany({
        where: { paymentDate: { gte: startDate, lte: endDate } },
        select: { amount: true, currency: true, category: true },
      }),
    ]);

    const clientIds = topClients.map(c => c.clientId).filter(Boolean);
    const clientNames = clientIds.length ? await prisma.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true }
    }) : [];
    const clientMap = Object.fromEntries(clientNames.map(c => [c.id, c.name]));

    // Build cost totals from BizDocument INVOICE_IN — NET of recoverable VAT
    const purchaseTotalsByCurrency = bizCostRows.reduce((acc, row) => {
      acc[row.currency] = (acc[row.currency] || 0) + netCostAmount(row);
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
      const amountEur = toEur(netCostAmount(row), row.currency);
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

    // Bank-first cash KPIs (банката винаги води)
    const bankByCat = {};
    let bankInEur = 0, bankOutEur = 0;
    for (const bp of bankFlows) {
      const eur = toEur(bp.amount, bp.currency);
      const cat = bp.category || 'OTHER';
      bankByCat[cat] = (bankByCat[cat] || 0) + eur;
      if (cat === 'INCOME') bankInEur += eur; else bankOutEur += eur;
    }
    const bankPurchasesEur = (bankByCat.PURCHASE || 0) + (bankByCat.LOGISTICS || 0);

    const revenueNum = revenueInvoices.reduce((s, inv) => s + toBgn(inv.amountNet, inv.currency), 0);
    const revenueEur = revenueInvoices.reduce((s, inv) => s + toEur(inv.amountNet, inv.currency), 0);
    const vatCollected = revenueInvoices.reduce((s, inv) => s + toBgn(inv.vatAmount, inv.currency), 0);
    const vatCollectedEur = revenueInvoices.reduce((s, inv) => s + toEur(inv.vatAmount, inv.currency), 0);
    // Total costs = purchases + overhead expenses
    const costsNum = Number((totalPurchasesBgn + expensesBgn) || 0);
    const costsEur = Number((totalPurchasesEur + expensesEur) || 0);
    const available = Number(totalInventory._sum.qtyIn || 0) - Number(totalInventory._sum.qtyOut || 0);

    res.json({
      generatedAt: new Date().toISOString(),
      feed: {
        sources: ['invoices', 'purchases', 'bank-payments', 'documents'],
        period: {
          year: yearNum,
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
      },
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
        // Bank truth (leading): cash-basis flows for the selected year
        bankInEur: Number(bankInEur.toFixed(2)),
        bankOutEur: Number(bankOutEur.toFixed(2)),
        bankPurchasesEur: Number(bankPurchasesEur.toFixed(2)),
        bankNetEur: Number((bankInEur - bankOutEur).toFixed(2)),
        bankByCategory: Object.fromEntries(Object.entries(bankByCat).map(([k, v]) => [k, Number(v.toFixed(2))])),
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
        processed: paymentStats.reduce((s, p) => s + (p.status === 'MATCHED' || p.status === 'PARTIAL' ? (p._count || 0) : 0), 0),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/pipeline — live deal-stage counts for the "Днес" operational
// view. Pure groupBy/count, no row hydration — safe for frequent polling
// (same cost class as /api/alerts/count).
router.get('/pipeline', auth, async (req, res) => {
  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [byStageRaw, unstagedCount, stuckCount] = await Promise.all([
      prisma.project.groupBy({
        by: ['dealStage'],
        where: { status: 'ACTIVE', dealStage: { not: null } },
        _count: { id: true },
      }),
      prisma.project.count({
        where: { status: 'ACTIVE', dealStage: null },
      }),
      prisma.project.count({
        where: {
          status: 'ACTIVE',
          dealStage: { notIn: ['INVOICED_ZERO', 'CLOSED'] },
          dealStageUpdatedAt: { lt: fourteenDaysAgo },
        },
      }),
    ]);

    const countByStage = Object.fromEntries(byStageRaw.map(r => [r.dealStage, r._count.id]));
    const byStage = STAGE_ORDER.map(stage => ({
      stage,
      label: STAGE_LABELS[stage],
      count: countByStage[stage] || 0,
    }));

    res.json({ byStage, unstagedCount, stuckCount });
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
    await fx.loadRates();
    const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${year}-12-31T23:59:59.999Z`);

    const [invoices, bizCosts, expenses] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          date: { gte: yearStart, lte: yearEnd },
          status: { not: 'CANCELLED' },
        },
        select: { date: true, currency: true, amountNet: true, vatAmount: true, amountTotal: true },
      }),
      // BizDocument INVOICE_IN is the authoritative cost source (net; credit notes reduce costs)
      prisma.bizDocument.findMany({
        where: {
          docType: 'INVOICE_IN',
          status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
          amountTotal: { not: null },
          docDate: { gte: yearStart, lte: yearEnd },
        },
        select: { docDate: true, currency: true, amountTotal: true, amountNet: true, vatAmount: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: yearStart, lte: yearEnd } },
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
      const m = new Date(inv.date).getUTCMonth();
      months[m].revenue += toEur(inv.amountNet, inv.currency);
    }

    for (const biz of bizCosts) {
      const m = new Date(biz.docDate).getUTCMonth();
      months[m].costs += toEur(netCostAmount(biz), biz.currency);
    }

    for (const exp of expenses) {
      const m = new Date(exp.date).getUTCMonth();
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

// GET /api/dashboard/cashflow?year=2026
// Bank-first monthly cash flow (the leading source of truth): per-month
// in/out/net in EUR plus a category breakdown for the year.
router.get('/cashflow', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year || new Date().getFullYear());
    await fx.loadRates();
    const payments = await prisma.payment.findMany({
      where: { paymentDate: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T23:59:59.999Z`) } },
      select: { paymentDate: true, amount: true, currency: true, category: true },
    });
    const MONTH_NAMES = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
    const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: MONTH_NAMES[i], inEur: 0, outEur: 0, netEur: 0 }));
    const byCategory = {};
    for (const p of payments) {
      const eur = toEur(p.amount, p.currency);
      const m = new Date(p.paymentDate).getUTCMonth();
      const cat = p.category || 'OTHER';
      byCategory[cat] = (byCategory[cat] || 0) + eur;
      if (cat === 'INCOME') months[m].inEur += eur; else months[m].outEur += eur;
    }
    for (const m of months) {
      m.inEur = Number(m.inEur.toFixed(2));
      m.outEur = Number(m.outEur.toFixed(2));
      m.netEur = Number((m.inEur - m.outEur).toFixed(2));
    }
    const totals = {
      inEur: Number(months.reduce((s, m) => s + m.inEur, 0).toFixed(2)),
      outEur: Number(months.reduce((s, m) => s + m.outEur, 0).toFixed(2)),
    };
    totals.netEur = Number((totals.inEur - totals.outEur).toFixed(2));
    res.json({
      year,
      source: 'bank',
      months,
      totals,
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, Number(v.toFixed(2))]).sort((a, b) => b[1] - a[1])),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/forecast — 30/60/90-day cash-flow forecast.
// Outflows (AP): documented purchases with no bank-confirmed payment yet.
// Inflows (AR): issued invoices not yet marked PAID.
// Bucketed by due date relative to today (falls back to doc/invoice date + 30d
// when no due date is set) — OVERDUE / 0-30 / 31-60 / 61-90 / 90+.
router.get('/forecast', auth, async (req, res) => {
  try {
    await fx.loadRates();
    const today = new Date();

    const bucketFor = date => {
      const days = Math.floor((date - today) / 86400000);
      if (days < 0) return 'OVERDUE';
      if (days <= 30) return 'D0_30';
      if (days <= 60) return 'D31_60';
      if (days <= 90) return 'D61_90';
      return 'D90_PLUS';
    };
    const makeBuckets = () => ({ OVERDUE: 0, D0_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0 });

    // ── Outflows: documented BizDocument INVOICE_IN without a real payment link ──
    const apDocs = await prisma.bizDocument.findMany({
      where: {
        docType: 'INVOICE_IN',
        status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
        amountTotal: { not: null },
      },
      select: {
        docDate: true, dueDate: true, currency: true, amountNet: true, amountTotal: true,
        counterparty: { select: { name: true } },
        linkedTo: { select: { linkType: true } },
      },
    });
    const outflowBuckets = makeBuckets();
    const outflowItems = [];
    for (const doc of apDocs) {
      if (doc.linkedTo.some(l => l.linkType === 'PAYMENT_TO_INVOICE')) continue; // already bank-confirmed
      const dueDate = doc.dueDate || new Date((doc.docDate || today).getTime() + 30 * 86400000);
      const eur = fx.toEur(netCostAmount(doc), doc.currency);
      const bucket = bucketFor(dueDate);
      outflowBuckets[bucket] += eur;
      outflowItems.push({ dueDate, counterparty: doc.counterparty?.name || null, amountEur: Number(eur.toFixed(2)), bucket });
    }

    // ── Inflows: issued invoices not yet PAID ──
    const arInvoices = await prisma.invoice.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] } },
      select: { number: true, date: true, dueDate: true, currency: true, amountNet: true, clientId: true, client: { select: { name: true } } },
    });
    const inflowBuckets = makeBuckets();
    const inflowItems = [];
    for (const inv of arInvoices) {
      const dueDate = inv.dueDate || new Date(inv.date.getTime() + 30 * 86400000);
      const eur = fx.toEur(inv.amountNet, inv.currency);
      const bucket = bucketFor(dueDate);
      inflowBuckets[bucket] += eur;
      inflowItems.push({ dueDate, number: inv.number, client: inv.client?.name || null, amountEur: Number(eur.toFixed(2)), bucket });
    }

    const round2 = n => Number(n.toFixed(2));
    for (const k of Object.keys(outflowBuckets)) outflowBuckets[k] = round2(outflowBuckets[k]);
    for (const k of Object.keys(inflowBuckets)) inflowBuckets[k] = round2(inflowBuckets[k]);

    const netBuckets = {};
    for (const k of Object.keys(outflowBuckets)) netBuckets[k] = round2(inflowBuckets[k] - outflowBuckets[k]);

    res.json({
      generatedAt: today.toISOString(),
      outflows: { buckets: outflowBuckets, totalEur: round2(Object.values(outflowBuckets).reduce((a, b) => a + b, 0)) },
      inflows: { buckets: inflowBuckets, totalEur: round2(Object.values(inflowBuckets).reduce((a, b) => a + b, 0)) },
      net: netBuckets,
      items: {
        outflows: outflowItems.sort((a, b) => a.dueDate - b.dueDate).slice(0, 200),
        inflows: inflowItems.sort((a, b) => a.dueDate - b.dueDate).slice(0, 200),
      },
    });
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
