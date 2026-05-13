/**
 * Comprehensive reconciliation:
 * 1. Payment (outgoing) → BizDocument INVOICE_IN — same counterpartyId, similar amount
 * 2. Payment (incoming) → Invoice — name similarity + amount match
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EUR_TO_BGN = 1.95583;

function toBGN(amount, currency) {
  const amt = parseFloat(amount) || 0;
  return currency === 'EUR' ? amt * EUR_TO_BGN : amt;
}

function normalize(name = '') {
  return name.toLowerCase()
    .replace(/еоод|оод|ад|ет|ltd|llc|s\.r\.l\.|gmbh|inc\b/gi, '')
    .replace(/[.,\-"'—()]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function nameSimilarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const common = [...wa].filter(w => wb.has(w)).length;
  const total = new Set([...wa, ...wb]).size;
  return total > 0 ? common / total : 0;
}

function amountMatch(a, b, tolerance = 0.03) {
  if (!a || !b) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

async function step1_paymentToBizDocInvoiceIn() {
  console.log('\n=== STEP 1: Payment → BizDocument INVOICE_IN ===');

  const unmatchedPays = await prisma.payment.findMany({
    where: { status: 'UNMATCHED', amount: { gt: 1 }, counterpartyId: { not: null } },
    include: { counterparty: { select: { id: true, name: true } } },
    orderBy: { paymentDate: 'asc' },
  });

  let linked = 0, skipped = 0;

  for (const pay of unmatchedPays) {
    const payBGN = toBGN(pay.amount, pay.currency);

    // Find unlinked INVOICE_IN docs for same counterparty within ±90 days
    const bizDocs = await prisma.bizDocument.findMany({
      where: {
        docType: 'INVOICE_IN',
        counterpartyId: pay.counterpartyId,
        amountTotal: { not: null },
        reconciliationLinks: { none: {} },
      },
      orderBy: { docDate: 'asc' },
    });

    for (const doc of bizDocs) {
      const docBGN = toBGN(doc.amountTotal, doc.currency);
      if (!amountMatch(payBGN, docBGN)) continue;

      const docDate = doc.docDate ? new Date(doc.docDate) : null;
      const payDate = pay.paymentDate ? new Date(pay.paymentDate) : null;
      const daysDiff = docDate && payDate ? (payDate - docDate) / 86400000 : 0;
      if (daysDiff < -30 || daysDiff > 180) continue;

      // Create link
      await prisma.reconciliationLink.create({
        data: {
          paymentId: pay.id,
          targetDocId: doc.id,
          linkType: 'PAYMENT_TO_INVOICE',
          amountLinked: pay.amount,
          currency: pay.currency,
          confidence: 0.85,
          notes: `auto: amount match ${pay.amount}${pay.currency}≈${doc.amountTotal}${doc.currency}`,
        },
      });
      await prisma.payment.update({ where: { id: pay.id }, data: { status: 'MATCHED' } });
      await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'MATCHED' } });
      console.log(`  ✅ Pay ${pay.amount}${pay.currency} (${pay.paymentDate?.toISOString().split('T')[0]}) → Doc #${doc.docNumber} ${doc.amountTotal}${doc.currency} [${pay.counterparty?.name?.substring(0,30)}]`);
      linked++;
      break;
    }
    if (bizDocs.length === 0 || linked === 0) skipped++;
  }

  console.log(`  Linked: ${linked}, Skipped: ${skipped}`);
  return linked;
}

async function step2_paymentToInvoice() {
  console.log('\n=== STEP 2: Payment → Invoice (client receivables) ===');

  const pendingInvoices = await prisma.invoice.findMany({
    where: { status: 'PENDING', amountTotal: { gt: 0 } },
    include: { client: { select: { name: true } } },
    orderBy: { date: 'asc' },
  });

  const allClients = await prisma.client.findMany({ select: { id: true, name: true } });
  const allCounterparties = await prisma.counterparty.findMany({ select: { id: true, name: true } });

  // Build client → counterparty name map by similarity
  const clientCpMap = {};
  for (const client of allClients) {
    let bestCp = null, bestSim = 0;
    for (const cp of allCounterparties) {
      const sim = nameSimilarity(client.name, cp.name);
      if (sim > bestSim && sim >= 0.75) { bestSim = sim; bestCp = cp; }
    }
    if (bestCp) clientCpMap[client.id] = { cp: bestCp, sim: bestSim };
  }

  let matched = 0;

  for (const inv of pendingInvoices) {
    if (!inv.clientId) continue;
    const cpMatch = clientCpMap[inv.clientId];
    if (!cpMatch) continue;

    const invBGN = toBGN(inv.amountTotal, inv.currency);

    // Find unmatched payment from this counterparty with matching amount
    const pay = await prisma.payment.findFirst({
      where: {
        counterpartyId: cpMatch.cp.id,
        status: 'UNMATCHED',
        amount: { gte: parseFloat(inv.amountTotal) * 0.97, lte: parseFloat(inv.amountTotal) * 1.03 },
      },
      orderBy: { paymentDate: 'asc' },
    });

    if (pay) {
      // Mark invoice as PAID and payment as MATCHED
      await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'PAID' } });
      await prisma.payment.update({ where: { id: pay.id }, data: { status: 'MATCHED' } });
      console.log(`  ✅ Invoice #${inv.number} ${inv.amountTotal}${inv.currency} [${inv.client?.name?.substring(0,25)}] → Pay ${pay.amount}${pay.currency} (${pay.paymentDate?.toISOString().split('T')[0]})`);
      matched++;
    }
  }

  console.log(`  Matched invoices: ${matched}`);
  return matched;
}

async function main() {
  const l1 = await step1_paymentToBizDocInvoiceIn();
  const l2 = await step2_paymentToInvoice();

  const [totalLinks, unmatchedPays, pendingInvs] = await Promise.all([
    prisma.reconciliationLink.count(),
    prisma.payment.count({ where: { status: 'UNMATCHED', amount: { gt: 1 } } }),
    prisma.invoice.count({ where: { status: 'PENDING' } }),
  ]);

  console.log('\n=== FINAL STATE ===');
  console.log('New links created:', l1, '| Invoices matched:', l2);
  console.log('Total ReconciliationLinks:', totalLinks);
  console.log('Remaining unmatched payments:', unmatchedPays);
  console.log('Remaining pending invoices:', pendingInvs);
}

main().catch(console.error).finally(() => prisma.$disconnect());
