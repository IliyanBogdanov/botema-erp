/**
 * Restore a backup made by backupDatabase.js.
 * Usage: node scripts/restoreDatabase.js backups/botema-backup-YYYY-MM-DD.json.gz --yes-i-know
 * DANGER: deletes all rows in every exported table, then reloads from the file.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Prisma, PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();
const file = process.argv[2];
const CONFIRM = process.argv.includes('--yes-i-know');

async function main() {
  if (!file || !fs.existsSync(file)) { console.error('Usage: node scripts/restoreDatabase.js <backup.json.gz> --yes-i-know'); process.exit(1); }
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
  console.log(`Backup from ${dump.exportedAt}; models: ${Object.keys(dump.models).length}`);
  Object.entries(dump.models).forEach(([m, rows]) => console.log(`  ${m}: ${rows.length} rows`));
  if (!CONFIRM) { console.log('\nDRY RUN — добави --yes-i-know за реално възстановяване (ТРИЕ текущите данни!)'); return; }

  // Delete children before parents by walking models in reverse dependency order:
  // simplest robust approach — repeated passes until all deletes succeed.
  const names = Object.keys(dump.models);
  let pending = [...names];
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const next = [];
    for (const name of pending) {
      const client = prisma[name.charAt(0).toLowerCase() + name.slice(1)];
      try { await client.deleteMany(); } catch { next.push(name); }
    }
    pending = next;
  }
  if (pending.length) throw new Error('Cannot clear tables: ' + pending.join(', '));

  // Insert parents before children — repeated passes as well.
  pending = [...names];
  for (let pass = 0; pass < 6 && pending.length; pass++) {
    const next = [];
    for (const name of pending) {
      const client = prisma[name.charAt(0).toLowerCase() + name.slice(1)];
      try {
        const rows = dump.models[name];
        for (let i = 0; i < rows.length; i += 200) {
          await client.createMany({ data: rows.slice(i, i + 200), skipDuplicates: true });
        }
      } catch (e) { next.push(name); }
    }
    pending = next;
  }
  if (pending.length) throw new Error('Cannot restore tables: ' + pending.join(', '));
  console.log('=== RESTORE OK ===');
}

main().catch(e => { console.error('RESTORE FAILED:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
