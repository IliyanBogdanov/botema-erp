const { google } = require("googleapis");
const { PrismaClient } = require("@prisma/client");
require("dotenv").config();
const p = new PrismaClient();

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/api/auth/google/callback"
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

function extractOfferNumber(name) {
  const m = name.match(/1717[._](\d+)/);
  return m ? `1717.${m[1]}` : null;
}

// Returns true if the file is a client-facing offer (not an order/supplier doc)
function isClientOffer(name) {
  const lower = name.toLowerCase();
  // Skip order files, supplier invoices (CI/PI for PO), transport invoices, specifications, изписване
  if (/^order[_\s]/i.test(name)) return false;
  if (/^ci\s/i.test(name) || /^pi\s/i.test(name)) return false;
  if (/invoice for transport/i.test(name)) return false;
  if (/изписване/i.test(name)) return false;
  if (/specification/i.test(name)) return false;
  if (/^ORDER_/i.test(name)) return false;
  if (/for PO#/i.test(name)) return false;
  if (/проформа/i.test(name)) return false;
  if (/кодове/i.test(name)) return false;
  // Has 1717.XXX and looks like client name
  return extractOfferNumber(name) !== null;
}

async function main() {
  const drive = google.drive({ version: "v3", auth: oauth2 });
  const companyId = await p.company.findFirst().then(c => c?.id);

  // Get all 1717 Drive files
  let allFiles = [];
  let nextPageToken = null;
  do {
    const resp = await drive.files.list({
      q: "name contains '1717' and trashed = false",
      fields: "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)",
      pageSize: 100,
      pageToken: nextPageToken || undefined
    });
    allFiles = allFiles.concat(resp.data.files || []);
    nextPageToken = resp.data.nextPageToken;
  } while (nextPageToken);

  // Get existing DB offers
  const dbOffers = await p.bizDocument.findMany({
    where: { docType: "OFFER_OUT" },
    select: { id: true, internalRef: true, externalRef: true }
  });
  const dbByFileId = {};
  for (const o of dbOffers) {
    if (o.internalRef) dbByFileId[o.internalRef] = o;
  }

  let updated = 0, added = 0, skipped = 0;

  // Step 1: Update externalRef (offer number) for already-imported offers
  for (const file of allFiles) {
    const offerNum = extractOfferNumber(file.name);
    if (!offerNum) continue;
    const existing = dbByFileId[file.id];
    if (existing && existing.externalRef !== offerNum) {
      await p.bizDocument.update({
        where: { id: existing.id },
        data: { externalRef: offerNum }
      });
      updated++;
    }
  }
  console.log("Updated externalRef for:", updated, "existing offers");

  // Step 2: Import new client offers not yet in DB
  for (const file of allFiles) {
    if (dbByFileId[file.id]) continue; // already in DB
    if (!isClientOffer(file.name)) { skipped++; continue; }

    const offerNum = extractOfferNumber(file.name);
    const docDate = new Date(file.createdTime || file.modifiedTime || Date.now());

    // Try to find counterparty by name in filename
    // e.g. "Краси_1717.208.pdf" → "Краси", "Желязко_Антонов_1717.181.pdf" → "Желязко Антонов"
    let counterpartyId = null;
    const namePart = file.name.replace(/1717[._]\d+.*/, "")
      .replace(/оферта/gi, "").replace(/[_\-]/g, " ").trim();
    if (namePart.length > 2) {
      const words = namePart.split(/\s+/).filter(w => w.length > 1);
      if (words.length > 0) {
        const cp = await p.counterparty.findFirst({
          where: { name: { contains: words[0], mode: "insensitive" } },
          select: { id: true, name: true }
        });
        if (cp) {
          counterpartyId = cp.id;
        }
      }
    }

    await p.bizDocument.create({
      data: {
        companyId,
        docType: "OFFER_OUT",
        internalRef: file.id,
        externalRef: offerNum,
        docDate,
        counterpartyId,
        notes: file.name,
      }
    });
    added++;
    console.log("  Added:", file.name, "| offer#:", offerNum, "| counterparty:", counterpartyId ? "found" : "not found");
  }

  console.log("\nSummary: updated", updated, "| added", added, "| skipped (non-offer):", skipped);
  
  // Final count
  const total = await p.bizDocument.count({ where: { docType: "OFFER_OUT" } });
  const withNum = await p.bizDocument.count({ where: { docType: "OFFER_OUT", externalRef: { not: null } } });
  console.log("Total OFFER_OUT:", total, "| with offer number:", withNum);
}
main().catch(console.error).finally(() => p.$disconnect());
