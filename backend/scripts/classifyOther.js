/**
 * classifyOther.js
 *
 * Re-examines counterparties still typed as OTHER.
 * Uses full context: doc history, payment notes, name patterns.
 * Classifies as CLIENT / SUPPLIER / COURIER / BANK / ACCOUNTING / OTHER.
 *
 * Run: node scripts/classifyOther.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const p = new PrismaClient();
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const VALID_TYPES = ['CLIENT', 'SUPPLIER', 'COURIER', 'BANK', 'ACCOUNTING', 'OTHER'];

async function buildContext(cp) {
  const [docs, payments] = await Promise.all([
    p.bizDocument.findMany({
      where: { counterpartyId: cp.id },
      select: { docType: true, docNumber: true, amountTotal: true, currency: true, notes: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    p.payment.findMany({
      where: { counterpartyId: cp.id },
      select: { paymentType: true, amount: true, reference: true, notes: true, status: true },
      orderBy: { paymentDate: 'desc' },
      take: 10,
    }),
  ]);

  const docSummary = docs.length
    ? docs.map(d => `  ${d.docType} #${d.docNumber || '?'} ${d.amountTotal || 0} ${d.currency || 'BGN'}${d.notes ? ` — "${d.notes.slice(0, 80)}"` : ''}`).join('\n')
    : '  (no documents)';

  const paymentSummary = payments.length
    ? payments.map(pm => `  ${pm.paymentType} ${pm.amount} ref="${pm.reference || ''}" notes="${pm.notes || ''}" ${pm.status}`).join('\n')
    : '  (no payments)';

  return { docSummary, paymentSummary, docTypes: [...new Set(docs.map(d => d.docType))] };
}

async function classifyBatch(batch) {
  const items = batch.map(({ cp, docSummary, paymentSummary, docTypes }) => ({
    id: cp.id,
    name: cp.name,
    isIndividual: cp.isIndividual,
    docTypes,
    docs: docSummary,
    payments: paymentSummary,
  }));

  const prompt = `
You are a Bulgarian ERP data specialist. Classify each counterparty with type: CLIENT, SUPPLIER, COURIER, BANK, ACCOUNTING, or OTHER.

Rules:
- CLIENT: issued invoices / offers TO them (INVOICE_OUT, OFFER_OUT, DELIVERY_NOTE to client)
- SUPPLIER: received invoices FROM them (INVOICE_IN, PURCHASE)
- COURIER: logistics company (Speedy, Econt, DHL, etc.)
- BANK: financial institution (bank charges, transfers)
- ACCOUNTING: accounting/bookkeeping firm
- OTHER: truly unclassifiable (individuals, misc)

For each, reply with JSON only. Array of objects: { "id": "...", "type": "...", "reason": "..." }

Counterparties:
${JSON.stringify(items, null, 2)}
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in Gemini response');
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  const others = await p.counterparty.findMany({
    where: { type: 'OTHER' },
    select: { id: true, name: true, isIndividual: true, type: true },
    orderBy: { name: 'asc' },
  });

  console.log(`Found ${others.length} OTHER counterparties to classify\n`);

  // Quick rule-based pass first
  let ruleFixed = 0;
  const stillOther = [];

  for (const cp of others) {
    const { docTypes } = await buildContext(cp);

    if (docTypes.includes('OFFER_OUT') || docTypes.includes('INVOICE_OUT') || docTypes.includes('DELIVERY_NOTE')) {
      await p.counterparty.update({ where: { id: cp.id }, data: { type: 'CLIENT' } });
      console.log(`  [RULE] CLIENT  — ${cp.name} (has ${docTypes.join(', ')})`);
      ruleFixed++;
    } else if (docTypes.includes('INVOICE_IN')) {
      await p.counterparty.update({ where: { id: cp.id }, data: { type: 'SUPPLIER' } });
      console.log(`  [RULE] SUPPLIER — ${cp.name}`);
      ruleFixed++;
    } else {
      stillOther.push(cp);
    }
  }

  console.log(`\n[RULE] Classified ${ruleFixed}. Remaining for AI: ${stillOther.length}\n`);

  if (stillOther.length === 0) {
    console.log('All classified!');
    await p.$disconnect();
    return;
  }

  // Build context for remaining
  const withContext = [];
  for (const cp of stillOther) {
    const { docSummary, paymentSummary, docTypes } = await buildContext(cp);
    withContext.push({ cp, docSummary, paymentSummary, docTypes });
    await sleep(50);
  }

  // AI pass in batches of 20
  const BATCH = 20;
  let aiFixed = 0;
  let aiOther = 0;

  for (let i = 0; i < withContext.length; i += BATCH) {
    const batch = withContext.slice(i, i + BATCH);
    console.log(`AI batch ${Math.floor(i / BATCH) + 1} (${batch.length} items)...`);

    try {
      const results = await classifyBatch(batch);

      for (const r of results) {
        const type = VALID_TYPES.includes(r.type) ? r.type : 'OTHER';
        if (type !== 'OTHER') {
          await p.counterparty.update({ where: { id: r.id }, data: { type } });
          console.log(`  [AI] ${type.padEnd(12)} — ${batch.find(b => b.cp.id === r.id)?.cp.name || r.id} (${r.reason?.slice(0, 60) || ''})`);
          aiFixed++;
        } else {
          console.log(`  [AI] OTHER (kept) — ${batch.find(b => b.cp.id === r.id)?.cp.name || r.id}`);
          aiOther++;
        }
      }
    } catch (err) {
      console.error(`  Batch error: ${err.message}`);
    }

    await sleep(1500);
  }

  console.log(`\n[AI] Reclassified: ${aiFixed}, Still OTHER: ${aiOther}`);

  // Final counts
  const counts = await p.$queryRaw`SELECT type, COUNT(*) as cnt FROM counterparties GROUP BY type ORDER BY cnt DESC`;
  console.log('\nFinal type distribution:');
  for (const row of counts) console.log(`  ${row.type}: ${row.cnt}`);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
