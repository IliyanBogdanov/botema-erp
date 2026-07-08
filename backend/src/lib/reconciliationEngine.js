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
  /(?:фактура|faktura|invoice|inv)\s*(?:номер|no\.?|nr\.?|#|№)?\s*([a-zа-я0-9./_-]{2,})/i,
  /(?:проформа|proforma|пф|проф\.?\s*ф-?ра|проф\.?|оферта|offer|quote|order confirmation|order)\s*(?:№|no\.?|nr\.?|#|номер|factura|фактура)?\s*([a-zа-я0-9./_-]{2,})/i,
  /(?:пр|pr)\s*(?:№|no\.?|nr\.?|#|номер)?\s*([a-zа-я0-9./_-]{2,})/i,
  /[№#]\s*([a-zа-я0-9./_-]{3,})/i,
  /\b(\d{4,})\b/,
];

// Keywords indicating bank charges / fees — not invoice payments
const BANK_CHARGE_KEYWORDS = [
  /такса/i, /atm/i, /\[такса\]/i, /debit visa/i, /credit card/i,
  /openai/i, /chatgpt/i, /pos\s+\d/i, /такса превод/i,
  /такса: /i, /комисион(?!на)/i,
];

/**
 * Strip leading zeros from a numeric string for loose matching.
 */
function stripLeadingZeros(s) {
  return s ? s.replace(/^0+/, '') || '0' : s;
}

/**
 * Try to extract an invoice/document number from a payment description string.
 * Returns the first match found, or null.
 */
function extractDocNumber(description) {
  if (!description) return null;
  for (const pattern of INVOICE_NUMBER_PATTERNS) {
    const m = description.match(pattern);
    if (m) {
      const raw = String(m[1] || '').trim();
      if (!raw) continue;
      return /^\d+$/.test(raw) ? raw.replace(/^0+/, '') || '0' : raw;
    }
  }
  return null;
}

function extractDocNumbers(description) {
  if (!description) return [];
  const text = String(description);
  const matches = new Set();
  for (const pattern of INVOICE_NUMBER_PATTERNS) {
    let m;
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    while ((m = re.exec(text))) {
      const raw = String(m[1] || '').trim();
      if (!raw) continue;
      matches.add(/^\d+$/.test(raw) ? raw.replace(/^0+/, '') || '0' : raw);
    }
  }
  return [...matches];
}

/**
 * Returns true if the payment notes indicate it's a bank fee / charge / ATM.
 */
function isBankCharge(payment) {
  const notes = (payment.notes || '') + ' ' + (payment.reference || '');
  return BANK_CHARGE_KEYWORDS.some(p => p.test(notes));
}

function classifySystemPayment(payment) {
  const notes = (payment.notes || '') + ' ' + (payment.reference || '');
  const classifiers = [
    { category: 'BANK_FEE', re: /такса|fee|commission|комисион|maintenance fee|account maintenance/i },
    { category: 'TAX', re: /ддс|nap|td nap|данък|tax|ministry of e-governance|e-governance|revenue agency/i },
    { category: 'SALARY', re: /заплата|salary|payroll|основна заплата/i },
    { category: 'ATM', re: /\batm\b|withdrawal|cash withdrawal/i },
    { category: 'CARD_SUBSCRIPTION', re: /openai|chatgpt|anthropic|claude|subscription|subscr|kiwi|parko|alloggi|laptop\.bg|google ads|facebook|meta ads|stripe/i },
    { category: 'COD', re: /наложен платеж|cash on delivery|cod/i },
    { category: 'CORRECTION', re: /грешно преведена сума|wrong transfer|incorrect transfer/i },
  ];

  for (const item of classifiers) {
    if (item.re.test(notes)) return item.category;
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

const BGN_PER_EUR = 1.95583;
const toEurAmount = (amount, currency) =>
  currency === 'BGN' ? Number(amount) / BGN_PER_EUR : Number(amount);

/**
 * Currency-aware amount comparison: converts BGN<->EUR before comparing,
 * so a 2026 EUR payment can match a 2025 BGN invoice and vice versa.
 */
function amountsMatchFx(payAmount, payCurrency, docAmount, docCurrency, tolerance = 0.005) {
  return amountsMatch(toEurAmount(payAmount, payCurrency), toEurAmount(docAmount, docCurrency), tolerance);
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
      paymentType: true,
      notes: true,
      reference: true,
      counterpartyId: true,
    },
  });

  // ── Step 0: auto-dismiss bank charges (fees, ATM, card charges) ──────────
  let bankChargeCount = 0;
  let systemResolvedCount = 0;
  const realPayments = [];
  for (const payment of payments) {
    const systemCategory = classifySystemPayment(payment);
    if (systemCategory) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'MATCHED', notes: `${payment.notes || ''} [auto:${systemCategory.toLowerCase()}]`.trim() },
      });
      systemResolvedCount++;
      if (systemCategory === 'BANK_FEE') bankChargeCount++;
    } else {
      realPayments.push(payment);
    }
  }

  // Load all invoices/proformas in the same currency once
  const docs = await prisma.bizDocument.findMany({
    where: {
      docType: { in: ['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_IN', 'PROFORMA_OUT', 'OFFER_IN', 'OFFER_OUT', 'DELIVERY_NOTE', 'PROTOCOL'] },
      status: { not: 'REJECTED' },
    },
    select: {
      id: true,
      docType: true,
      docNumber: true,
      amountTotal: true,
      currency: true,
      counterpartyId: true,
      docDate: true,
      status: true,
    },
  });

  // Build lookup maps: exact docNumber AND leading-zero-stripped version
  const docByNumber = new Map();
  const docByStripped = new Map();
  for (const doc of docs) {
    if (doc.docNumber) {
      const trimmed = doc.docNumber.trim();
      docByNumber.set(trimmed, doc);
      const stripped = stripLeadingZeros(trimmed.replace(/\D/g, ''));
      if (stripped && stripped !== trimmed) docByStripped.set(stripped, doc);
    }
  }

  function findDocByNum(num) {
    if (!num) return null;
    if (docByNumber.has(num)) return docByNumber.get(num);
    // Try stripped version of extracted number
    const strippedNum = stripLeadingZeros(num);
    if (docByNumber.has(strippedNum)) return docByNumber.get(strippedNum);
    if (docByStripped.has(strippedNum)) return docByStripped.get(strippedNum);
    return null;
  }

  let matched = 0, partial = 0, unmatched = 0;
  const openItems = [];

  for (const payment of realPayments) {
    let bestMatch = null;
    let confidence = 0;

    // ── Step 1: regex extract doc number ────────────────────────────────────
    const extractedNums = extractDocNumbers(`${payment.notes || ''} ${payment.reference || ''}`);
    const exactMatches = extractedNums
      .map(num => findDocByNum(num))
      .filter(Boolean);

    if (exactMatches.length > 0) {
      const preferOutgoing = /\[OUT\]/.test(payment.notes || '');
      const docTypeRank = doc => {
        if (preferOutgoing) {
          if (doc.docType === 'INVOICE_OUT') return 3;
          if (doc.docType === 'PROFORMA_OUT') return 2;
          if (doc.docType === 'INVOICE_IN') return 1;
          if (doc.docType === 'PROFORMA_IN') return 1;
        } else {
          if (doc.docType === 'INVOICE_IN') return 3;
          if (doc.docType === 'PROFORMA_IN') return 2;
          if (doc.docType === 'INVOICE_OUT') return 1;
          if (doc.docType === 'PROFORMA_OUT') return 1;
        }
        return 0;
      };
      // A doc-number hit alone is not enough: bank references are full of
      // date/sequence digits that collide with unrelated doc numbers.
      // Require the amounts to agree (currency-aware) before trusting the match.
      const payEur = toEurAmount(payment.amount, payment.currency);
      const candidates = [...exactMatches]
        .filter(d => amountsMatchFx(payment.amount, payment.currency, d.amountTotal, d.currency, 0.02))
        .sort((a, b) => {
          const ra = docTypeRank(a);
          const rb = docTypeRank(b);
          if (rb !== ra) return rb - ra;
          const amtA = Math.abs(payEur - toEurAmount(a.amountTotal, a.currency));
          const amtB = Math.abs(payEur - toEurAmount(b.amountTotal, b.currency));
          if (amtA !== amtB) return amtA - amtB;
          const dateA = a.docDate ? Math.abs(new Date(a.docDate).getTime() - new Date(payment.paymentDate).getTime()) : Number.MAX_SAFE_INTEGER;
          const dateB = b.docDate ? Math.abs(new Date(b.docDate).getTime() - new Date(payment.paymentDate).getTime()) : Number.MAX_SAFE_INTEGER;
          return dateA - dateB;
        });
      if (candidates.length > 0) {
        bestMatch = candidates[0];
        confidence = amountsMatchFx(payment.amount, payment.currency, bestMatch.amountTotal, bestMatch.currency) ? 1.0 : 0.85;
      }
    }

    // ── Step 2: fallback – counterparty + amount + date window ──────────────
    if (!bestMatch && payment.counterpartyId) {
      const windowStart = new Date(payment.paymentDate);
      windowStart.setDate(windowStart.getDate() - 60);
      const windowEnd = new Date(payment.paymentDate);
      windowEnd.setDate(windowEnd.getDate() + 60);

      const candidates = docs.filter(d =>
        d.counterpartyId === payment.counterpartyId &&
        d.docDate &&
        d.docDate >= windowStart &&
        d.docDate <= windowEnd
      );

      const payEur = toEurAmount(payment.amount, payment.currency);
      for (const candidate of candidates) {
        if (amountsMatchFx(payment.amount, payment.currency, candidate.amountTotal, candidate.currency)) {
          bestMatch = candidate;
          confidence = 0.85;
          break;
        }
        // Partial: within 10%
        const candEur = toEurAmount(candidate.amountTotal, candidate.currency);
        if (Math.abs(payEur - candEur) / Math.max(payEur, candEur) < 0.10) {
          bestMatch = candidate;
          confidence = 0.7;
          // keep looking for exact match
        }
      }
    }

    // ── Step 3: exact amount + currency + narrow date window (no counterparty)
    // Only for IMPORTED docs (migrated from Purchase/Invoice) — lower confidence
    if (!bestMatch) {
      const windowStart = new Date(payment.paymentDate);
      windowStart.setDate(windowStart.getDate() - 30);
      const windowEnd = new Date(payment.paymentDate);
      windowEnd.setDate(windowEnd.getDate() + 30);

      const exactCandidates = docs.filter(d =>
        d.status === 'IMPORTED' &&
        d.currency === payment.currency &&
        d.docDate &&
        d.docDate >= windowStart &&
        d.docDate <= windowEnd &&
        amountsMatch(Number(payment.amount), Number(d.amountTotal), 0.002) // 0.2% tolerance
      );

      // Only match if exactly ONE candidate to avoid false positives
      if (exactCandidates.length === 1) {
        bestMatch = exactCandidates[0];
        confidence = 0.6;
      }
    }

    if (!bestMatch) {
      openItems.push(payment);
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

  // Payments with no trustworthy match stay UNMATCHED — hiding them behind a
  // forced PARTIAL status makes the reconciliation stats lie.
  unmatched = openItems.length;

  return { matched, partial, unmatched, bankCharges: bankChargeCount, systemResolved: systemResolvedCount, totalProcessed: payments.length };
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

module.exports = { autoMatch, getStats, extractDocNumber, extractDocNumbers, isBankCharge, classifySystemPayment, stripLeadingZeros };
