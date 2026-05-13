/**
 * aiMatchPayments.js
 *
 * Match UNMATCHED bank transfers to BizDocuments (invoices/orders).
 * Strategy:
 *  1. Exact amount + same counterparty (±30 days)
 *  2. Fuzzy amount (±5%) + same counterparty (±60 days)
 *  3. Amount + similar counterparty name (±90 days)
 *
 * Creates ReconciliationLink entries for each match.
 * Run: node scripts/aiMatchPayments.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

function nameScore(a, b) {
  if (!a || !b) return 0;
  const normalize = s => s.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  // Common prefix
  let common = 0;
  const shorter = Math.min(na.length, nb.length);
  for (let i = 0; i < shorter; i++) { if (na[i] === nb[i]) common++; else break; }
  return common / Math.max(na.length, nb.length);
}

function daysDiff(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

async function main() {
  console.log('=== Payment Matching Pass ===\n');

  const [unmatchedPayments, openDocs] = await Promise.all([
    p.payment.findMany({
      where: { status: 'UNMATCHED' },
      include: { counterparty: { select: { id: true, name: true } } },
      orderBy: { paymentDate: 'desc' },
    }),
    p.bizDocument.findMany({
      where: {
        docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'OFFER_OUT', 'DELIVERY_NOTE'] },
        amountTotal: { not: null, gt: 0 },
      },
      include: { counterparty: { select: { id: true, name: true } } },
      orderBy: { docDate: 'desc' },
    }),
  ]);

  console.log(`Unmatched payments: ${unmatchedPayments.length}`);
  console.log(`BizDocs to match against: ${openDocs.length}\n`);

  const existingLinks = await p.reconciliationLink.findMany({
    where: { paymentId: { not: null } },
    select: { paymentId: true, targetDocId: true },
  });
  const linkedPairs = new Set(existingLinks.map(l => `${l.paymentId}:${l.targetDocId}`));

  let created = 0;
  let partialCreated = 0;

  for (const payment of unmatchedPayments) {
    const payAmt = Number(payment.amount);
    const payDate = new Date(payment.paymentDate);
    const payCpId = payment.counterpartyId;
    const payCpName = payment.counterparty?.name;

    let bestMatch = null;
    let bestScore = 0;

    for (const doc of openDocs) {
      const docAmt = Number(doc.amountTotal);
      const docDate = new Date(doc.docDate);
      const docCpId = doc.counterpartyId;
      const docCpName = doc.counterparty?.name;

      // Skip already linked
      const pairKey = `${payment.id}:${doc.id}`;
      if (linkedPairs.has(pairKey)) continue;

      // Amount match
      const amtRatio = Math.abs(payAmt - docAmt) / Math.max(payAmt, docAmt, 0.01);
      if (amtRatio > 0.1) continue; // must be within 10%

      // Date proximity
      const days = daysDiff(payDate, docDate);
      if (days > 120) continue;

      // Counterparty match
      let cpScore = 0;
      if (payCpId && docCpId && payCpId === docCpId) {
        cpScore = 1;
      } else if (payCpName && docCpName) {
        cpScore = nameScore(payCpName, docCpName);
      }

      if (cpScore < 0.3) continue;

      // Score: amount precision (60%), date proximity (25%), cp match (15%)
      const amtScore = 1 - amtRatio;
      const dateScore = Math.max(0, 1 - days / 120);
      const score = amtScore * 0.6 + dateScore * 0.25 + cpScore * 0.15;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { doc, amtRatio, days, cpScore };
      }
    }

    if (bestMatch && bestScore >= 0.5) {
      const linkType = bestMatch.amtRatio < 0.01 ? 'PAYMENT_TO_INVOICE' : 'PARTIAL_MATCH';
      await p.reconciliationLink.create({
        data: {
          paymentId: payment.id,
          targetDocId: bestMatch.doc.id,
          linkType,
          confidence: parseFloat(bestScore.toFixed(3)),
          notes: `Auto: amount_diff=${(bestMatch.amtRatio * 100).toFixed(1)}% days=${bestMatch.days.toFixed(0)} cp_score=${bestMatch.cpScore.toFixed(2)}`,
        },
      });

      if (linkType === 'PAYMENT_TO_INVOICE') {
        await p.payment.update({ where: { id: payment.id }, data: { status: 'MATCHED' } });
        created++;
      } else {
        await p.payment.update({ where: { id: payment.id }, data: { status: 'PARTIAL' } });
        partialCreated++;
      }

      console.log(`  ✓ ${linkType} | ${payCpName?.slice(0, 20)} | ${payAmt} → ${Number(bestMatch.doc.amountTotal).toFixed(2)} | score=${bestScore.toFixed(2)}`);
    }
  }

  console.log(`\nNew PAYMENT_TO_INVOICE links: ${created}`);
  console.log(`New PARTIAL_MATCH links: ${partialCreated}`);

  const stillUnmatched = await p.payment.count({ where: { status: 'UNMATCHED' } });
  console.log(`Still UNMATCHED: ${stillUnmatched}`);

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
