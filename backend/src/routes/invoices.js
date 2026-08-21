const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');
const { downloadDriveFile } = require('../lib/aiParser');

// GET /api/invoices
router.get('/', auth, async (req, res) => {
  try {
    const { year, brand, status, clientId, search, page = 1, limit = 50 } = req.query;
    const where = {};
    if (year)     where.date = { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31T23:59:59.999Z`) };
    if (brand)    where.brand = brand;
    if (status)   where.status = status;
    if (clientId) where.OR = [{ clientId }, { counterpartyId: clientId }];
    if (search)   where.OR = [
      { number: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { client: { name: { contains: search, mode: 'insensitive' } } },
      { counterparty: { name: { contains: search, mode: 'insensitive' } } },
    ];

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          client: { select: { id: true, name: true } },
          counterparty: { select: { id: true, name: true } },
          project: { select: { id: true, code: true, name: true } },
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * limit,
        take: parseInt(limit),
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({
      data: invoices.map(inv => ({ ...inv, client: inv.counterparty || inv.client })),
      total, page: parseInt(page), pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices/mark-overdue — auto-mark PENDING invoices past dueDate as OVERDUE
router.post('/mark-overdue', auth, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = await prisma.invoice.updateMany({
      where: { status: 'PENDING', dueDate: { lt: today } },
      data: { status: 'OVERDUE' },
    });
    res.json({ marked: result.count, asOf: today.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/aging — aging report (days overdue) for non-paid invoices
router.get('/aging', auth, async (req, res) => {
  try {
    const today = new Date();
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] } },
      include: { client: { select: { id: true, name: true } }, counterparty: { select: { id: true, name: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const fx = require('../lib/fx');
    await fx.loadRates();
    const toEur = fx.toEur;

    const result = invoices.map(inv => {
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      const daysOverdue = due ? Math.floor((today.getTime() - due.getTime()) / 86400000) : null;
      return {
        id: inv.id,
        number: inv.number,
        date: inv.date,
        dueDate: inv.dueDate,
        status: inv.status,
        amountTotal: Number(inv.amountTotal),
        amountEur: Number(toEur(inv.amountTotal, inv.currency).toFixed(2)),
        currency: inv.currency,
        clientName: inv.counterparty?.name || inv.client?.name || null,
        daysOverdue,
        bucket: daysOverdue === null ? 'NO_DUE_DATE'
          : daysOverdue <= 0 ? 'CURRENT'
          : daysOverdue <= 30 ? '1-30_DAYS'
          : daysOverdue <= 60 ? '31-60_DAYS'
          : daysOverdue <= 90 ? '61-90_DAYS'
          : 'OVER_90_DAYS',
      };
    });

    // summary mixes currencies (raw amounts) — kept for backward compat;
    // summaryEur is the currency-converted version clients should use
    const summary = {};
    const summaryEur = {};
    for (const inv of result) {
      summary[inv.bucket] = (summary[inv.bucket] || 0) + inv.amountTotal;
      summaryEur[inv.bucket] = Number(((summaryEur[inv.bucket] || 0) + inv.amountEur).toFixed(2));
    }

    res.json({ invoices: result, summary, summaryEur });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { client: true, counterparty: true, project: true, items: true, createdBy: { select: { name: true } } }
    });
    if (!invoice) return res.status(404).json({ error: 'Not found' });
    res.json({ ...invoice, client: invoice.counterparty || invoice.client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices
router.post('/', auth, async (req, res) => {
  try {
    const { clientId, counterpartyId, projectId, type, brand, currency, date, dueDate,
            description, notes, items } = req.body;

    // Calculate totals
    const amountNet = items.reduce((s, i) => s + (i.qty * i.unitPrice), 0);
    const vatAmount = items.reduce((s, i) => s + (i.qty * i.unitPrice * i.vatPct / 100), 0);
    const amountTotal = amountNet + vatAmount;

    // Generate number — ONE sequence across brands (Studio Botema and its
    // Luminavera online-shop channel are the same legal entity/VAT number;
    // the accountant numbers them in a single sequence in Micro.bg).
    const last = await prisma.invoice.findFirst({ orderBy: { number: 'desc' } });
    const nextNum = last ? parseInt(last.number.replace(/\D/g, '')) + 1 : 1;
    const number = String(nextNum).padStart(10, '0');

    const invoice = await prisma.invoice.create({
      data: {
        number,
        ...(clientId  ? { clientId }  : {}),
        ...(counterpartyId ? { counterpartyId } : {}),
        ...(projectId ? { projectId } : {}),
        type, brand, currency,
        date: new Date(date), dueDate: dueDate ? new Date(dueDate) : null,
        description, notes, amountNet, vatAmount, amountTotal,
        status: 'PENDING',
        createdById: req.user.id,
        items: { create: items.map(i => ({
          description: i.description, qty: i.qty,
          unitPrice: i.unitPrice, vatPct: i.vatPct || 20,
          total: i.qty * i.unitPrice * (1 + (i.vatPct || 20) / 100)
        }))}
      },
      include: { client: true, counterparty: true, project: true, items: true }
    });
    res.status(201).json({ ...invoice, client: invoice.counterparty || invoice.client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/invoices/:id
router.patch('/:id', auth, async (req, res) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: req.body,
      include: { client: true, counterparty: true, project: true }
    });
    res.json({ ...invoice, client: invoice.counterparty || invoice.client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/invoices/:id/file  — stream Drive PDF inline
router.get('/:id/file', auth, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      select: { driveFileId: true, number: true },
    });
    if (!invoice) return res.status(404).json({ error: 'Not found' });
    if (!invoice.driveFileId) return res.status(404).json({ error: 'No Drive file attached' });

    const buffer = await downloadDriveFile(invoice.driveFileId);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="invoice-${invoice.number}.pdf"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/invoices/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    await prisma.invoice.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/invoices/validate-xls
// Parses the IssuedInvoices XLS export and compares with the Invoice table.
router.post('/validate-xls', auth, async (req, res) => {
  const HISTORY_DIR = path.resolve(__dirname, '../../../history invoices');
  try {
    let xlsFiles = [];
    if (fs.existsSync(HISTORY_DIR)) {
      xlsFiles = fs.readdirSync(HISTORY_DIR).filter(f => /\.(xls|xlsx)$/i.test(f));
    }
    if (xlsFiles.length === 0) {
      return res.status(404).json({ error: `No XLS files found in: ${HISTORY_DIR}` });
    }
    // Use the most recently modified file
    const xlsPath = path.join(HISTORY_DIR, xlsFiles[xlsFiles.length - 1]);

    const workbook = XLSX.readFile(xlsPath, { type: 'file', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const normalize = (row) => {
      const keys = Object.keys(row);
      const find = (...patterns) => {
        for (const p of patterns) {
          const k = keys.find(k => k.toLowerCase().includes(p.toLowerCase()));
          if (k !== undefined) return row[k];
        }
        return '';
      };
      return {
        number: String(find('номер', 'number', 'фактура', 'invoice') || '').trim(),
        date: find('дата', 'date'),
        clientName: String(find('клиент', 'client', 'получател', 'counterparty') || '').trim(),
        amountTotal: parseFloat(String(find('сума', 'total', 'amount', 'стойност') || '0').replace(',', '.')) || 0,
        currency: String(find('валута', 'currency') || 'EUR').trim() || 'EUR',
      };
    };

    const xlsInvoices = rows.map(normalize).filter(r => r.number);

    const dbInvoices = await prisma.invoice.findMany({
      select: { id: true, number: true, amountTotal: true, currency: true, date: true, status: true },
    });

    const dbMap = new Map(dbInvoices.map(inv => [inv.number?.trim(), inv]));
    const xlsMap = new Map(xlsInvoices.map(inv => [inv.number, inv]));

    const matched = [];
    const inXlsOnly = [];
    const amountDiffs = [];

    for (const xls of xlsInvoices) {
      const db = dbMap.get(xls.number);
      if (!db) {
        inXlsOnly.push(xls);
      } else {
        const dbTotal = Number(db.amountTotal || 0);
        const diff = Math.abs(dbTotal - xls.amountTotal);
        if (diff > 0.02) {
          amountDiffs.push({ number: xls.number, xlsTotal: xls.amountTotal, dbTotal, diff: Number(diff.toFixed(2)), currency: xls.currency });
        } else {
          matched.push(xls.number);
        }
      }
    }

    const inDbOnly = dbInvoices
      .filter(db => db.number && !xlsMap.has(db.number.trim()))
      .map(db => ({ number: db.number, status: db.status, amountTotal: Number(db.amountTotal || 0), currency: db.currency }));

    res.json({
      xlsFile: xlsFiles[xlsFiles.length - 1],
      xlsCount: xlsInvoices.length,
      dbCount: dbInvoices.length,
      matchedCount: matched.length,
      inXlsOnly,
      inDbOnly,
      amountDiffs,
      summary: {
        clean: matched.length,
        missingFromDb: inXlsOnly.length,
        extraInDb: inDbOnly.length,
        amountMismatches: amountDiffs.length,
      },
    });
  } catch (e) {
    console.error('validate-xls error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/invoices/receivables-audit
// Returns outstanding receivables: confirmed (bank-matched but not yet PAID in DB) vs unverified.
router.get('/receivables-audit', auth, async (req, res) => {
  try {
    const outstanding = await prisma.invoice.findMany({
      where: { status: { in: ['PENDING', 'OVERDUE'] } },
      include: { client: { select: { name: true } }, counterparty: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
    });

    const matchedLinks = await prisma.reconciliationLink.findMany({
      where: { linkType: 'PAYMENT_TO_INVOICE' },
      include: {
        payment: { select: { status: true } },
        targetDoc: { select: { docNumber: true } },
      },
    });
    const confirmedPaidNums = new Set(
      matchedLinks
        .filter(l => l.payment?.status === 'MATCHED' || l.payment?.status === 'PARTIAL')
        .map(l => l.targetDoc?.docNumber)
        .filter(Boolean)
    );

    const result = outstanding.map(inv => ({
      id: inv.id,
      number: inv.number,
      clientName: inv.counterparty?.name || inv.client?.name || 'Unknown',
      amountTotal: Number(inv.amountTotal || 0),
      currency: inv.currency,
      date: inv.date,
      dueDate: inv.dueDate,
      status: inv.status,
      confirmedPaid: confirmedPaidNums.has(inv.number),
    }));

    res.json({
      total: result.length,
      confirmedPaidCount: result.filter(r => r.confirmedPaid).length,
      genuinelyOutstandingCount: result.filter(r => !r.confirmedPaid).length,
      confirmedPaid: result.filter(r => r.confirmedPaid),
      genuinelyOutstanding: result.filter(r => !r.confirmedPaid),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
