/**
 * Import Botema outgoing offers from Google Drive.
 *
 * Finds files matching naming conventions:
 *   ClientName_1717.NNN.pdf       (project-based offers)
 *   Оферта_ClientName_YYMMDD.NN.pdf (date-based offers)
 *
 * Excludes orders, CI/PI docs, supplier files, internal sheets.
 * Idempotent: checks by driveFileId (internalRef) and docNumber.
 *
 * Usage: node scripts/importOffersFromDrive.js [--dry-run]
 */

require("dotenv").config();
const { google } = require("googleapis");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

function getAuth() {
  const o = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  o.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return o;
}

// Is this a Botema outgoing offer (not an order/CI/PI/internal file)?
function isBotemaOffer(filename) {
  const name = filename.toLowerCase();
  // Exclude orders to suppliers, customs invoices, transport, inquiry forms, internal Lumina sheets
  const excluded = ['order_', 'order ', 'ci ', 'ci_', 'pi ', 'pi_', 'invoice', 
    'изписване', '_кодове', 'запитване', 'луминавера', 'speedy', 'dhl',
    'pricelist', 'sale offer', 'specification_', 'transaction'];
  return !excluded.some(e => name.includes(e));
}

// Parse offer info from filename
// Formats:
//   ClientName_1717.NNN.pdf        → offerNum=1717.NNN, clientHint=ClientName
//   Оферта_ClientName_YYMMDD.NN.pdf → offerNum=YYMMDD.NN, clientHint=ClientName
//   ClientName_оферта_1717.NNN.pdf  → offerNum=1717.NNN, clientHint=ClientName
function parseOfferFilename(filename) {
  const base = filename.replace(/\.(pdf|xls|xlsx)$/i, '');
  
  // Pattern: something_1717.NNN (project-based offers)
  const m1 = base.match(/^(.+?)_(?:оферта_)?(1717\.\d+)(?:[-_].*)?$/i);
  if (m1) {
    const clientHint = m1[1].replace(/_/g, ' ').trim();
    return { offerNum: m1[2], clientHint };
  }
  
  // Pattern: Оферта_ClientName_YYMMDD.NN
  const m2 = base.match(/^(?:оферта)_(.+?)_(\d{6}\.\d+)$/i);
  if (m2) {
    const clientHint = m2[1].replace(/_/g, ' ').trim();
    return { offerNum: m2[2], clientHint };
  }
  
  // Pattern: Оферта_ClientName_YYMMDD (no sub-number)
  const m3 = base.match(/^(?:оферта)[_ ](.+?)_(\d{6})$/i);
  if (m3) {
    return { offerNum: m3[2], clientHint: m3[1].replace(/_/g, ' ') };
  }
  
  return null;
}

// Parse date from YYMMDD string
function parseYYMMDD(str) {
  const yy = str.substring(0, 2);
  const mm = str.substring(2, 4);
  const dd = str.substring(4, 6);
  const year = parseInt(yy) < 50 ? 2000 + parseInt(yy) : 1900 + parseInt(yy);
  const d = new Date(`${year}-${mm}-${dd}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

async function buildCounterpartyIndex() {
  const all = await prisma.counterparty.findMany({ select: { id: true, name: true } });
  const index = new Map();
  for (const cp of all) {
    const words = cp.name.toLowerCase().replace(/['"]/g, '').split(/[\s,\-\.\/\\]+/).filter(w => w.length >= 4);
    for (const word of words) { if (!index.has(word)) index.set(word, cp); }
    index.set(cp.name.toLowerCase().replace(/\s+/g, ' ').trim(), cp);
  }
  return index;
}

function findCounterparty(hint, index) {
  if (!hint) return null;
  const normalized = hint.toLowerCase().replace(/\s+/g, ' ').trim();
  if (index.has(normalized)) return index.get(normalized);
  const words = hint.toLowerCase().split(/[\s_\-\.]+/).filter(w => w.length >= 4);
  for (const w of words) { if (index.has(w)) return index.get(w); }
  return null;
}

async function getParentFolderName(drive, parentId) {
  if (!parentId) return "";
  try { return (await drive.files.get({ fileId: parentId, fields: "name" })).data.name || ""; }
  catch { return ""; }
}

async function main() {
  const drive = google.drive({ version: "v3", auth: getAuth() });
  const cpIndex = await buildCounterpartyIndex();

  // Get existing offer driveFileIds to avoid duplicates
  const existing = await prisma.bizDocument.findMany({
    where: { docType: "OFFER_OUT" },
    select: { docNumber: true, internalRef: true }
  });
  const existingNums = new Set(existing.map(e => e.docNumber).filter(Boolean));
  const existingDriveIds = new Set(existing.map(e => e.internalRef).filter(Boolean));

  console.log("🔍 Scanning Drive for Botema offer files...");
  
  // Fetch all files matching our known patterns
  const allFiles = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: "(name contains 'Оферта_' or name contains 'оферта_' or name contains '1717') and trashed = false and mimeType != 'application/vnd.google-apps.folder'",
      fields: "nextPageToken, files(id, name, createdTime, parents)",
      pageSize: 200,
      pageToken
    });
    allFiles.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  console.log(`📁 Total candidate files: ${allFiles.length}`);

  // Deduplicate by name (keep first occurrence)
  const seenNames = new Set();
  const uniqueFiles = [];
  for (const f of allFiles) {
    if (!seenNames.has(f.name)) { seenNames.add(f.name); uniqueFiles.push(f); }
  }
  console.log(`📁 Unique files: ${uniqueFiles.length}`);

  let imported = 0, skipped = 0, excluded = 0;

  for (const file of uniqueFiles) {
    if (existingDriveIds.has(file.id)) { skipped++; continue; }
    if (!isBotemaOffer(file.name)) { excluded++; continue; }
    
    const parsed = parseOfferFilename(file.name);
    if (!parsed) { excluded++; continue; }
    
    const { offerNum, clientHint } = parsed;
    if (existingNums.has(offerNum)) { skipped++; continue; }
    
    // Determine date
    let docDate = null;
    if (/^\d{6}/.test(offerNum)) {
      docDate = parseYYMMDD(offerNum.substring(0, 6));
    }
    if (!docDate && file.createdTime) {
      docDate = new Date(file.createdTime);
    }
    if (docDate && isNaN(docDate.getTime())) docDate = null;

    const cp = findCounterparty(clientHint, cpIndex);
    const folderName = file.parents?.[0] ? await getParentFolderName(drive, file.parents[0]) : "";

    console.log(`  ✅ ${file.name.substring(0, 55)} → #${offerNum} | ${cp?.name?.substring(0,25) || clientHint}`);

    if (!DRY_RUN) {
      await prisma.bizDocument.create({
        data: {
          docType: "OFFER_OUT",
          docNumber: offerNum,
          docDate,
          status: "REVIEWED",
          counterpartyId: cp?.id || null,
          internalRef: file.id,
          notes: `Drive: ${file.name} | folder: ${folderName} | drive:${file.id}`,
          confidence: 85,
        }
      });
      existingNums.add(offerNum);
      existingDriveIds.add(file.id);
    }
    imported++;
  }

  console.log(`\n✅ Done:`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped (duplicate): ${skipped}`);
  console.log(`   Excluded (not an offer): ${excluded}`);
  
  if (!DRY_RUN) {
    const total = await prisma.bizDocument.count({ where: { docType: "OFFER_OUT" } });
    console.log(`📊 Total OFFER_OUT in DB: ${total}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());

