const express = require('express');
const { auth } = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { resolveDuplicateActiveAlerts } = require('../lib/alertEngine');

const router = express.Router();
const BGN_PER_EUR = 1.95583;
const AUTHORITATIVE_BIZ_DOC_STATUSES = ['REVIEWED', 'IMPORTED', 'MATCHED'];

const toNumber = value => {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const asBgn = (amount, currency) => currency === 'EUR' ? toNumber(amount) * BGN_PER_EUR : toNumber(amount);
const asEur = (amount, currency) => currency === 'BGN' ? toNumber(amount) / BGN_PER_EUR : toNumber(amount);

function isLikelyNonVatPendingDocument(doc) {
  const data = doc.extractedData || {};
  const text = `${doc.filename || ''} ${data.folder || ''} ${data.subject || ''}`.toLowerCase();
  return [
    'price list',
    'pricelist',
    'catalog',
    'catalogue',
    'listino',
    'portfolio',
    'quotation',
    'offer',
    'order_',
    'bank',
    'statement',
    'извлечение',
    'транзакция',
    'proforma',
  ].some(marker => text.includes(marker));
}

function pendingDocumentVatBgn(doc) {
  const data = doc.extractedData || {};
  if (isLikelyNonVatPendingDocument(doc)) return 0;

  const type = data.docType || data.type || doc.type;
  if (!['INVOICE_IN', 'DELIVERY_NOTE', 'DELIVERY'].includes(type)) return 0;

  const total = toNumber(data.amountTotal || data.amount);
  const currency = String(data.currency || 'BGN').toUpperCase();
  const totalEur = asEur(total, currency);
  if (!total || totalEur <= 0 || totalEur > 250000) return 0;

  const confidence = toNumber(doc.confidence);
  if (confidence > 0 && confidence < 0.7) return 0;

  const explicitVat = toNumber(data.vatAmount);
  if (explicitVat > 0) return asBgn(explicitVat, currency);

  // EUR supplier invoices are usually intra-EU/reverse-charge and should not
  // create Bulgarian input VAT just because the gross amount is known.
  if (currency !== 'BGN') return 0;
  return asBgn(total, currency) / 6;
}

function bizDocumentInputVatBgn(doc) {
  const explicitVat = toNumber(doc.vatAmount);
  if (explicitVat > 0) return asBgn(explicitVat, doc.currency);

  // For BGN supplier invoices, estimate VAT from gross only when explicit VAT
  // is missing. EUR supplier invoices are usually intra-EU/reverse-charge.
  if (String(doc.currency || '').toUpperCase() !== 'BGN') return 0;
  return asBgn(doc.amountTotal, doc.currency) / 6;
}

function bizDocumentInputNetBgn(doc) {
  const gross = asBgn(doc.amountTotal, doc.currency);
  return Math.max(gross - bizDocumentInputVatBgn(doc), 0);
}

// GET /api/vat/monthly-breakdown?year=2025
// Returns all 12 months at once: outputVat, inputVat, netVat per month
router.get('/monthly-breakdown', auth, async (req, res) => {
  try {
    const year = parseInt(req.query.year || new Date().getFullYear());
    const start = new Date(Date.UTC(year, 0, 1));
    const end   = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const [invoices, incomingDocs] = await Promise.all([
      prisma.invoice.findMany({
        where: { date: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
        select: { date: true, currency: true, vatAmount: true, amountNet: true, amountTotal: true },
      }),
      prisma.bizDocument.findMany({
        where: {
          docType: 'INVOICE_IN',
          status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
          amountTotal: { gt: 0 },
          docDate: { gte: start, lte: end },
        },
        select: { docDate: true, currency: true, vatAmount: true, amountTotal: true },
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

    for (const doc of incomingDocs) {
      const m = new Date(doc.docDate).getUTCMonth();
      months[m].inputVat += bizDocumentInputVatBgn(doc);
      months[m].inputNet += bizDocumentInputNetBgn(doc);
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

    await resolveDuplicateActiveAlerts(prisma);

    const [invoices, incomingDocs, documents, vatAlerts] = await Promise.all([
      prisma.invoice.findMany({
        where: { date: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
        select: { id: true, number: true, date: true, currency: true, vatAmount: true, amountTotal: true },
      }),
      prisma.bizDocument.findMany({
        where: {
          docType: 'INVOICE_IN',
          status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES },
          amountTotal: { gt: 0 },
          docDate: { gte: start, lte: end },
        },
        select: { currency: true, vatAmount: true, amountTotal: true },
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
    const estimatedInputVat = incomingDocs.reduce((s, doc) => s + bizDocumentInputVatBgn(doc), 0);
    const pendingVatDocuments = documents.filter(d => pendingDocumentVatBgn(d) > 0);
    const pendingCredit = pendingVatDocuments.reduce((s, d) => s + pendingDocumentVatBgn(d), 0);

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
        incomingPurchases: incomingDocs.length,
        pendingDocuments: pendingVatDocuments.length,
        activeVatAlerts: vatAlerts.length,
      },
      alerts: vatAlerts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
