/**
 * Import historical bank statements (2024, 2025, 2026) into the database.
 *
 * Usage: node scripts/importBankStatements.js [--year=2026] [--dry-run]
 *
 * Idempotent: re-running will skip already-imported rows (upsert by reference).
 * Uses batch DB operations for speed.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const prisma = require('../src/lib/prisma');
const { parseBankStatementBuffer } = require('../src/lib/bankStatementParser');

const BANK_STATEMENTS_DIR = path.resolve(__dirname, '../../bank statements');

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

  if (DRY_RUN) {
    console.log(`   ✅ (dry-run) Would create: ${rows.length}`);
    return { created: rows.length, skipped: 0, errors: 0 };
  }

  // 1. Get all existing payment references to skip duplicates
  const existingRefs = new Set(
    (await prisma.payment.findMany({ select: { reference: true } })).map(p => p.reference)
  );

  const newRows = rows.filter(r => !existingRefs.has(r.reference));
  const skipped = rows.length - newRows.length;
  console.log(`   New: ${newRows.length} | Already in DB: ${skipped}`);

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
  console.log(`   Folder: ${BANK_STATEMENTS_DIR}`);

  const years = TARGET_YEAR ? [TARGET_YEAR] : [2024, 2025, 2026];
  let totalCreated = 0, totalSkipped = 0, totalErrors = 0;

  for (const year of years) {
    const filePath = path.join(BANK_STATEMENTS_DIR, `${year}.csv`);
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


