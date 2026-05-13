/**
 * fixLogos.js
 *
 * 1. Sets correct domains for known major suppliers
 * 2. Updates logoUrl from Clearbit using corrected domains
 * 3. For counterparties with no logo, tries Clearbit with existing website
 *
 * Run: node scripts/fixLogos.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

// Known correct domains — keyed by partial name match (case-insensitive)
const KNOWN_DOMAINS = [
  // Italian / international lighting / decor
  { match: 'lodes',             domain: 'lodes.it' },
  { match: 'antrax',           domain: 'antrax.it' },
  { match: 'alpha lighting',   domain: 'alphalighting.eu' },
  { match: 'alpha-lighting',   domain: 'alphalighting.eu' },
  { match: 'contardi',         domain: 'contardilighting.com' },
  { match: 'kundalini',        domain: 'kundalini.it' },
  { match: 'davide groppi',    domain: 'davidegroppi.com' },
  { match: 'modo luce',        domain: 'modoluce.com' },
  { match: 'fontana arte',     domain: 'fontanaarte.com' },
  { match: 'baxter',           domain: 'baxter.it' },
  { match: 'molteni',          domain: 'molteni.it' },
  { match: 'cassina',          domain: 'cassina.com' },
  { match: 'flos',             domain: 'flos.com' },
  { match: 'artemide',         domain: 'artemide.com' },
  { match: 'nemo lighting',    domain: 'nemolighting.com' },
  { match: 'vibia',            domain: 'vibia.com' },
  { match: '&tradition',       domain: 'andtradition.com' },
  { match: 'louis poulsen',    domain: 'louispoulsen.com' },
  { match: 'b&b italia',       domain: 'bebitalia.com' },
  { match: 'minotti',          domain: 'minotti.com' },
  { match: 'flexform',         domain: 'flexform.it' },
  { match: 'poliform',         domain: 'poliform.it' },
  { match: 'porro',            domain: 'porro.com' },
  { match: 'kristalia',        domain: 'kristalia.it' },
  { match: 'bonaldo',          domain: 'bonaldo.it' },
  { match: 'arflex',           domain: 'arflex.it' },
  { match: 'gervasoni',        domain: 'gervasoni1882.com' },
  { match: 'ligne roset',      domain: 'ligneroset.com' },
  { match: 'roche bobois',     domain: 'roche-bobois.com' },
  // Logistics / couriers
  { match: 'speedy',           domain: 'speedy.bg' },
  { match: 'econt',            domain: 'econt.com' },
  { match: 'dhl',              domain: 'dhl.com' },
  { match: 'fedex',            domain: 'fedex.com' },
  { match: 'ups',              domain: 'ups.com' },
  // Finance / banks
  { match: 'unicredit',        domain: 'unicreditbulbank.bg' },
  { match: 'ubb',              domain: 'ubb.bg' },
  { match: 'dsk',              domain: 'dskbank.bg' },
  { match: 'fibank',           domain: 'fibank.bg' },
  { match: 'postbank',         domain: 'postbank.bg' },
  { match: 'raiffeisen',       domain: 'rbb.bg' },
  { match: 'societe generale', domain: 'sgeb.bg' },
  { match: 'revolut',          domain: 'revolut.com' },
  { match: 'wise',             domain: 'wise.com' },
  { match: 'paypal',           domain: 'paypal.com' },
  // Accounting / services
  { match: 'счетоводн',        domain: null }, // skip — no public logo
  // Cloud / tech
  { match: 'google',           domain: 'google.com' },
  { match: 'microsoft',        domain: 'microsoft.com' },
  { match: 'adobe',            domain: 'adobe.com' },
  { match: 'autodesk',         domain: 'autodesk.com' },
  { match: 'dropbox',          domain: 'dropbox.com' },
  { match: 'notion',           domain: 'notion.so' },
  { match: 'slack',            domain: 'slack.com' },
  { match: 'zoom',             domain: 'zoom.us' },
  { match: 'shopify',          domain: 'shopify.com' },
  { match: 'stripe',           domain: 'stripe.com' },
  { match: 'vercel',           domain: 'vercel.com' },
  { match: 'supabase',         domain: 'supabase.com' },
  // Bulgarian companies
  { match: 'vivacom',          domain: 'vivacom.bg' },
  { match: 'a1 ',              domain: 'a1.bg' },
  { match: 'telenor',          domain: 'yettel.bg' },
  { match: 'yettel',           domain: 'yettel.bg' },
  { match: 'nas',              domain: null },
];

function findDomain(name) {
  const lower = name.toLowerCase();
  for (const entry of KNOWN_DOMAINS) {
    if (lower.includes(entry.match)) return entry.domain;
  }
  return undefined; // undefined = no match (null = explicitly skip)
}

async function main() {
  const counterparties = await p.counterparty.findMany({
    where: { isIndividual: false },
    select: { id: true, name: true, website: true, logoUrl: true, type: true },
    orderBy: { name: 'asc' },
  });

  console.log(`Checking ${counterparties.length} companies for logo improvements...\n`);

  let updated = 0;
  let skipped = 0;

  for (const cp of counterparties) {
    const detectedDomain = findDomain(cp.name);

    let targetDomain = null;

    if (detectedDomain === null) {
      // Explicitly skipped
      skipped++;
      continue;
    } else if (detectedDomain !== undefined) {
      // Known domain override
      targetDomain = detectedDomain;
    } else if (cp.website) {
      // Use existing website
      try {
        const url = new URL(cp.website.startsWith('http') ? cp.website : `https://${cp.website}`);
        targetDomain = url.hostname.replace(/^www\./, '');
      } catch {
        targetDomain = cp.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
      }
    } else {
      skipped++;
      continue;
    }

    const newLogoUrl = `https://logo.clearbit.com/${targetDomain}`;
    const newWebsite  = `https://${targetDomain}`;

    if (cp.logoUrl === newLogoUrl && cp.website === newWebsite) {
      skipped++;
      continue;
    }

    await p.counterparty.update({
      where: { id: cp.id },
      data: {
        logoUrl: newLogoUrl,
        website: newWebsite,
      },
    });

    console.log(`  ✓ ${cp.name.padEnd(40)} → ${targetDomain}`);
    updated++;
  }

  console.log(`\nUpdated: ${updated}, Skipped: ${skipped}`);

  // Summary: how many now have logos
  const withLogo = await p.counterparty.count({ where: { logoUrl: { not: null } } });
  console.log(`Counterparties with logoUrl: ${withLogo}`);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
