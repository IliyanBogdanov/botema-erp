/**
 * Reconcile OFFER_OUT documents with counterparties.
 * Parses names from Gmail/Drive notes and fuzzy-matches against counterparties.
 *
 * Usage: node scripts/reconcileOffers.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// Load all counterparties into memory for matching
async function buildCounterpartyIndex() {
  const all = await prisma.counterparty.findMany({ select: { id: true, name: true } });
  // Build word index: word → counterparty id
  const index = new Map(); // normalized word → {id, name}
  for (const cp of all) {
    const words = cp.name
      .toLowerCase()
      .replace(/['"«»„"]/g, '')
      .split(/[\s,\-\.\/\\]+/)
      .filter(w => w.length >= 4);
    for (const word of words) {
      if (!index.has(word)) index.set(word, cp);
    }
    // Also store full normalized name
    const normalized = cp.name.toLowerCase().replace(/\s+/g, ' ').trim();
    index.set(normalized, cp);
  }
  return index;
}

// Extract meaningful name hints from the notes field
function extractNamesFromNotes(notes) {
  if (!notes) return [];
  const hints = [];

  // Gmail subject pattern: "Gmail: <subject> | from: ..."
  const subjectMatch = notes.match(/Gmail: (.+?) \| from:/);
  if (subjectMatch) {
    // Remove common prefixes
    const subj = subjectMatch[1]
      .replace(/^(Re:|Fwd:|FW:|RE:|Fwd:)\s*/gi, '')
      .replace(/^(оферта|offer|оферти|офертата)\s*/i, '')
      .trim();
    if (subj.length > 2) hints.push(subj);
  }

  // From name: "from: "Name Surname" <email>"
  const fromMatch = notes.match(/from: "?([^"<]+)"?\s*</);
  if (fromMatch) {
    hints.push(fromMatch[1].trim());
  }

  // Drive folder name
  const folderMatch = notes.match(/folder: ([^|]+)/);
  if (folderMatch) {
    hints.push(folderMatch[1].trim());
  }

  return hints.filter(h => h && h.length >= 3);
}

function findCounterparty(hints, index) {
  for (const hint of hints) {
    // Try exact match first (normalized)
    const normalized = hint.toLowerCase().replace(/\s+/g, ' ').trim();
    if (index.has(normalized)) return index.get(normalized);

    // Try word by word
    const words = hint
      .toLowerCase()
      .replace(/['"«»„"]/g, '')
      .split(/[\s,\-\.\/\\]+/)
      .filter(w => w.length >= 4);

    for (const word of words) {
      if (index.has(word)) return index.get(word);
    }
  }
  return null;
}

async function main() {
  console.log('🔗 Building counterparty index...');
  const index = await buildCounterpartyIndex();
  console.log(`   ${index.size} index entries from ${(await prisma.counterparty.count())} counterparties`);

  const unlinked = await prisma.bizDocument.findMany({
    where: { docType: 'OFFER_OUT', counterpartyId: null },
    select: { id: true, docNumber: true, notes: true, docDate: true },
  });

  console.log(`🔍 Processing ${unlinked.length} unlinked OFFER_OUT documents...`);

  let linked = 0;
  let unmatched = 0;

  for (const doc of unlinked) {
    const hints = extractNamesFromNotes(doc.notes);
    const cp = findCounterparty(hints, index);

    if (cp) {
      console.log(`  ✅ ${doc.docNumber || '(no#)'} → ${cp.name.substring(0, 40)}`);
      if (!DRY_RUN) {
        await prisma.bizDocument.update({
          where: { id: doc.id },
          data: { counterpartyId: cp.id },
        });
      }
      linked++;
    } else {
      const hint = hints[0] || '?';
      console.log(`  ❓ ${doc.docNumber || '(no#)'} → no match for: ${hint.substring(0, 50)}`);
      unmatched++;
    }
  }

  console.log(`\n✅ Done:`);
  console.log(`   Linked: ${linked}`);
  console.log(`   Unmatched: ${unmatched}`);

  if (!DRY_RUN) {
    const withCp = await prisma.bizDocument.count({ where: { docType: 'OFFER_OUT', counterpartyId: { not: null } } });
    console.log(`📊 Total OFFER_OUT with counterparty: ${withCp} / 130`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
