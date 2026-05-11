const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

// GET /api/search?q=term
router.get('/', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ results: [] });

    const term = q.trim();

    const [clients, invoices, projects, suppliers, purchases, documents, counterparties] = await Promise.all([
      prisma.client.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { eik: { contains: term } },
          ],
        },
        take: 4,
        select: { id: true, name: true, city: true },
      }),
      prisma.invoice.findMany({
        where: {
          OR: [
            { number: { contains: term, mode: 'insensitive' } },
            { client: { name: { contains: term, mode: 'insensitive' } } },
          ],
        },
        take: 4,
        select: {
          id: true, number: true, amountTotal: true, currency: true, status: true,
          client: { select: { name: true } },
        },
      }),
      prisma.project.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { code: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 4,
        select: { id: true, code: true, name: true, status: true },
      }),
      prisma.supplier.findMany({
        where: { name: { contains: term, mode: 'insensitive' } },
        take: 4,
        select: { id: true, name: true, country: true },
      }),
      prisma.purchase.findMany({
        where: {
          OR: [
            { invoiceNo: { contains: term, mode: 'insensitive' } },
            { supplier: { name: { contains: term, mode: 'insensitive' } } },
          ],
        },
        take: 4,
        select: {
          id: true, invoiceNo: true, amount: true, currency: true,
          supplier: { select: { name: true } },
        },
      }),
      prisma.$queryRaw`
        SELECT id, filename, type, status,
               (extracted_data->>'invoiceNo') AS "invoiceNo",
               (extracted_data->>'supplierName') AS "supplierName",
               (extracted_data->>'amountTotal') AS "amountTotal",
               (extracted_data->>'currency') AS currency,
               (extracted_data->>'docDate') AS "docDate"
        FROM documents
        WHERE status != 'REJECTED'
          AND (
            LOWER(filename) LIKE LOWER(${`%${term}%`})
            OR LOWER(extracted_data->>'invoiceNo') LIKE LOWER(${`%${term}%`})
            OR LOWER(extracted_data->>'supplierName') LIKE LOWER(${`%${term}%`})
            OR LOWER(extracted_data->>'description') LIKE LOWER(${`%${term}%`})
          )
        LIMIT 5
      `,
      prisma.counterparty.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { eik: { contains: term } },
          ],
        },
        take: 3,
        select: { id: true, name: true, type: true, country: true },
      }),
    ]);

    const results = [
      ...clients.map(c => ({
        type: 'client', id: c.id,
        title: c.name,
        subtitle: c.city || 'Клиент',
        url: `/clients`,
        icon: 'person',
      })),
      ...invoices.map(i => ({
        type: 'invoice', id: i.id,
        title: i.number,
        subtitle: i.client?.name || '—',
        amount: Number(i.amountTotal || 0),
        currency: i.currency,
        status: i.status,
        url: `/invoices/${i.id}`,
        icon: 'receipt_long',
      })),
      ...projects.map(p => ({
        type: 'project', id: p.id,
        title: `${p.code} — ${p.name}`,
        subtitle: p.status,
        url: `/projects/${p.id}`,
        icon: 'design_services',
      })),
      ...suppliers.map(s => ({
        type: 'supplier', id: s.id,
        title: s.name,
        subtitle: s.country || 'Доставчик',
        url: `/suppliers`,
        icon: 'local_shipping',
      })),
      ...purchases.map(p => ({
        type: 'purchase', id: p.id,
        title: p.invoiceNo || p.id.slice(0, 8),
        subtitle: p.supplier?.name || 'Покупка',
        amount: Number(p.amount || 0),
        currency: p.currency,
        url: `/purchases/${p.id}`,
        icon: 'shopping_cart',
      })),
      ...(documents || []).map(d => ({
        type: 'document', id: d.id,
        title: d.invoiceNo || d.filename || d.id.slice(0, 8),
        subtitle: d.supplierName || d.filename || 'Документ',
        amount: d.amountTotal ? Number(d.amountTotal) : undefined,
        currency: d.currency,
        status: d.status,
        url: `/documents`,
        icon: 'description',
      })),
      ...(counterparties || []).map(c => ({
        type: 'counterparty', id: c.id,
        title: c.name,
        subtitle: `${c.type} · ${c.country || 'BG'}`,
        url: `/counterparties`,
        icon: 'business',
      })),
    ];

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
