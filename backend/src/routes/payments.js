const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');
const { parseBankStatementBuffer } = require('../lib/bankStatementParser');

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

    // Fetch existing references to skip duplicates
    const existingRefs = await prisma.payment.findMany({ select: { reference: true } });
    const refSet = new Set(existingRefs.map(p => p.reference));

    const newRows = rows.filter(r => !refSet.has(r.reference));
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
    const paymentData = newRows.map(row => {
      const key = row.counterpartyIban || normName(row.counterpartyName) || '';
      return {
        paymentDate: row.date,
        amount: row.amount,
        currency: row.currency,
        reference: row.reference,
        notes: row.description || null,
        paymentType: row.paymentType,
        status: 'UNMATCHED',
        bankAccount: meta.iban,
        counterpartyId: cpMap.get(key) || null,
      };
    });

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
// Reads all CSV files from the 'bank statements/' folder in the project root
// and imports them without needing a file upload.
router.post('/import-local', auth, async (req, res) => {
  const BANK_DIR = path.resolve(__dirname, '../../../bank statements');
  try {
    if (!fs.existsSync(BANK_DIR)) {
      return res.status(404).json({ error: `Bank statements folder not found at: ${BANK_DIR}` });
    }

    const csvFiles = fs.readdirSync(BANK_DIR).filter(f => f.toLowerCase().endsWith('.csv'));
    if (csvFiles.length === 0) {
      return res.status(404).json({ error: 'No CSV files found in bank statements folder' });
    }

    // Fetch all existing references once (to skip duplicates across all files)
    const existingRefs = await prisma.payment.findMany({ select: { reference: true } });
    const refSet = new Set(existingRefs.map(p => p.reference));

    const results = [];

    for (const filename of csvFiles) {
      const filePath = path.join(BANK_DIR, filename);
      try {
        const buffer = fs.readFileSync(filePath);
        const { meta, rows } = parseBankStatementBuffer(buffer);

        const newRows = rows.filter(r => r.reference && !refSet.has(r.reference));

        if (newRows.length === 0) {
          results.push({ file: filename, created: 0, skipped: rows.length, currency: meta.currency, iban: meta.iban });
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
          const key = row.counterpartyIban || normName(row.counterpartyName) || '';
          refSet.add(row.reference); // prevent cross-file duplicates
          return {
            paymentDate: row.date,
            amount: row.amount,
            currency: row.currency,
            reference: row.reference,
            notes: row.description || null,
            paymentType: row.paymentType,
            status: 'UNMATCHED',
            bankAccount: meta.iban,
            counterpartyId: cpMap.get(key) || null,
          };
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

        results.push({ file: filename, created, skipped: rows.length - created, currency: meta.currency, iban: meta.iban });
      } catch (fileErr) {
        results.push({ file: filename, error: fileErr.message });
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
