/**
 * Import offers (оферти) from Google Drive into BizDocuments.
 *
 * Searches Drive for files with "оферта"/"offer" in the name or in offer folders,
 * parses offer number from filename, creates OFFER_OUT BizDocument records.
 *
 * Usage: node scripts/importOffersFromDrive.js [--dry-run] [--limit=200]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 500;

const MIN_OFFER_NUM = 1717;

function getGoogleAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

// Extract offer number from filename
function extractOfferNumber(filename) {
  const name = filename.replace(/\.[^.]+$/, '');

  // Pattern: "Оферта 1717.1" or "offer 1718.2" or "1719.3 оферта"
  const m1 = name.match(/(?:оферт[аи]|offer)[_\s\-#]*(\d{3,}(?:[._]\d+)?)/i);
  if (m1) return m1[1].replace('_', '.');

  const m2 = name.match(/(\d{4,}(?:[._]\d+)?)[_\s\-]*(?:оферт[аи]|offer)/i);
  if (m2) return m2[1].replace('_', '.');

  // Just 4+ digit number
  const m3 = name.match(/\b(\d{4,}(?:[._]\d+)?)\b/);
  if (m3) return m3[1].replace('_', '.');

  return null;
}

function offerNumValue(str) {
  return parseFloat(String(str || '0').replace(',', '.')) || 0;
}

// Extract date from filename (DD.MM.YYYY or YYYY-MM-DD patterns)
function extractDateFromFilename(name) {
  const m1 = name.match(/(\d{1,2})[._](\d{1,2})[._](\d{4})/);
  if (m1) return new Date(`${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}T00:00:00.000Z`);
  const m2 = name.match(/(20\d{2})[._\-](\d{1,2})[._\-](\d{1,2})/);
  if (m2) return new Date(`${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}T00:00:00.000Z`);
  return null;
}

async function findCounterpartyFromPath(folderName, filename) {
  const text = (folderName + ' ' + filename).replace(/оферт[аи]|offer|\d/gi, ' ').trim();
  const words = text.split(/[\s_\-\.]+/).filter(w => w.length > 3);
  for (const word of words) {
    const c = await prisma.counterparty.findFirst({
      where: { name: { contains: word, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (c) return c;
  }
  return null;
}

async function getParentFolderName(drive, parentId) {
  if (!parentId) return '';
  try {
    const res = await drive.files.get({ fileId: parentId, fields: 'name' });
    return res.data.name || '';
  } catch {
    return '';
  }
}

async function main() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    console.error('❌ GOOGLE_REFRESH_TOKEN not set in .env');
    process.exit(1);
  }

  const auth = getGoogleAuth();
  const drive = google.drive({ version: 'v3', auth });

  console.log('🔍 Searching Google Drive for offer files...');

  // Search queries for Drive
  const driveQueries = [
    "name contains 'оферт' and trashed = false",
    "name contains 'offer' and trashed = false",
    "name contains 'Offer' and trashed = false",
  ];

  const allFiles = new Map(); // fileId → file metadata

  for (const q of driveQueries) {
    let pageToken;
    do {
      const res = await drive.files.list({
        q,
        fields: 'nextPageToken, files(id, name, createdTime, modifiedTime, parents, mimeType, webViewLink)',
        pageSize: 100,
        pageToken,
      });
      for (const f of (res.data.files || [])) {
        allFiles.set(f.id, f);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken && allFiles.size < LIMIT * 2);
  }

  console.log(`📁 Found ${allFiles.size} candidate files in Drive`);

  // Get already-imported offers
  const existingOffers = await prisma.bizDocument.findMany({
    where: { docType: 'OFFER_OUT' },
    select: { docNumber: true, notes: true },
  });
  const existingNums = new Set(existingOffers.map(o => o.docNumber).filter(Boolean));
  const existingDriveIds = new Set(
    existingOffers
      .map(o => { const m = (o.notes || '').match(/drive:([a-zA-Z0-9_\-]+)/); return m?.[1]; })
      .filter(Boolean)
  );

  let imported = 0;
  let skipped = 0;

  for (const [fileId, file] of allFiles) {
    if (existingDriveIds.has(fileId)) { skipped++; continue; }

    const filename = file.name || '';
    const offerNum = extractOfferNumber(filename);
    const numVal = offerNumValue(offerNum);

    // Skip files with number below minimum
    if (offerNum && numVal > 0 && numVal < MIN_OFFER_NUM) {
      skipped++;
      continue;
    }

    // Skip duplicate by number
    if (offerNum && existingNums.has(offerNum)) { skipped++; continue; }

    // Skip folders
    if (file.mimeType === 'application/vnd.google-apps.folder') continue;

    // Get parent folder name for context
    const parentId = file.parents?.[0];
    const folderName = parentId ? await getParentFolderName(drive, parentId) : '';

    const rawDate = extractDateFromFilename(filename)
      || (file.createdTime ? new Date(file.createdTime) : null);
    const docDate = rawDate instanceof Date && !isNaN(rawDate.getTime()) ? rawDate : null;

    const client = await findCounterpartyFromPath(folderName, filename);

    console.log(`  📄 ${filename.substring(0, 60)} | offer#: ${offerNum || '?'} | folder: ${folderName.substring(0, 30)}`);

    if (!DRY_RUN) {
      await prisma.bizDocument.create({
        data: {
          docType: 'OFFER_OUT',
          docNumber: offerNum || null,
          docDate,
          status: 'REVIEWED',
          counterpartyId: client?.id || null,
          internalRef: fileId,
          notes: `Drive: ${filename} | folder: ${folderName} | drive:${fileId}`,
          confidence: offerNum ? 75 : 45,
        },
      });
      if (offerNum) existingNums.add(offerNum);
    }

    imported++;
  }

  console.log(`\n✅ Done:`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped: ${skipped}`);

  if (!DRY_RUN) {
    const total = await prisma.bizDocument.count({ where: { docType: 'OFFER_OUT' } });
    console.log(`📊 Total OFFER_OUT in DB: ${total}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
