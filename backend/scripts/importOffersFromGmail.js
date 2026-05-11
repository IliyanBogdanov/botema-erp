/**
 * Import offers (оферти) from Gmail into BizDocuments.
 *
 * Searches Gmail for emails with offer-related subjects/attachments,
 * extracts offer number, client, date and creates OFFER_OUT BizDocument records.
 *
 * Usage: node scripts/importOffersFromGmail.js [--dry-run] [--limit=50]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 200;

// Minimum offer number to consider (1717.1 format → we look for >= 1717)
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

function getHeader(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// Extract offer number from subject or filename
// Patterns: "Оферта 1717.1", "offer 1718", "оф. 1720-2", "1719.3 оферта"
function extractOfferNumber(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // Pattern: "оферта 1717.1" or "offer 1718.2"
  const m1 = t.match(/(?:оферт[аи]|offer|оф\.?)\s*[:\-]?\s*(\d{4,}(?:\.\d+)?)/i);
  if (m1) return m1[1];

  // Pattern: "1717.1 оферта"
  const m2 = t.match(/(\d{4,}(?:\.\d+)?)\s*(?:оферт[аи]|offer)/i);
  if (m2) return m2[1];

  // Pattern: just "1717.1" with 4+ digits
  const m3 = t.match(/\b(\d{4,}(?:\.\d+)?)\b/);
  if (m3) return m3[1];

  return null;
}

// Get numeric value of offer number for comparison (1717.1 → 1717.1)
function offerNumValue(str) {
  return parseFloat(str) || 0;
}

function isOfferEmail(subject, snippet) {
  const text = (subject + ' ' + snippet).toLowerCase();
  return text.includes('оферт') || text.includes('offer') || text.includes('quotation');
}

async function findCounterpartyByName(name) {
  if (!name) return null;
  return prisma.counterparty.findFirst({
    where: { name: { contains: name.substring(0, 20), mode: 'insensitive' } },
    select: { id: true },
  });
}

async function main() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    console.error('❌ GOOGLE_REFRESH_TOKEN not set in .env');
    process.exit(1);
  }

  const auth = getGoogleAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  console.log('🔍 Searching Gmail for offer emails...');

  // Search queries
  const queries = [
    'subject:оферта',
    'subject:offer',
    'subject:quotation',
    'оферта has:attachment',
    'offer has:attachment filename:pdf',
  ];

  const allMessageIds = new Set();

  for (const q of queries) {
    let pageToken;
    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: 100,
        pageToken,
      });
      for (const m of (res.data.messages || [])) allMessageIds.add(m.id);
      pageToken = res.data.nextPageToken;
    } while (pageToken && allMessageIds.size < LIMIT * 2);
  }

  console.log(`📧 Found ${allMessageIds.size} candidate emails`);

  // Get already-imported offer bizDocuments (by gmailMsgId in notes)
  const existingOffers = await prisma.bizDocument.findMany({
    where: { docType: 'OFFER_OUT' },
    select: { docNumber: true, notes: true },
  });
  const existingNums = new Set(existingOffers.map(o => o.docNumber).filter(Boolean));
  const existingGmailIds = new Set(
    existingOffers
      .map(o => { const m = (o.notes || '').match(/gmail:([a-z0-9]+)/i); return m?.[1]; })
      .filter(Boolean)
  );

  let imported = 0;
  let skipped = 0;
  let notOffer = 0;

  const msgIds = [...allMessageIds].slice(0, LIMIT);

  for (const msgId of msgIds) {
    if (existingGmailIds.has(msgId)) { skipped++; continue; }

    const full = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'] });
    const headers = full.data.payload?.headers || [];
    const subject = getHeader(headers, 'Subject') || '';
    const from    = getHeader(headers, 'From')    || '';
    const dateStr = getHeader(headers, 'Date')    || '';
    const snippet = full.data.snippet || '';

    if (!isOfferEmail(subject, snippet)) { notOffer++; continue; }

    const offerNum = extractOfferNumber(subject) || extractOfferNumber(snippet);
    const numVal = offerNumValue(offerNum);

    // Filter: only offers with number >= MIN_OFFER_NUM (1717)
    if (offerNum && numVal > 0 && numVal < MIN_OFFER_NUM) {
      skipped++;
      continue;
    }

    // Check duplicate by number
    if (offerNum && existingNums.has(offerNum)) { skipped++; continue; }

    const msgDate = dateStr ? new Date(dateStr) : new Date();

    // Try to extract client name from From header
    const fromNameMatch = from.match(/^"?([^"<]+)"?\s*</);
    const fromName = fromNameMatch?.[1]?.trim() || null;
    const counterparty = fromName ? await findCounterpartyByName(fromName) : null;

    console.log(`  📨 ${subject.substring(0, 60)} | offer#: ${offerNum || '?'} | from: ${fromName || from.substring(0, 30)}`);

    if (!DRY_RUN) {
      await prisma.bizDocument.create({
        data: {
          docType: 'OFFER_OUT',
          docNumber: offerNum || null,
          docDate: msgDate,
          status: 'REVIEWED',
          counterpartyId: counterparty?.id || null,
          notes: `Gmail: ${subject} | from: ${from} | gmail:${msgId}`,
          confidence: offerNum ? 70 : 40,
        },
      });
      if (offerNum) existingNums.add(offerNum);
    }

    imported++;
  }

  console.log(`\n✅ Done:`);
  console.log(`   Imported: ${imported}`);
  console.log(`   Skipped (duplicate/low num): ${skipped}`);
  console.log(`   Not offer emails: ${notOffer}`);

  if (!DRY_RUN) {
    const total = await prisma.bizDocument.count({ where: { docType: 'OFFER_OUT' } });
    console.log(`📊 Total OFFER_OUT in DB: ${total}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
