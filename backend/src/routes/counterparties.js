const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');
const fx = require('../lib/fx');
const { AUTHORITATIVE_BIZ_DOC_STATUSES, netCostAmount } = require('../lib/costs');

const BGN_PER_EUR = 1.95583;
const toBGN = (amount, currency) => (currency === 'EUR' ? Number(amount || 0) * BGN_PER_EUR : Number(amount || 0));

// Ledger enrichment for type=SUPPLIER — documented (BizDocument INVOICE_IN,
// authoritative statuses) vs. actually paid ([OUT] bank payments). Ported from
// the pre-merge /api/suppliers (misc.js) — same source as the dashboard's
// top-suppliers widget, so numbers agree everywhere.
async function enrichSuppliers(counterparties, year) {
  await fx.loadRates();
  const cpIds = counterparties.map(c => c.id);
  if (!cpIds.length) return counterparties;

  const dateFilter = year
    ? { docDate: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T23:59:59.999Z`) } }
    : {};
  const docs = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES }, amountTotal: { not: null }, counterpartyId: { in: cpIds }, ...dateFilter },
    select: { counterpartyId: true, amountTotal: true, amountNet: true, vatAmount: true, currency: true },
  });
  const allTimeCounts = await prisma.bizDocument.groupBy({
    by: ['counterpartyId'],
    where: { docType: 'INVOICE_IN', status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES }, counterpartyId: { in: cpIds } },
    _count: { id: true },
  });
  const allTimeCountMap = Object.fromEntries(allTimeCounts.map(r => [r.counterpartyId, r._count.id]));

  const spendMap = {}, countMap = {};
  for (const doc of docs) {
    const eur = fx.toEur(netCostAmount(doc), doc.currency);
    spendMap[doc.counterpartyId] = (spendMap[doc.counterpartyId] || 0) + eur;
    countMap[doc.counterpartyId] = (countMap[doc.counterpartyId] || 0) + 1;
  }

  const payDateFilter = year
    ? { paymentDate: { gte: new Date(`${year}-01-01T00:00:00.000Z`), lte: new Date(`${year}-12-31T23:59:59.999Z`) } }
    : {};
  const outPays = await prisma.payment.findMany({
    where: { notes: { contains: '[OUT]' }, counterpartyId: { in: cpIds }, ...payDateFilter },
    select: { counterpartyId: true, amount: true, currency: true },
  });
  const paidMap = {};
  for (const pp of outPays) paidMap[pp.counterpartyId] = (paidMap[pp.counterpartyId] || 0) + fx.toEur(pp.amount, pp.currency);

  return counterparties.map(cp => {
    const documented = Math.round((spendMap[cp.id] || 0) * 100) / 100;
    const paid = Math.round((paidMap[cp.id] || 0) * 100) / 100;
    return {
      ...cp,
      purchaseCount: allTimeCountMap[cp.id] || 0,
      totalSpentEur: documented,
      totalSpentBgn: Math.round(documented * fx.BGN_PER_EUR * 100) / 100,
      filteredPurchaseCount: countMap[cp.id] || 0,
      paidEur: paid,
      gapEur: Math.round((documented - paid) * 100) / 100,
    };
  });
}

// Invoice enrichment for type=CLIENT — mirrors the pre-merge /api/clients.
async function enrichClients(counterparties) {
  const cpIds = counterparties.map(c => c.id);
  if (!cpIds.length) return counterparties;
  const invoices = await prisma.invoice.findMany({
    where: { counterpartyId: { in: cpIds }, status: { not: 'CANCELLED' } },
    select: { counterpartyId: true, amountNet: true, currency: true },
  });
  const revenueMap = {}, countMap = {};
  for (const inv of invoices) {
    revenueMap[inv.counterpartyId] = (revenueMap[inv.counterpartyId] || 0) + toBGN(inv.amountNet, inv.currency);
    countMap[inv.counterpartyId] = (countMap[inv.counterpartyId] || 0) + 1;
  }
  return counterparties.map(cp => ({
    ...cp,
    invoiceCount: countMap[cp.id] || 0,
    totalRevenueBGN: Math.round((revenueMap[cp.id] || 0) * 100) / 100,
  }));
}

// GET /api/counterparties — the one directory. ?type=SUPPLIER or ?type=CLIENT
// additionally enrich with ledger/revenue stats (skipped for the mixed "all
// types" view — same cost class as before the merge, not a new heavy query).
router.get('/', auth, async (req, res) => {
  try {
    const { type, search, year } = req.query;
    const where = {};
    if (type) where.type = type;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    let counterparties = await prisma.counterparty.findMany({
      where,
      include: { contacts: true, _count: { select: { bizDocuments: true, payments: true } } },
      orderBy: { name: 'asc' },
    });

    if (type === 'SUPPLIER') counterparties = await enrichSuppliers(counterparties, year);
    if (type === 'CLIENT') counterparties = await enrichClients(counterparties);

    res.json(counterparties);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/counterparties — generic create (clients, suppliers, designers/architects, etc.)
router.post('/', auth, async (req, res) => {
  try {
    const { name, type, isIndividual, eik, vat, country, currency, address, city, email, phone, website, notes, mol, since, clientType, brand } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type are required' });
    const cp = await prisma.counterparty.create({
      data: {
        name, type,
        isIndividual: !!isIndividual,
        eik: eik || null,
        vat: vat || null,
        country: country || 'BG',
        currency: currency || (type === 'SUPPLIER' ? 'EUR' : 'BGN'),
        address: address || null,
        city: city || null,
        email: email || null,
        phone: phone || null,
        website: website || null,
        notes: notes || null,
        mol: mol || null,
        since: since ? Number(since) : null,
        clientType: clientType || null,
        brand: brand || null,
      },
    });
    res.status(201).json(cp);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/counterparties/:id — full update (replaces the old, narrower
// suppliersRouter.patch which only accepted name/country/currency/email/notes)
router.patch('/:id', auth, async (req, res) => {
  try {
    const fields = ['name', 'type', 'subtype', 'isIndividual', 'eik', 'vat', 'country', 'currency', 'address', 'city', 'email', 'phone', 'website', 'notes', 'mol', 'since', 'clientType', 'brand'];
    const data = {};
    for (const f of fields) if (req.body[f] !== undefined) data[f] = req.body[f];
    if (data.since !== undefined && data.since !== null) data.since = Number(data.since);
    const cp = await prisma.counterparty.update({ where: { id: req.params.id }, data });
    res.json(cp);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/counterparties/:id — detail, enriched per type (replaces /clients/:id and /suppliers/:id)
router.get('/:id', auth, async (req, res) => {
  try {
    const cp = await prisma.counterparty.findUnique({
      where: { id: req.params.id },
      include: { contacts: true, _count: { select: { bizDocuments: true, payments: true } } },
    });
    if (!cp) return res.status(404).json({ error: 'Not found' });

    if (cp.type === 'SUPPLIER') {
      await fx.loadRates();
      const docs = await prisma.bizDocument.findMany({
        where: { counterpartyId: cp.id, docType: 'INVOICE_IN', status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES }, amountTotal: { not: null } },
        include: { project: { select: { id: true, code: true, name: true } } },
        orderBy: { docDate: 'desc' },
      });
      const totalsByYear = {};
      for (const d of docs) {
        const y = d.docDate ? new Date(d.docDate).getUTCFullYear() : 'unknown';
        totalsByYear[y] = (totalsByYear[y] || 0) + fx.toEur(netCostAmount(d), d.currency);
      }
      for (const y of Object.keys(totalsByYear)) totalsByYear[y] = Math.round(totalsByYear[y] * 100) / 100;
      const totalEur = Object.values(totalsByYear).reduce((s, v) => s + v, 0);
      return res.json({
        ...cp, purchaseCount: docs.length, totalSpentEur: Math.round(totalEur * 100) / 100, totalsByYear,
        purchases: docs.map(d => ({
          id: d.id, invoiceNo: d.docNumber, date: d.docDate,
          year: d.docDate ? new Date(d.docDate).getUTCFullYear() : null,
          amount: Number(d.amountTotal), currency: d.currency,
          amountEur: Number(fx.toEur(Number(d.amountTotal), d.currency).toFixed(2)),
          description: d.notes, status: d.status, project: d.project,
        })),
      });
    }

    if (cp.type === 'CLIENT') {
      const invoices = await prisma.invoice.findMany({
        where: { counterpartyId: cp.id, status: { not: 'CANCELLED' } },
        include: { project: { select: { id: true, code: true, name: true } } },
        orderBy: { date: 'desc' },
      });
      const totalRevenueBGN = invoices.reduce((s, inv) => s + toBGN(inv.amountNet, inv.currency), 0);
      const totalVatBGN = invoices.reduce((s, inv) => s + toBGN(inv.vatAmount, inv.currency), 0);
      const outstandingBGN = invoices.filter(inv => inv.status !== 'PAID').reduce((s, inv) => s + toBGN(inv.amountTotal, inv.currency), 0);
      const revenueByYear = invoices.reduce((acc, inv) => {
        const y = new Date(inv.date).getFullYear();
        acc[y] = (acc[y] || 0) + toBGN(inv.amountNet, inv.currency);
        return acc;
      }, {});
      const projectCount = await prisma.project.count({ where: { counterpartyId: cp.id } });
      return res.json({
        ...cp, invoiceCount: invoices.length, projectCount,
        totalRevenueBGN: Math.round(totalRevenueBGN * 100) / 100,
        totalVatBGN: Math.round(totalVatBGN * 100) / 100,
        outstandingBGN: Math.round(outstandingBGN * 100) / 100,
        revenueByYear,
        invoices: invoices.map(inv => ({
          id: inv.id, number: inv.number, date: inv.date, dueDate: inv.dueDate, status: inv.status,
          amountNet: Number(inv.amountNet), amountTotal: Number(inv.amountTotal), currency: inv.currency, project: inv.project,
        })),
      });
    }

    const bizDocuments = await prisma.bizDocument.findMany({ where: { counterpartyId: cp.id }, orderBy: { docDate: 'desc' }, take: 20 });
    const payments = await prisma.payment.findMany({ where: { counterpartyId: cp.id }, orderBy: { paymentDate: 'desc' }, take: 10 });
    res.json({ ...cp, bizDocuments, payments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/counterparties/:id/merge-into/:targetId — repoint every FK from
// :id onto :targetId, then delete :id. In-app replacement for the one-off
// terminal scripts (mergeCounterparties.js etc.) past sessions used.
router.post('/:id/merge-into/:targetId', auth, async (req, res) => {
  const { id: fromId, targetId } = req.params;
  if (fromId === targetId) return res.status(400).json({ error: 'Cannot merge a counterparty into itself' });
  try {
    const [from, to] = await Promise.all([
      prisma.counterparty.findUnique({ where: { id: fromId } }),
      prisma.counterparty.findUnique({ where: { id: targetId } }),
    ]);
    if (!from || !to) return res.status(404).json({ error: 'Counterparty not found' });

    await prisma.$transaction([
      prisma.payment.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.bizDocument.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.order.updateMany({ where: { clientId: fromId }, data: { clientId: targetId } }),
      prisma.order.updateMany({ where: { supplierId: fromId }, data: { supplierId: targetId } }),
      prisma.delivery.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.missingDocument.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.contact.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.invoice.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.project.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.project.updateMany({ where: { designerId: fromId }, data: { designerId: targetId } }),
      prisma.purchase.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.inventoryItem.updateMany({ where: { counterpartyId: fromId }, data: { counterpartyId: targetId } }),
      prisma.counterparty.delete({ where: { id: fromId } }),
    ]);
    res.json({ ok: true, mergedInto: targetId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
