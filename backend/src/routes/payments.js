const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');
const { parseBankStatementBuffer, buildBankPaymentKey } = require('../lib/bankStatementParser');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Helper: normalize counterparty name ─────────────────────────────────────
function normName(name) {
  return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

async function upsertCounterparty(row) {
  const { counterpartyName, counterpartyIban, counterpartyBulstat, currency } = row;
  if (!counterpartyName && !counterpartyIban) return null;
  const nm = normName(counterpartyName);

  if (counterpartyIban && counterpartyIban.startsWith('BG')) {
    const ex = await prisma.counterparty.findFirst({ where: { notes: { contains: counterpartyIban } }, select: { id: true } });
    if (ex) return ex.id;
  }
  if (nm) {
    const ex = await prisma.counterparty.findFirst({ where: { name: { equals: nm, mode: 'insensitive' } }, select: { id: true } });
    if (ex) return ex.id;
  }
  const created = await prisma.counterparty.create({
    data: {
      name: counterpartyName?.trim() || nm || 'Unknown',
      type: 'OTHER',
      country: 'BG',
      currency,
      notes: counterpartyIban ? `IBAN: ${counterpartyIban}${counterpartyBulstat ? ` | БУЛСТАТ: ${counterpartyBulstat}` : ''}` : undefined,
    },
  });
  return created.id;
}

async function buildExistingPaymentKeys() {
  const existingPayments = await prisma.payment.findMany({
    select: { paymentDate: true, reference: true, amount: true, currency: true, bankAccount: true, notes: true },
  });
  const keys = new Set();
  for (const p of existingPayments) {
    const hasDirection = /\[(IN|OUT)\]/.test(p.notes || '');
    const base = { date: p.paymentDate, reference: p.reference, amount: p.amount, currency: p.currency };
    if (hasDirection) {
      keys.add(buildBankPaymentKey({ ...base, isOutgoing: /\[OUT\]/.test(p.notes || '') }, p.bankAccount));
    } else {
      keys.add(buildBankPaymentKey({ ...base, isOutgoing: false }, p.bankAccount));
      keys.add(buildBankPaymentKey({ ...base, isOutgoing: true }, p.bankAccount));
    }
  }
  return keys;
}

function filterNewBankRows(rows, meta, existingKeys) {
  const seen = new Set();
  const newRows = [];
  for (const row of rows) {
    if (!row.reference) continue;
    const key = buildBankPaymentKey(row, meta.iban);
    if (existingKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    newRows.push(row);
  }
  return newRows;
}

function buildPaymentData(row, meta, cpMap) {
  const key = row.counterpartyIban || normName(row.counterpartyName) || '';
  return {
    paymentDate: row.date,
    amount: row.amount,
    currency: row.currency,
    reference: row.reference,
    notes: [
      row.isOutgoing ? '[OUT]' : '[IN]',
      row.description || null,
      row.isFee ? '[ТАКСА]' : null,
      row.counterpartyIban ? `IBAN: ${row.counterpartyIban}` : null,
    ].filter(Boolean).join(' | ') || null,
    paymentType: row.paymentType,
    status: 'UNMATCHED',
    bankAccount: meta.iban,
    counterpartyId: cpMap.get(key) || null,
  };
}

// ─── GET /api/payments ────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { status, counterpartyId, year, currency, page = '1', limit = '50' } = req.query;
    const where = {};
    if (status) where.status = status;
    if (counterpartyId) where.counterpartyId = counterpartyId;
    if (currency) where.currency = currency;
    if (year) {
      const y = parseInt(year);
      where.paymentDate = { gte: new Date(`${y}-01-01`), lt: new Date(`${y + 1}-01-01`) };
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [total, payments] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        include: {
          counterparty: { select: { id: true, name: true } },
          project: { select: { id: true, code: true, name: true } },
          reconciliationLinks: {
            include: {
              targetDoc: { select: { id: true, docType: true, docNumber: true, amountTotal: true } },
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    res.json({ total, page: pageNum, limit: limitNum, data: payments });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/payments/unmatched ─────────────────────────────────────────────
router.get('/unmatched', auth, async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { status: { in: ['UNMATCHED', 'PARTIAL'] } },
      include: {
        counterparty: { select: { id: true, name: true } },
        reconciliationLinks: true,
      },
      orderBy: { paymentDate: 'desc' },
    });
    res.json(payments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/payments/:id ────────────────────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        counterparty: true,
        project: { select: { id: true, code: true, name: true } },
        reconciliationLinks: {
          include: {
            sourceDoc: { select: { id: true, docType: true, docNumber: true, amountTotal: true, status: true } },
            targetDoc: { select: { id: true, docType: true, docNumber: true, amountTotal: true, status: true } },
          },
        },
      },
    });
    if (!payment) return res.status(404).json({ error: 'Not found' });
    res.json(payment);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/payments/import-csv ───────────────────────────────────────────
router.post('/import-csv', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { meta, rows } = parseBankStatementBuffer(req.file.buffer);

    const existingKeys = await buildExistingPaymentKeys();
    const newRows = filterNewBankRows(rows, meta, existingKeys);
    if (newRows.length === 0) {
      return res.json({ created: 0, skipped: rows.length, errors: 0, currency: meta.currency });
    }

    // Collect unique counterparty IBANs/names
    const cpMap = new Map();
    for (const row of newRows) {
      const key = row.counterpartyIban || normName(row.counterpartyName) || '';
      if (key && !cpMap.has(key)) {
        cpMap.set(key, await upsertCounterparty(row));
      }
    }

    // Build payment data
    const paymentData = newRows.map(row => buildPaymentData(row, meta, cpMap));

    // Insert in chunks
    const CHUNK = 50;
    let created = 0;
    for (let i = 0; i < paymentData.length; i += CHUNK) {
      const result = await prisma.payment.createMany({
        data: paymentData.slice(i, i + CHUNK),
        skipDuplicates: true,
      });
      created += result.count;
    }

    res.json({ created, skipped: rows.length - created, errors: 0, currency: meta.currency, iban: meta.iban });
  } catch (e) {
    console.error('import-csv error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/payments/import-local ─────────────────────────────────────────
// Reads all CSV files from the bank statement export folders in the project root
// and imports them without needing a file upload.
router.post('/import-local', auth, async (req, res) => {
  const BANK_DIRS = [
    path.resolve(__dirname, '../../../bank statements and docs'),
    path.resolve(__dirname, '../../../bank statements'),
  ];
  try {
    const dirs = BANK_DIRS.filter(dir => fs.existsSync(dir));
    if (!dirs.length) {
      return res.status(404).json({ error: `Bank statements folder not found at: ${BANK_DIRS.join(', ')}` });
    }

    const csvFiles = dirs.flatMap(dir => fs.readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.csv'))
      .sort()
      .map(filename => ({ dir, filename })));
    if (csvFiles.length === 0) {
      return res.status(404).json({ error: 'No CSV files found in bank statements folder' });
    }

    const existingKeys = await buildExistingPaymentKeys();

    const results = [];

    for (const file of csvFiles) {
      const filePath = path.join(file.dir, file.filename);
      try {
        const buffer = fs.readFileSync(filePath);
        const { meta, rows } = parseBankStatementBuffer(buffer);

        const newRows = filterNewBankRows(rows, meta, existingKeys);

        if (newRows.length === 0) {
          results.push({ file: file.filename, created: 0, skipped: rows.length, currency: meta.currency, iban: meta.iban });
          continue;
        }

        // Upsert counterparties
        const cpMap = new Map();
        for (const row of newRows) {
          const key = row.counterpartyIban || normName(row.counterpartyName) || '';
          if (key && !cpMap.has(key)) {
            cpMap.set(key, await upsertCounterparty(row));
          }
        }

        const paymentData = newRows.map(row => {
          existingKeys.add(buildBankPaymentKey(row, meta.iban));
          return buildPaymentData(row, meta, cpMap);
        });

        const CHUNK = 50;
        let created = 0;
        for (let i = 0; i < paymentData.length; i += CHUNK) {
          const result = await prisma.payment.createMany({
            data: paymentData.slice(i, i + CHUNK),
            skipDuplicates: true,
          });
          created += result.count;
        }

        results.push({ file: file.filename, created, skipped: rows.length - created, currency: meta.currency, iban: meta.iban });
      } catch (fileErr) {
        results.push({ file: file.filename, error: fileErr.message });
      }
    }

    const totalCreated = results.reduce((s, r) => s + (r.created || 0), 0);
    const totalSkipped = results.reduce((s, r) => s + (r.skipped || 0), 0);

    res.json({ totalCreated, totalSkipped, files: results });
  } catch (e) {
    console.error('import-local error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
