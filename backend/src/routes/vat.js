const express = require('express');
const { auth } = require('../middleware/auth');
const prisma = require('../lib/prisma');

const router = express.Router();
const BGN_PER_EUR = 1.95583;

const toNumber = value => {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const asBgn = (amount, currency) => currency === 'EUR' ? toNumber(amount) * BGN_PER_EUR : toNumber(amount);

// GET /api/vat/monthly-breakdown?year=2025
// Returns all 12 months at once: outputVat, inputVat, netVat per month
router.get('/monthly-breakdown', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year || new Date().getFullYear());
    const start = new Date(Date.UTC(year, 0, 1));
    const end   = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const [invoices, purchases] = await Promise.all([
      prisma.invoice.findMany({
        where: { date: { gte: start, lte: end }, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: { date: true, currency: true, vatAmount: true, amountNet: true, amountTotal: true },
      }),
      prisma.purchase.findMany({
        where: { date: { gte: start, lte: end } },
        select: { date: true, currency: true, amount: true },
      }),
    ]);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthLabel: ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'][i],
      outputVat: 0,
      outputNet: 0,
      inputVat: 0,
      inputNet: 0,
      netVat: 0,
    }));

    for (const inv of invoices) {
      const m = new Date(inv.date).getUTCMonth();
      months[m].outputVat  += asBgn(inv.vatAmount, inv.currency);
      months[m].outputNet  += asBgn(inv.amountNet, inv.currency);
    }

    for (const pur of purchases) {
      const m = new Date(pur.date).getUTCMonth();
      const gross = asBgn(pur.amount, pur.currency);
      months[m].inputVat  += gross / 6;
      months[m].inputNet  += gross * 5 / 6;
    }

    for (const m of months) {
      m.outputVat = Number(m.outputVat.toFixed(2));
      m.outputNet = Number(m.outputNet.toFixed(2));
      m.inputVat  = Number(m.inputVat.toFixed(2));
      m.inputNet  = Number(m.inputNet.toFixed(2));
      m.netVat    = Number((m.outputVat - m.inputVat).toFixed(2));
    }

    res.json({ year, months });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/overview', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year || new Date().getFullYear());
    const month = req.query.month ? parseInt(req.query.month) : null;
    const start = new Date(Date.UTC(year, month ? month - 1 : 0, 1));
    const end = month
      ? new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
      : new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const [invoices, purchases, documents, vatAlerts] = await Promise.all([
      prisma.invoice.findMany({
        where: { date: { gte: start, lte: end }, status: { notIn: ['CANCELLED', 'ARCHIVED'] } },
        select: { id: true, number: true, date: true, currency: true, vatAmount: true, amountTotal: true },
      }),
      prisma.purchase.findMany({
        where: { date: { gte: start, lte: end } },
        include: { supplier: { select: { name: true } } },
      }),
      prisma.document.findMany({
        where: {
          createdAt: { gte: start, lte: end },
          status: 'PENDING',
          OR: [
            { type: 'INVOICE_IN' },
            { type: 'DELIVERY' },
          ],
        },
      }),
      prisma.alert.findMany({
        where: { type: 'VAT', status: 'ACTIVE' },
        orderBy: { detectedAt: 'desc' },
        take: 20,
      }),
    ]);

    const outputVat = invoices.reduce((s, i) => s + asBgn(i.vatAmount, i.currency), 0);
    const outputNet = invoices.reduce((s, i) => s + asBgn(i.amountTotal, i.currency), 0);
    const estimatedInputVat = purchases.reduce((s, p) => {
      const grossBgn = asBgn(p.amount, p.currency);
      return s + grossBgn / 6;
    }, 0);
    const pendingCredit = documents.reduce((s, d) => {
      const data = d.extractedData || {};
      const vat = toNumber(data.vatAmount);
      const total = toNumber(data.amountTotal || data.amount);
      return s + asBgn(vat || total / 6, data.currency || 'BGN');
    }, 0);

    res.json({
      period: { year, month, start, end },
      outputVat: Number(outputVat.toFixed(2)),
      outputNet: Number(outputNet.toFixed(2)),
      estimatedInputVat: Number(estimatedInputVat.toFixed(2)),
      pendingCredit: Number(pendingCredit.toFixed(2)),
      netVat: Number((outputVat - estimatedInputVat).toFixed(2)),
      afterPendingCredit: Number((outputVat - estimatedInputVat - pendingCredit).toFixed(2)),
      counts: {
        outgoingInvoices: invoices.length,
        incomingPurchases: purchases.length,
        pendingDocuments: documents.length,
        activeVatAlerts: vatAlerts.length,
      },
      alerts: vatAlerts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
