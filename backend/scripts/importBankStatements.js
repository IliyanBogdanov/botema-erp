/**
 * Import historical bank statements (2024, 2025, 2026) into the database.
 *
 * Usage: node scripts/importBankStatements.js [--year=2026] [--dry-run]
 *
 * Idempotent: re-running skips already-imported rows by a stable bank key.
 * Uses batch DB operations for speed.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const prisma = require('../src/lib/prisma');
const { parseBankStatementBuffer, buildBankPaymentKey } = require('../src/lib/bankStatementParser');

const BANK_STATEMENTS_DIRS = [
  path.resolve(__dirname, '../../bank statements and docs'),
  path.resolve(__dirname, '../../bank statements'),
];

function existingBankDirs() {
  return BANK_STATEMENTS_DIRS.filter(dir => fs.existsSync(dir));
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const YEAR_ARG = args.find(a => a.startsWith('--year='));
const TARGET_YEAR = YEAR_ARG ? parseInt(YEAR_ARG.split('=')[1]) : null;

/**
 * Normalize a counterparty name for deduplication.
 */
function normalizeCounterpartyName(name) {
  return (name || '').trim().replace(/\s+/g, ' ');
}

/**
 * Build a map of { normName -> id, iban -> id } from existing counterparties.
 */
async function buildCounterpartyMap() {
  const all = await prisma.counterparty.findMany({ select: { id: true, name: true, notes: true } });
  const map = new Map(); // key -> id
  for (const cp of all) {
    map.set(cp.name.toUpperCase(), cp.id);
    // Extract IBAN from notes if stored there
    const ibanMatch = cp.notes?.match(/IBAN:\s*(BG\w+)/);
    if (ibanMatch) map.set(ibanMatch[1], cp.id);
  }
  return map;
}

/**
 * Import a single CSV file using batch DB operations.
 */
async function importFile(filePath) {
  console.log(`\n📂 Processing: ${path.basename(filePath)}`);
  const buffer = fs.readFileSync(filePath);
  const { meta, rows } = parseBankStatementBuffer(buffer);
  console.log(`   Account: ${meta.iban} | Currency: ${meta.currency} | Rows: ${rows.length}`);

  // 1. Get all existing payments to skip duplicates. Bank references can repeat
  // within a statement, so include date/amount/currency/account/direction.
  const existingPayments = await prisma.payment.findMany({
    select: { paymentDate: true, reference: true, amount: true, currency: true, bankAccount: true, notes: true },
  });
  const existingKeys = new Set();
  for (const p of existingPayments) {
    const hasDirection = /\[(IN|OUT)\]/.test(p.notes || '');
    const base = {
      date: p.paymentDate,
      reference: p.reference,
      amount: p.amount,
      currency: p.currency,
    };
    if (hasDirection) {
      existingKeys.add(buildBankPaymentKey({ ...base, isOutgoing: /\[OUT\]/.test(p.notes || '') }, p.bankAccount));
    } else {
      existingKeys.add(buildBankPaymentKey({ ...base, isOutgoing: false }, p.bankAccount));
      existingKeys.add(buildBankPaymentKey({ ...base, isOutgoing: true }, p.bankAccount));
    }
  }

  const seenInRun = new Set();
  const newRows = [];
  let duplicateInFile = 0;
  for (const row of rows) {
    const key = buildBankPaymentKey(row, meta.iban);
    if (existingKeys.has(key) || seenInRun.has(key)) {
      if (seenInRun.has(key)) duplicateInFile++;
      continue;
    }
    seenInRun.add(key);
    newRows.push(row);
  }
  const skipped = rows.length - newRows.length;
  console.log(`   New: ${newRows.length} | Already/duplicate: ${skipped}${duplicateInFile ? ` | In-file dupes: ${duplicateInFile}` : ''}`);

  if (DRY_RUN) {
    return { created: newRows.length, skipped, errors: 0 };
  }

  if (newRows.length === 0) {
    console.log(`   ⏭  Nothing to import.`);
    return { created: 0, skipped, errors: 0 };
  }

  // 2. Build counterparty map and create missing ones
  const cpMap = await buildCounterpartyMap();

  // Collect unique counterparties to create
  const toCreate = new Map(); // normName -> row data
  for (const row of newRows) {
    if (!row.counterpartyName) continue;
    const normName = normalizeCounterpartyName(row.counterpartyName);
    const key = normName.toUpperCase();
    if (!cpMap.has(key) && !toCreate.has(key)) {
      toCreate.set(key, row);
    }
  }

  // Batch create counterparties
  if (toCreate.size > 0) {
    console.log(`   Creating ${toCreate.size} new counterparties...`);
    for (const [key, row] of toCreate.entries()) {
      try {
        const cp = await prisma.counterparty.create({
          data: {
            name: normalizeCounterpartyName(row.counterpartyName),
            type: 'OTHER',
            country: 'BG',
            currency: row.currency,
            notes: row.counterpartyIban
              ? `IBAN: ${row.counterpartyIban}${row.counterpartyBulstat ? ` | БУЛСТАТ: ${row.counterpartyBulstat}` : ''}`
              : undefined,
          },
        });
        cpMap.set(key, cp.id);
        if (row.counterpartyIban) cpMap.set(row.counterpartyIban, cp.id);
      } catch (e) {
        // Might already exist from concurrent create — try to find it
        const existing = await prisma.counterparty.findFirst({
          where: { name: { equals: normalizeCounterpartyName(row.counterpartyName), mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) cpMap.set(key, existing.id);
      }
    }
  }

  // 3. Batch create payments in chunks of 50
  const CHUNK_SIZE = 50;
  let created = 0, errors = 0;

  for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
    const chunk = newRows.slice(i, i + CHUNK_SIZE);
    const data = chunk.map(row => {
      const normName = normalizeCounterpartyName(row.counterpartyName || '').toUpperCase();
      const counterpartyId = row.counterpartyIban
        ? (cpMap.get(row.counterpartyIban) || cpMap.get(normName) || null)
        : (cpMap.get(normName) || null);

      return {
        counterpartyId,
        paymentType: row.paymentType,
        paymentDate: row.date,
        amount: row.amount,
        currency: row.currency,
        reference: row.reference,
        bankAccount: meta.iban,
        status: 'UNMATCHED',
        notes: [
          row.isOutgoing ? '[OUT]' : '[IN]',
          row.description,
          row.isFee ? '[ТАКСА]' : null,
          row.counterpartyIban ? `IBAN: ${row.counterpartyIban}` : null,
        ].filter(Boolean).join(' | '),
      };
    });

    try {
      const result = await prisma.payment.createMany({ data, skipDuplicates: true });
      created += result.count;
      process.stdout.write(`\r   Imported: ${created}/${newRows.length}`);
    } catch (err) {
      console.error(`\n   ❌ Chunk error: ${err.message}`);
      errors += chunk.length;
    }
  }

  console.log(`\n   ✅ Created: ${created} | ⏭  Skipped: ${skipped} | ❌ Errors: ${errors}`);
  return { created, skipped, errors };
}

async function main() {
  console.log(`🏦 Bank Statement Import${DRY_RUN ? ' (DRY RUN)' : ''}`);
  const dirs = existingBankDirs();
  console.log(`   Folder: ${dirs.join(', ') || '(none)'}`);

  const files = TARGET_YEAR
    ? dirs.flatMap(dir => {
        const filename = `${TARGET_YEAR}.csv`;
        return fs.existsSync(path.join(dir, filename)) ? [{ dir, filename }] : [];
      })
    : dirs.flatMap(dir => fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.csv'))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
        .map(filename => ({ dir, filename })));
  let totalCreated = 0, totalSkipped = 0, totalErrors = 0;

  for (const file of files) {
    const filePath = path.join(file.dir, file.filename);
    if (!fs.existsSync(filePath)) {
      console.log(`\n⚠️  File not found: ${filePath}`);
      continue;
    }
    const stats = await importFile(filePath);
    totalCreated += stats.created;
    totalSkipped += stats.skipped;
    totalErrors += stats.errors;
  }

  console.log(`\n📊 TOTAL: Created=${totalCreated} | Skipped=${totalSkipped} | Errors=${totalErrors}`);
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});


