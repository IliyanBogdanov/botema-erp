/**
 * aiEnrichCounterparties.js
 *
 * Uses rule-based + Gemini 2.5 Flash to:
 *  1. Classify each counterparty as individual (isIndividual=true) or company
 *  2. Re-classify type from OTHER → CLIENT/SUPPLIER based on biz-doc history
 *  3. Set EIK/VAT from bank transfer notes or doc references
 *  4. Set logoUrl via Clearbit for companies with known websites
 *  5. Set website guess from name + existing data
 *
 * Run: node scripts/aiEnrichCounterparties.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const p = new PrismaClient();
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

// ── helpers ──────────────────────────────────────────────────────────────────

const COMPANY_SUFFIXES = [
  'ЕООД', 'ООД', ' АД', ' ЕАД', ' ЕТ', ' КД', ' СД',
  ' LTD', ' LLC', ' INC', ' GMBH', ' SARL', ' SRL', ' S.R.L',
  ' SP. Z O.O.', ' S.A.', ' A.S.', ' OY', ' AB', ' BV', ' NV',
  ' EOOD', ' OOD',
];

function looksLikeIndividual(name) {
  const upper = name.toUpperCase().trim();

  // Check company suffix first — any suffix = definitely NOT individual
  const hasCompanySuffix = COMPANY_SUFFIXES.some(s => upper.includes(s.toUpperCase().trim()));
  if (hasCompanySuffix) return false;

  const words = upper.split(/\s+/);

  // 3 words ALL_CAPS Bulgarian name pattern (e.g. ИЛИЯН ТРИФОНОВ БОГДАНОВ)
  if (
    words.length === 3 &&
    words.every(w => /^[А-ЯA-ZА-Яа-яa-z]{2,}$/.test(w))
  ) {
    return true;
  }

  // 2-3 word capitalized foreign name (e.g. "John Smith", "Maria Van Berg")
  if (
    words.length >= 2 && words.length <= 3 &&
    words.every(w => /^[A-Z][a-z]+$/.test(w))
  ) {
    return true;
  }

  return false;
}

function guessDomain(name) {
  // Try to guess a website domain from company name
  const cleaned = name
    .toLowerCase()
    .replace(/\s+(еоод|оод|ад|еад|ет|ltd|llc|inc|gmbh|srl|eood|ood)\.?/gi, '')
    .replace(/[^a-zа-я0-9\s]/gi, '')
    .trim();

  // Transliterate common BG letters
  const translit = cleaned
    .replace(/а/g, 'a').replace(/б/g, 'b').replace(/в/g, 'v')
    .replace(/г/g, 'g').replace(/д/g, 'd').replace(/е/g, 'e')
    .replace(/ж/g, 'zh').replace(/з/g, 'z').replace(/и/g, 'i')
    .replace(/й/g, 'y').replace(/к/g, 'k').replace(/л/g, 'l')
    .replace(/м/g, 'm').replace(/н/g, 'n').replace(/о/g, 'o')
    .replace(/п/g, 'p').replace(/р/g, 'r').replace(/с/g, 's')
    .replace(/т/g, 't').replace(/у/g, 'u').replace(/ф/g, 'f')
    .replace(/х/g, 'h').replace(/ц/g, 'ts').replace(/ч/g, 'ch')
    .replace(/ш/g, 'sh').replace(/щ/g, 'sht').replace(/ъ/g, 'a')
    .replace(/ь/g, '').replace(/ю/g, 'yu').replace(/я/g, 'ya')
    .replace(/\s+/g, '');

  return translit ? `${translit}.com` : null;
}

// ── classify type from history ────────────────────────────────────────────────

async function getCounterpartyHistory(id) {
  const docs = await p.bizDocument.findMany({
    where: { counterpartyId: id },
    select: { docType: true, amountTotal: true },
    take: 20,
  });
  const payments = await p.payment.findMany({
    where: { counterpartyId: id },
    select: { paymentType: true, amount: true, status: true },
    take: 10,
  });
  return { docs, payments };
}

function inferType(counterparty, docs, payments) {
  if (!['OTHER'].includes(counterparty.type)) return null; // only reclassify OTHER

  const hasInvoiceIn = docs.some(d => d.docType === 'INVOICE_IN');
  const hasOfferOut = docs.some(d => ['OFFER_OUT', 'INVOICE_OUT', 'DELIVERY_NOTE'].includes(d.docType));

  if (hasOfferOut) return 'CLIENT';
  if (hasInvoiceIn) return 'SUPPLIER';
  return null;
}

// ── AI batch for ambiguous cases ──────────────────────────────────────────────

async function aiClassifyBatch(counterparties) {
  const list = counterparties.map((c, i) =>
    `${i + 1}. "${c.name}" | type=${c.type} | country=${c.country} | eik=${c.eik || ''} | vat=${c.vat || ''} | notes=${c.notes || ''}`
  ).join('\n');

  const prompt = `You are classifying counterparties for a Bulgarian interior design company (Studio Botema).
For each entry, provide:
- isIndividual: true/false (true if this is a natural person, not a company)
- type: CLIENT | SUPPLIER | COURIER | BANK | ACCOUNTING | OTHER
- eik: Bulgarian company registration number if you can infer it (9 digits), or empty
- vat: Bulgarian VAT number (BG + 9 digits) if you can infer it, or empty
- website: company website domain if known (e.g. ikea.com), or empty

Known context: The company imports furniture/lighting from EU (Italy, Germany, Poland). It sells to Bulgarian clients.
Common suppliers: IKEA, Кайли ЕООД, Омега Лайт, Доро Транс, etc.
Common individual names are 3-word Bulgarian ALL_CAPS names.

Counterparties:
${list}

Reply ONLY with JSON array, one object per counterparty in same order:
[{"isIndividual":false,"type":"SUPPLIER","eik":"","vat":"","website":"example.com"}, ...]`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('  AI batch error:', e.message);
    return null;
  }
}

// ── extract EIK/VAT from bank notes ──────────────────────────────────────────

async function extractEikFromPayments(counterpartyId) {
  const payments = await p.payment.findMany({
    where: { counterpartyId },
    select: { notes: true, reference: true },
  });

  const allText = payments.map(pay => `${pay.notes || ''} ${pay.reference || ''}`).join(' ');
  // BG EIK: 9 digits
  const eikMatch = allText.match(/\b(\d{9})\b/);
  // BG VAT: BG followed by 9-10 digits
  const vatMatch = allText.match(/\bBG(\d{9,10})\b/i);

  return {
    eik: eikMatch ? eikMatch[1] : null,
    vat: vatMatch ? `BG${vatMatch[1]}` : null,
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Counterparty Enrichment Pass ===\n');

  const counterparties = await p.counterparty.findMany({
    orderBy: { name: 'asc' },
  });

  console.log(`Found ${counterparties.length} counterparties\n`);

  let updated = 0;
  let aiNeeded = [];

  // ── Pass 0: Fix any wrongly-marked individuals (companies flagged as persons) ─
  const wrongIndividuals = await p.counterparty.findMany({
    where: { isIndividual: true },
  });
  let fixed = 0;
  for (const cp of wrongIndividuals) {
    if (!looksLikeIndividual(cp.name)) {
      await p.counterparty.update({ where: { id: cp.id }, data: { isIndividual: false } });
      fixed++;
      console.log(`  ✗ [fix] ${cp.name}: isIndividual=false (was wrong)`);
    }
  }
  if (fixed > 0) console.log(`Fixed ${fixed} wrongly-flagged individuals\n`);
  for (const cp of counterparties) {
    const updates = {};

    // Individual detection
    if (looksLikeIndividual(cp.name) && !cp.isIndividual) {
      updates.isIndividual = true;
    }

    // Reclassify OTHER
    const { docs, payments } = await getCounterpartyHistory(cp.id);
    const inferredType = inferType(cp, docs, payments);
    if (inferredType) {
      updates.type = inferredType;
    }

    // Extract EIK/VAT from payments if missing
    if (!cp.eik || !cp.vat) {
      const extracted = await extractEikFromPayments(cp.id);
      if (extracted.eik && !cp.eik) updates.eik = extracted.eik;
      if (extracted.vat && !cp.vat) updates.vat = extracted.vat;
    }

    // Logo URL for companies
    if (!updates.isIndividual && !cp.isIndividual && !cp.logoUrl) {
      const domain = cp.website || guessDomain(cp.name);
      if (domain) {
        updates.logoUrl = `https://logo.clearbit.com/${domain}`;
        if (!cp.website && domain) updates.website = domain;
      }
    }

    if (Object.keys(updates).length > 0) {
      await p.counterparty.update({ where: { id: cp.id }, data: updates });
      updated++;
      console.log(`  ✓ [rule] ${cp.name}: ${JSON.stringify(updates)}`);
    } else {
      // Queue for AI pass if type=OTHER or no classification yet
      if (cp.type === 'OTHER' || (!cp.eik && !cp.vat && !looksLikeIndividual(cp.name))) {
        aiNeeded.push(cp);
      }
    }
  }

  console.log(`\nRule-based: updated ${updated} counterparties`);
  console.log(`AI pass needed for: ${aiNeeded.length} counterparties\n`);

  // ── Pass 2: AI batch (max 50 per request) ─────────────────────────────────
  const BATCH_SIZE = 40;
  let aiUpdated = 0;

  for (let i = 0; i < aiNeeded.length; i += BATCH_SIZE) {
    const batch = aiNeeded.slice(i, i + BATCH_SIZE);
    console.log(`AI batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(aiNeeded.length / BATCH_SIZE)} (${batch.length} items)...`);

    const results = await aiClassifyBatch(batch);
    if (!results) {
      console.log('  Skipping batch due to AI error');
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const cp = batch[j];
      const ai = results[j];
      if (!ai) continue;

      const updates = {};
      if (ai.isIndividual !== undefined && ai.isIndividual !== cp.isIndividual) updates.isIndividual = ai.isIndividual;
      if (ai.type && ai.type !== cp.type && ['CLIENT', 'SUPPLIER', 'COURIER', 'BANK', 'ACCOUNTING', 'OTHER'].includes(ai.type)) {
        updates.type = ai.type;
      }
      if (ai.eik && !cp.eik) updates.eik = ai.eik;
      if (ai.vat && !cp.vat) updates.vat = ai.vat;
      if (ai.website && !cp.website) {
        updates.website = ai.website;
        if (!cp.logoUrl && !ai.isIndividual) {
          updates.logoUrl = `https://logo.clearbit.com/${ai.website}`;
        }
      }

      if (Object.keys(updates).length > 0) {
        await p.counterparty.update({ where: { id: cp.id }, data: updates });
        aiUpdated++;
        console.log(`  ✓ [AI] ${cp.name}: ${JSON.stringify(updates)}`);
      }
    }

    // Throttle
    if (i + BATCH_SIZE < aiNeeded.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`\nAI pass: updated ${aiUpdated} counterparties`);
  console.log(`\nTotal updated: ${updated + aiUpdated} / ${counterparties.length}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const stats = await p.counterparty.groupBy({ by: ['type'], _count: true });
  const individuals = await p.counterparty.count({ where: { isIndividual: true } });
  const withLogo = await p.counterparty.count({ where: { logoUrl: { not: null } } });
  const withEik = await p.counterparty.count({ where: { eik: { not: null } } });

  console.log('\n=== Final Stats ===');
  console.log(`Individuals (физ. лица): ${individuals}`);
  console.log(`With logo: ${withLogo}`);
  console.log(`With EIK: ${withEik}`);
  stats.forEach(s => console.log(`  ${s.type}: ${s._count}`));

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
