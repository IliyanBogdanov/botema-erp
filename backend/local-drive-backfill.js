/**
 * Local Drive backfill — scans Drive folders and pushes sourceFile records to Railway DB
 * Run this locally when Railway's Drive API access has issues
 * Usage: node local-drive-backfill.js [year]
 */
require('dotenv').config();
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');

// Use Railway DATABASE_URL directly
const RAILWAY_DB_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient();

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });

const YEAR_FOLDERS = {
  2024: '1yHzB_YyiyTAQfdiQ4PLAA6btdB6TKRAA',
  2025: '1bRaKz6epxZW8I2bg-orOnEm2KYgWMZsj',
  2026: '1BnoBbHoYrEiPPgR3BeZcXIZ9RLaI6tph',
};

const ATTACHMENT_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.xml'];
function isBusinessAttachment(filename) {
  const lower = filename.toLowerCase();
  return ATTACHMENT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

async function scanFolder(folderId, currentPath, year, counters = { found: 0, saved: 0, skipped: 0 }) {
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, createdTime)',
      pageSize: 100,
      pageToken: pageToken || undefined,
    });

    for (const file of (res.data.files || [])) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        await scanFolder(file.id, `${currentPath}/${file.name}`, year, counters);
        continue;
      }

      if (!isBusinessAttachment(file.name)) continue;
      counters.found++;

      const existing = await prisma.sourceFile.findUnique({ where: { driveFileId: file.id } });
      if (existing) {
        counters.skipped++;
        continue;
      }

      await prisma.sourceFile.create({
        data: {
          type: 'DRIVE',
          driveFileId: file.id,
          driveUrl: file.webViewLink || null,
          filename: file.name,
          mimeType: file.mimeType || 'application/octet-stream',
          folder: currentPath,
          receivedAt: file.createdTime ? new Date(file.createdTime) : null,
        },
      });
      counters.saved++;
      if (counters.saved % 10 === 0 || counters.saved <= 5) {
        console.log(`  [${year}] saved ${counters.saved}, skipped ${counters.skipped} — ${file.name}`);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
}

async function main() {
  const years = process.argv[2] ? [parseInt(process.argv[2])] : [2024, 2025];

  for (const year of years) {
    const folderId = YEAR_FOLDERS[year];
    if (!folderId) { console.log(`No folder for year ${year}`); continue; }

    console.log(`\n=== Scanning Drive/${year} (${folderId}) ===`);
    const counters = { found: 0, saved: 0, skipped: 0 };
    await scanFolder(folderId, `Drive/Root/${year}`, year, counters);
    console.log(`✓ Year ${year}: found=${counters.found}, saved=${counters.saved}, skipped(exists)=${counters.skipped}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
