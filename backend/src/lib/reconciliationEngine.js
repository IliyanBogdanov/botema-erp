/**
 * Auto-reconciliation engine.
 * Matches Payments to BizDocuments (invoices) and creates ReconciliationLinks.
 *
 * Strategy:
 *  1. Extract invoice number from payment description via regex → match BizDocument.docNumber
 *  2. Fallback: match by counterpartyId + amount ±0.5% within ±60 days
 *
 * Confidence scoring:
 *  1.0  = exact docNumber match
 *  0.85 = counterparty + amount + date
 *  0.7  = counterparty + amount only
 */

const prisma = require('./prisma');

// Patterns that look like Bulgarian invoice numbers
const INVOICE_NUMBER_PATTERNS = [
  /\b(\d{10})\b/,                  // 10-digit number (common BG format)
  /фактура\s*[№#]?\s*(\d+)/i,     // "фактура 1234"
  /invoice\s*[№#]?\s*(\d+)/i,     // "invoice 1234"
  /inv[.\-\s]?(\d+)/i,             // "inv-1234"
  /[№#]\s*(\d{4,})/,              // "№ 1234"
];

/**
 * Try to extract an invoice/document number from a payment description string.
 * Returns the first match found, or null.
 */
function extractDocNumber(description) {
  if (!description) return null;
  for (const pattern of INVOICE_NUMBER_PATTERNS) {
    const m = description.match(pattern);
    if (m) return m[1];
  }
  return null;
}

/**
 * Check if two amounts are within tolerance (default 0.5%).
 */
function amountsMatch(a, b, tolerance = 0.005) {
  if (a === 0 && b === 0) return true;
  const maxVal = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= maxVal * tolerance;
}

/**
 * Run auto-reconciliation for all UNMATCHED payments (optionally filtered by year).
 *
 * @param {object} opts
 * @param {number} [opts.year] - Optional year filter
 * @returns {{ matched: number, partial: number, unmatched: number, totalProcessed: number }}
 */
async function autoMatch({ year } = {}) {
  const dateFilter = year
    ? { paymentDate: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } }
    : {};

  const payments = await prisma.payment.findMany({
    where: { status: { in: ['UNMATCHED', 'PARTIAL'] }, ...dateFilter },
    select: {
      id: true,
      amount: true,
      currency: true,
      paymentDate: true,
      notes: true,
      counterpartyId: true,
    },
  });

  // Load all invoices/proformas in the same currency once
  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_IN', 'PROFORMA_OUT'] },
      status: { notIn: ['MATCHED'] },
    },
    select: {
      id: true,
      docType: true,
      docNumber: true,
      amountTotal: true,
      currency: true,
      counterpartyId: true,
      docDate: true,
    },
  });

  // Build lookup map: docNumber → doc
  const docByNumber = new Map();
  for (const doc of docs) {
    if (doc.docNumber) docByNumber.set(doc.docNumber.trim(), doc);
  }

  let matched = 0, partial = 0, unmatched = 0;

  for (const payment of payments) {
    let bestMatch = null;
    let confidence = 0;

    // ── Step 1: regex extract doc number ────────────────────────────────────
    const extractedNum = extractDocNumber(payment.notes);
    if (extractedNum && docByNumber.has(extractedNum)) {
      bestMatch = docByNumber.get(extractedNum);
      confidence = amountsMatch(payment.amount, bestMatch.amountTotal) ? 1.0 : 0.8;
    }

    // ── Step 2: fallback – counterparty + amount + date window ──────────────
    if (!bestMatch && payment.counterpartyId) {
      const windowStart = new Date(payment.paymentDate);
      windowStart.setDate(windowStart.getDate() - 60);
      const windowEnd = new Date(payment.paymentDate);
      windowEnd.setDate(windowEnd.getDate() + 60);

      const candidates = docs.filter(d =>
        d.counterpartyId === payment.counterpartyId &&
        d.currency === payment.currency &&
        d.docDate &&
        d.docDate >= windowStart &&
        d.docDate <= windowEnd
      );

      for (const candidate of candidates) {
        if (amountsMatch(payment.amount, candidate.amountTotal)) {
          bestMatch = candidate;
          confidence = 0.85;
          break;
        }
        // Partial: within 10%
        if (Math.abs(payment.amount - candidate.amountTotal) / Math.max(payment.amount, candidate.amountTotal) < 0.10) {
          bestMatch = candidate;
          confidence = 0.7;
          // keep looking for exact match
        }
      }
    }

    if (!bestMatch) {
      unmatched++;
      continue;
    }

    // ── Create/update ReconciliationLink ─────────────────────────────────────
    const isFullMatch = confidence >= 0.85;
    const linkType = 'PAYMENT_TO_INVOICE';
    const newStatus = isFullMatch ? 'MATCHED' : 'PARTIAL';

    const existingLink = await prisma.reconciliationLink.findFirst({
      where: { paymentId: payment.id, targetDocId: bestMatch.id },
      select: { id: true },
    });

    await prisma.$transaction([
      existingLink
        ? prisma.reconciliationLink.update({ where: { id: existingLink.id }, data: { confidence, linkType } })
        : prisma.reconciliationLink.create({ data: { linkType, confidence, paymentId: payment.id, targetDocId: bestMatch.id } }),
      prisma.payment.update({ where: { id: payment.id }, data: { status: newStatus } }),
    ]);

    if (isFullMatch) matched++;
    else partial++;
  }

  return { matched, partial, unmatched, totalProcessed: payments.length };
}

/**
 * Get reconciliation stats grouped by year.
 */
async function getStats(year) {
  const yearFilter = year
    ? { paymentDate: { gte: new Date(`${year}-01-01`), lt: new Date(`${year + 1}-01-01`) } }
    : {};

  const [totalPayments, matchedPayments, partialPayments, unmatchedPayments] = await Promise.all([
    prisma.payment.count({ where: yearFilter }),
    prisma.payment.count({ where: { status: 'MATCHED', ...yearFilter } }),
    prisma.payment.count({ where: { status: 'PARTIAL', ...yearFilter } }),
    prisma.payment.count({ where: { status: 'UNMATCHED', ...yearFilter } }),
  ]);

  const amountAgg = await prisma.payment.groupBy({
    by: ['currency'],
    where: yearFilter,
    _sum: { amount: true },
  });

  const matchedAgg = await prisma.payment.groupBy({
    by: ['currency'],
    where: { status: 'MATCHED', ...yearFilter },
    _sum: { amount: true },
  });

  return {
    year: year || 'all',
    totalPayments,
    matchedPayments,
    partialPayments,
    unmatchedPayments,
    matchRate: totalPayments > 0 ? Math.round((matchedPayments / totalPayments) * 100) : 0,
    totalAmounts: amountAgg.map(a => ({ currency: a.currency, amount: a._sum.amount })),
    matchedAmounts: matchedAgg.map(a => ({ currency: a.currency, amount: a._sum.amount })),
  };
}

module.exports = { autoMatch, getStats, extractDocNumber };
