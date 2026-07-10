/**
 * 2026-07-10: Free nightly database backup (Supabase free tier has none).
 * Exports every Prisma model to gzipped JSON:
 *   - locally to backend/backups/ (keeps last 14)
 *   - to Google Drive folder "Botema ERP Backups" (keeps last 14)
 * The DB is ~26MB, so a full JSON export is fast and complete.
 * Restore: scripts/restoreDatabase.js <file> --yes-i-know (truncates + reloads).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { google } = require('googleapis');
const { Prisma, PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();
const BACKUP_DIR = path.join(__dirname, '../backups');
const KEEP = 14;
const DRIVE_FOLDER_NAME = 'Botema ERP Backups';

function getDrive() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

async function main() {
  const stamp = new Date().toISOString().slice(0, 10);
  console.log(`=== DB backup ${stamp} ===`);
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  // Export every model (DMMF lists them all — stays in sync with the schema)
  const models = Prisma.dmmf.datamodel.models.map(m => m.name);
  const dump = { exportedAt: new Date().toISOString(), models: {} };
  for (const name of models) {
    const client = prisma[name.charAt(0).toLowerCase() + name.slice(1)];
    if (!client?.findMany) continue;
    dump.models[name] = await client.findMany();
    console.log(`  ${name}: ${dump.models[name].length} rows`);
  }

  const json = JSON.stringify(dump, (k, v) => (typeof v === 'bigint' ? String(v) : v));
  const gz = zlib.gzipSync(Buffer.from(json), { level: 9 });
  const filename = `botema-backup-${stamp}.json.gz`;
  const filePath = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(filePath, gz);
  console.log(`Local: ${filePath} (${Math.round(gz.length / 1024)} KB)`);

  // Local retention
  const locals = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('botema-backup-')).sort();
  for (const old of locals.slice(0, Math.max(0, locals.length - KEEP))) {
    fs.unlinkSync(path.join(BACKUP_DIR, old));
    console.log(`Deleted old local: ${old}`);
  }

  // Offsite copy via Google Drive for Desktop (G:\ syncs automatically; the
  // OAuth token is drive.readonly so the API cannot upload)
  try {
    const gDrive = 'G:\\My Drive\\' + DRIVE_FOLDER_NAME;
    if (fs.existsSync('G:\\My Drive')) {
      if (!fs.existsSync(gDrive)) fs.mkdirSync(gDrive, { recursive: true });
      fs.writeFileSync(path.join(gDrive, filename), gz);
      console.log(`Google Drive (synced folder): ${path.join(gDrive, filename)}`);
      const remote = fs.readdirSync(gDrive).filter(f => f.startsWith('botema-backup-')).sort();
      for (const old of remote.slice(0, Math.max(0, remote.length - KEEP))) {
        fs.unlinkSync(path.join(gDrive, old));
        console.log(`Deleted old Drive copy: ${old}`);
      }
    } else {
      console.warn('G:\\My Drive not found — offsite copy skipped (local copy is safe)');
    }
  } catch (err) {
    console.error(`Offsite copy failed (local copy is safe): ${err.message}`);
  }

  console.log('=== BACKUP OK ===');
}

main().catch(e => { console.error('BACKUP FAILED:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
