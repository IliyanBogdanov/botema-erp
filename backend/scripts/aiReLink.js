/**
 * aiReLink.js — AI-powered comprehensive BizDocument re-linking pass
 *
 * 1. Heuristic pass: run all rule-based linking (INVOICE_IN→Purchase, INVOICE_OUT→Invoice,
 *    OFFER_OUT→Project, DELIVERY_NOTE→Purchase, BizDoc↔BizDoc by docNumber)
 * 2. AI pass: for remaining unlinked IMPORTED docs, ask Gemini to find best match
 *    from candidate pool (counterparty / amount / docNumber hints)
 * 3. BizDoc↔BizDoc cross-linking: link INVOICE_IN to DELIVERY_NOTE by same counterparty+period
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const EUR_BGN = 1.95583;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toBGN(amount, currency) {
  const a = parseFloat(amount) || 0;
  return currency === 'EUR' ? a * EUR_BGN : a;
}

function normalize(name = '') {
  return name.toLowerCase()
    .replace(/\b(еоод|оод|ад|ет|ltd|gmbh|s\.r\.l\.?|spa|s\.p\.a\.?|inc|llc|co)\b/gi, '')
    .replace(/[^\w\s\u0400-\u04ff]/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameSim(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const common = [...wa].filter(w => wb.has(w)).length;
  const total = new Set([...wa, ...wb]).size;
  return total > 0 ? common / total : 0;
}

function amtMatch(a, b, tol = 0.05) {
  if (!a || !b || a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}

async function hasLink(docId) {
  const lnk = await prisma.reconciliationLink.findFirst({
    where: { OR: [{ sourceDocId: docId }, { targetDocId: docId }] },
  });
  return !!lnk;
}

async function createLink(sourceDocId, targetDocId, linkType, confidence, notes) {
  // Avoid dupes
  const existing = await prisma.reconciliationLink.findFirst({
    where: { sourceDocId, targetDocId },
  });
  if (existing) return false;
  await prisma.reconciliationLink.create({
    data: { sourceDocId, targetDocId, linkType, confidence, notes },
  });
  return true;
}

const VALID_LINK_TYPES = new Set([
  'PAYMENT_TO_INVOICE', 'INVOICE_TO_DELIVERY', 'DELIVERY_TO_ORDER',
  'ORDER_TO_PROJECT', 'DOCUMENT_TO_SOURCE', 'EMAIL_TO_DOCUMENT', 'PARTIAL_MATCH',
]);

function safeLinkType(t) {
  if (VALID_LINK_TYPES.has(t)) return t;
  return 'DOCUMENT_TO_SOURCE';
}

async function heuristicInvoiceInToPurchase() {
  console.log('\n[H1] INVOICE_IN → Purchase (heuristic)...');
  const docs = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { in: ['IMPORTED', 'NEEDS_REVIEW'] }, counterpartyId: { not: null } },
    include: { counterparty: { select: { name: true } } },
  });
  const purchases = await prisma.purchase.findMany({ include: { supplier: { select: { name: true } } } });

  let linked = 0;
  for (const doc of docs) {
    if (await hasLink(doc.id)) continue;
    const docBGN = toBGN(doc.amountTotal, doc.currency);
    if (!docBGN) continue;

    let best = null, bestSim = 0;
    for (const pur of purchases) {
      const purBGN = toBGN(pur.amount || pur.totalAmount, pur.currency);
      if (!amtMatch(docBGN, purBGN)) continue;
      const sim = nameSim(doc.counterparty?.name, pur.supplier?.name);
      if (sim >= 0.65 && sim > bestSim) { best = pur; bestSim = sim; }
    }
    if (best) {
      await prisma.reconciliationLink.create({
        data: {
          targetDocId: doc.id,
          linkType: 'DOCUMENT_TO_SOURCE',
          confidence: Math.min(bestSim, 0.92),
          notes: `heuristic: INVOICE_IN #${doc.docNumber} ↔ Purchase ${best.id} (${best.supplier?.name?.substring(0, 25)})`,
        },
      });
      await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
      linked++;
    }
  }
  console.log(`  → linked: ${linked}`);
  return linked;
}

// ─── Step 2: Heuristic INVOICE_OUT → Invoice ─────────────────────────────────

async function heuristicInvoiceOutToInvoice() {
  console.log('\n[H2] INVOICE_OUT → Invoice (heuristic)...');
  const docs = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_OUT', docNumber: { not: null }, status: { notIn: ['MATCHED', 'REJECTED'] } },
  });
  const invoices = await prisma.invoice.findMany({
    select: { id: true, number: true, amountTotal: true, currency: true, client: { select: { name: true } } },
  });
  const invByNum = {};
  for (const inv of invoices) invByNum[String(inv.number)] = inv;

  let linked = 0;
  for (const doc of docs) {
    if (await hasLink(doc.id)) continue;
    const inv = invByNum[String(doc.docNumber)];
    if (inv) {
      await prisma.reconciliationLink.create({
        data: {
          sourceDocId: doc.id,
          linkType: 'DOCUMENT_TO_SOURCE',
          confidence: 1.0,
          notes: `heuristic: INVOICE_OUT #${doc.docNumber} ↔ Invoice #${inv.number}`,
        },
      });
      await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
      linked++;
    }
  }
  console.log(`  → linked: ${linked}`);
  return linked;
}

// ─── Step 3: Heuristic OFFER_OUT → Project ───────────────────────────────────

async function heuristicOfferToProject() {
  console.log('\n[H3] OFFER_OUT → Project (heuristic)...');
  const offers = await prisma.bizDocument.findMany({
    where: { docType: 'OFFER_OUT', counterpartyId: { not: null }, status: { notIn: ['MATCHED', 'REJECTED'] } },
    include: { counterparty: { select: { name: true } } },
  });
  const projects = await prisma.project.findMany({ include: { client: { select: { name: true } } } });

  let linked = 0;
  for (const offer of offers) {
    if (await hasLink(offer.id)) continue;
    let best = null, bestSim = 0;
    for (const proj of projects) {
      const sim = nameSim(offer.counterparty?.name, proj.client?.name);
      if (sim >= 0.7 && sim > bestSim) { best = proj; bestSim = sim; }
    }
    if (best) {
      await prisma.reconciliationLink.create({
        data: {
          sourceDocId: offer.id,
          linkType: 'ORDER_TO_PROJECT',
          confidence: bestSim,
          notes: `heuristic: OFFER_OUT #${offer.docNumber} ↔ Project ${best.code || best.id} (${best.client?.name?.substring(0, 20)})`,
        },
      });
      await prisma.bizDocument.update({ where: { id: offer.id }, data: { status: 'MATCHED' } });
      linked++;
    }
  }
  console.log(`  → linked: ${linked}`);
  return linked;
}

// ─── Step 4: Heuristic BizDoc INVOICE_IN ↔ INVOICE_IN cross-link ─────────────
// (same counterparty, close amounts → partial match)

async function heuristicBizDocCrossLink() {
  console.log('\n[H4] BizDoc↔BizDoc cross-link (same counterparty, close amounts)...');
  const invoices = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', counterpartyId: { not: null }, status: { notIn: ['MATCHED', 'REJECTED'] } },
    include: { counterparty: { select: { id: true, name: true } } },
  });

  // Group by counterpartyId
  const byCounterparty = {};
  for (const doc of invoices) {
    const key = doc.counterpartyId;
    if (!byCounterparty[key]) byCounterparty[key] = [];
    byCounterparty[key].push(doc);
  }

  let linked = 0;
  for (const [, group] of Object.entries(byCounterparty)) {
    if (group.length < 2) continue;
    // Find pairs with matching amounts — link as PARTIAL_MATCH
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const aBGN = toBGN(a.amountTotal, a.currency);
        const bBGN = toBGN(b.amountTotal, b.currency);
        if (!aBGN || !bBGN) continue;
        if (!amtMatch(aBGN, bBGN, 0.02)) continue;
        if ((await hasLink(a.id)) || (await hasLink(b.id))) continue;

        const created = await createLink(a.id, b.id, 'PARTIAL_MATCH', 0.75,
          `cross: INVOICE_IN #${a.docNumber} ↔ INVOICE_IN #${b.docNumber} same counterparty+amount`);
        if (created) {
          await prisma.bizDocument.update({ where: { id: a.id }, data: { status: 'MATCHED' } });
          await prisma.bizDocument.update({ where: { id: b.id }, data: { status: 'MATCHED' } });
          linked++;
        }
      }
    }
  }
  console.log(`  → cross-linked: ${linked} pairs`);
  return linked;
}

// ─── Step 5: AI pass for remaining IMPORTED/NEEDS_REVIEW ─────────────────────

async function aiLinkDoc(doc, candidates) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const candidateLines = candidates.map((c, i) =>
    `${i + 1}. id=${c.id} type=${c.type} label="${c.label}" amount=${c.amount} date=${c.date}`
  ).join('\n');

  const prompt = `You are a financial document matching assistant for Studio Botema (Bulgarian interior design company).

SOURCE DOCUMENT:
- id: ${doc.id}
- type: ${doc.docType}
- docNumber: ${doc.docNumber || 'unknown'}
- counterparty: ${doc.counterparty?.name || 'unknown'}
- amount: ${doc.amountTotal} ${doc.currency || 'BGN'}
- date: ${doc.docDate || 'unknown'}
- notes: ${(doc.notes || '').substring(0, 150)}

CANDIDATES TO MATCH AGAINST:
${candidateLines || 'none'}

Task: Which candidate (if any) is the best match for this source document?
Match criteria: same counterparty name, similar amount (±5%), related document type.

Return ONLY valid JSON:
{
  "matchIndex": <1-based index or 0 if no match>,
  "confidence": <0.0-1.0>,
  "linkType": "INVOICE_TO_DELIVERY" | "ORDER_TO_PROJECT" | "DOCUMENT_TO_SOURCE" | "PARTIAL_MATCH" | "DELIVERY_TO_ORDER",
  "reason": "<brief reason in English>"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('No JSON');
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.matchIndex > 0 && parsed.matchIndex <= candidates.length) {
      return { candidate: candidates[parsed.matchIndex - 1], confidence: parsed.confidence, linkType: parsed.linkType, reason: parsed.reason };
    }
    return null;
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted')) {
      console.log('    ⏳ Rate limit, waiting 60s...');
      await new Promise(r => setTimeout(r, 60000));
      return aiLinkDoc(doc, candidates);
    }
    console.warn(`    ⚠️  AI error (${doc.id}): ${err.message?.substring(0, 80)}`);
    return null;
  }
}

async function aiLinkingPass() {
  console.log('\n[AI] AI linking pass for remaining unlinked docs...');

  // Get unlinked IMPORTED/NEEDS_REVIEW docs
  const allDocs = await prisma.bizDocument.findMany({
    where: { status: { in: ['IMPORTED', 'NEEDS_REVIEW'] } },
    include: { counterparty: { select: { id: true, name: true } } },
  });

  const unlinked = [];
  for (const doc of allDocs) {
    if (!(await hasLink(doc.id))) unlinked.push(doc);
  }

  console.log(`  Found ${unlinked.length} unlinked docs to process`);

  if (unlinked.length === 0) {
    console.log('  Nothing to process.');
    return 0;
  }

  // Load candidate pools
  const [purchases, invoices, projects, otherDocs] = await Promise.all([
    prisma.purchase.findMany({ include: { supplier: { select: { name: true } } }, take: 300 }),
    prisma.invoice.findMany({ select: { id: true, number: true, amountTotal: true, currency: true, client: { select: { name: true } } }, take: 300 }),
    prisma.project.findMany({ include: { client: { select: { name: true } } }, take: 100 }),
    prisma.bizDocument.findMany({ where: { status: 'MATCHED' }, select: { id: true, docType: true, docNumber: true, amountTotal: true, currency: true, docDate: true, counterparty: { select: { name: true } } }, take: 300 }),
  ]);

  let linked = 0;

  for (const doc of unlinked) {
    // Build relevant candidates based on doc type
    const candidates = [];

    if (doc.docType === 'INVOICE_IN') {
      // Purchases by same counterparty first
      const filtered = purchases
        .filter(p => nameSim(doc.counterparty?.name, p.supplier?.name) >= 0.4)
        .slice(0, 10);
      for (const p of filtered) {
        candidates.push({ id: p.id, type: 'Purchase', label: p.supplier?.name || '', amount: `${p.amount || p.totalAmount} ${p.currency || 'BGN'}`, date: p.date });
      }
      // Also matched BizDocs same counterparty
      const matchedSame = otherDocs.filter(d => nameSim(doc.counterparty?.name, d.counterparty?.name) >= 0.6).slice(0, 5);
      for (const d of matchedSame) {
        candidates.push({ id: d.id, type: `BizDoc-${d.docType}`, label: d.counterparty?.name || '', amount: `${d.amountTotal} ${d.currency || 'BGN'}`, date: d.docDate });
      }
    } else if (doc.docType === 'INVOICE_OUT') {
      const filtered = invoices.filter(inv => nameSim(doc.counterparty?.name, inv.client?.name) >= 0.4).slice(0, 10);
      for (const inv of filtered) {
        candidates.push({ id: inv.id, type: 'Invoice', label: `#${inv.number} ${inv.client?.name || ''}`, amount: `${inv.amountTotal} ${inv.currency || 'BGN'}`, date: null });
      }
    } else if (doc.docType === 'OFFER_OUT') {
      const filtered = projects.filter(p => nameSim(doc.counterparty?.name, p.client?.name) >= 0.4).slice(0, 10);
      for (const p of filtered) {
        candidates.push({ id: p.id, type: 'Project', label: `${p.code || ''} ${p.client?.name || ''}`, amount: null, date: null });
      }
    } else {
      // DELIVERY_NOTE, PROTOCOL, OTHER — match against purchases or matched BizDocs
      const matchedSame = otherDocs.filter(d => nameSim(doc.counterparty?.name, d.counterparty?.name) >= 0.5).slice(0, 8);
      for (const d of matchedSame) {
        candidates.push({ id: d.id, type: `BizDoc-${d.docType}`, label: d.counterparty?.name || '', amount: `${d.amountTotal} ${d.currency || 'BGN'}`, date: d.docDate });
      }
    }

    if (candidates.length === 0) {
      console.log(`  ⏭  ${doc.docType} #${doc.docNumber || doc.id.slice(0, 8)} — no candidates, skipping`);
      continue;
    }

    const match = await aiLinkDoc(doc, candidates);

    if (match && match.confidence >= 0.6) {
      // Determine which field to use (sourceDocId vs targetDocId depends on direction)
      let sourceDocId = doc.id;
      let targetDocId = match.candidate.id;

      // For BizDoc→BizDoc links, use sourceDocId + targetDocId
      // For BizDoc→Purchase/Invoice/Project, use only one side (DB schema allows nulls)
      const isBizDocTarget = match.candidate.type.startsWith('BizDoc-');

      if (isBizDocTarget) {
        const created = await createLink(sourceDocId, targetDocId, safeLinkType(match.linkType), match.confidence,
          `AI: ${doc.docType} #${doc.docNumber} ↔ ${match.candidate.type} #${match.candidate.id.slice(0, 8)} — ${match.reason}`);
        if (created) {
          await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
          linked++;
          console.log(`  ✅ [AI] ${doc.docType} #${doc.docNumber} → ${match.candidate.type} (${match.confidence.toFixed(2)}) — ${match.reason}`);
        }
      } else {
        // Link to external entity (Purchase/Invoice/Project) via one-sided link
        await prisma.reconciliationLink.create({
          data: {
            sourceDocId: doc.id,
            linkType: safeLinkType(match.linkType),
            confidence: match.confidence,
            notes: `AI: ${doc.docType} #${doc.docNumber} → ${match.candidate.type} ${match.candidate.id.slice(0, 8)} (${match.candidate.label}) — ${match.reason}`,
          },
        });
        await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
        linked++;
        console.log(`  ✅ [AI] ${doc.docType} #${doc.docNumber} → ${match.candidate.type} (${match.confidence.toFixed(2)}) — ${match.reason}`);
      }
    } else {
      console.log(`  ⚠  ${doc.docType} #${doc.docNumber || doc.id.slice(0, 8)} — ${match ? `low confidence ${match.confidence.toFixed(2)}` : 'no match'}`);
      // Mark docs with no match as REVIEWED so they don't clog the queue
      if (!match) {
        await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'REVIEWED' } });
      }
    }

    // Throttle: 500ms between AI calls to stay within rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[AI] AI linked: ${linked}`);
  return linked;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  aiReLink.js — Comprehensive BizDoc Re-Linking');
  console.log('═══════════════════════════════════════════════════');

  const before = await prisma.bizDocument.groupBy({ by: ['status'], _count: true });
  const linksBefore = await prisma.reconciliationLink.count();

  console.log('\nBefore:');
  before.forEach(r => console.log(`  ${r.status}: ${r._count}`));
  console.log(`  ReconciliationLinks: ${linksBefore}`);

  // Heuristic passes
  const h1 = await heuristicInvoiceInToPurchase();
  const h2 = await heuristicInvoiceOutToInvoice();
  const h3 = await heuristicOfferToProject();
  const h4 = await heuristicBizDocCrossLink();

  const hTotal = h1 + h2 + h3 + h4;
  console.log(`\n[Summary] Heuristic links created: ${hTotal}`);

  // AI pass (only if GEMINI_API_KEY is set)
  let aiTotal = 0;
  if (process.env.GEMINI_API_KEY) {
    aiTotal = await aiLinkingPass();
  } else {
    console.log('\n[AI] Skipped: GEMINI_API_KEY not set');
  }

  const after = await prisma.bizDocument.groupBy({ by: ['status'], _count: true });
  const linksAfter = await prisma.reconciliationLink.count();

  console.log('\n═══════════════════════════════════════════════════');
  console.log('After:');
  after.forEach(r => console.log(`  ${r.status}: ${r._count}`));
  console.log(`  ReconciliationLinks: ${linksAfter} (+${linksAfter - linksBefore})`);
  console.log(`  Heuristic new links: ${hTotal}`);
  console.log(`  AI new links:        ${aiTotal}`);
  console.log('═══════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
