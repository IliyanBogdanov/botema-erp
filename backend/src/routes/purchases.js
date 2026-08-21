const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// Same normalize/similarity used by the Client/Supplier→Counterparty migration
// and lib/unparsedIncoming.js — kept in sync so "which supplier is this really"
// answers the same way everywhere.
function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(еоод|оод|ад|ет|ltd|gmbh|s\.?r\.?l\.?|spa|s\.?p\.?a\.?|inc|llc|b\.?v\.?|sn|srl|co)\b/gi, '')
    .replace(/[^\wа-я\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}
function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? inter / union : 0;
}

router.get('/', auth, async (req, res) => {
  const { year, supplierId, counterpartyId, projectId } = req.query;
  const where = {};
  if (year) where.year = parseInt(year);
  if (supplierId) where.supplierId = supplierId;
  if (counterpartyId) where.counterpartyId = counterpartyId;
  if (projectId) where.projectId = projectId;
  const purchases = await prisma.purchase.findMany({
    where, include: { supplier: { select: { name: true } }, project: { select: { code: true, name: true } } },
    orderBy: { date: 'desc' }
  });
  res.json(purchases);
});

router.post('/', auth, async (req, res) => {
  try {
    const { supplierId, projectId, ...rest } = req.body;
    // The supplier dropdown feeds Counterparty ids (see /api/suppliers). Purchase.supplierId
    // is still a required legacy FK into Supplier — resolve/reuse a Supplier row by fuzzy
    // name match (not exact) so near-duplicate spellings don't keep spawning new rows;
    // counterpartyId is set directly and is the field routes should read going forward.
    let resolvedSupplierId = null;
    let resolvedCounterpartyId = null;
    if (supplierId) {
      const cp = await prisma.counterparty.findUnique({ where: { id: supplierId } });
      if (cp) {
        resolvedCounterpartyId = cp.id;
        const candidates = await prisma.supplier.findMany();
        let best = null, bestSim = 0;
        for (const c of candidates) {
          const s = similarity(c.name, cp.name);
          if (s > bestSim) { bestSim = s; best = c; }
        }
        resolvedSupplierId = (best && bestSim >= 0.85)
          ? best.id
          : (await prisma.supplier.create({
              data: { name: cp.name, country: cp.country || 'BG', currency: cp.currency || 'EUR', email: cp.email || null },
            })).id;
      } else {
        // legacy caller still passing a real Supplier id directly
        const existing = await prisma.supplier.findUnique({ where: { id: supplierId } });
        if (!existing) return res.status(400).json({ error: 'Unknown supplier id' });
        resolvedSupplierId = existing.id;
      }
    }
    const purchase = await prisma.purchase.create({
      data: {
        ...rest,
        supplierId: resolvedSupplierId,
        counterpartyId: resolvedCounterpartyId,
        projectId: projectId || null,
        date: new Date(req.body.date),
        year: new Date(req.body.date).getFullYear(),
      },
    });
    res.status(201).json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', auth, async (req, res) => {
  try {
    const purchase = await prisma.purchase.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        supplier: true,
        project: { select: { id: true, code: true, name: true } },
      },
    });
    res.json(purchase);
  } catch {
    res.status(404).json({ error: 'Purchase not found' });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const { amount, currency, invoiceNo, description, status, projectId, date } = req.body;
    const data = {};
    if (amount !== undefined) data.amount = Number(amount);
    if (currency) data.currency = currency;
    if (invoiceNo !== undefined) data.invoiceNo = invoiceNo;
    if (description !== undefined) data.description = description;
    if (status) data.status = status;
    if (projectId !== undefined) data.projectId = projectId || null;
    if (date) { data.date = new Date(date); data.year = new Date(date).getFullYear(); }
    const purchase = await prisma.purchase.update({ where: { id: req.params.id }, data });
    res.json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
