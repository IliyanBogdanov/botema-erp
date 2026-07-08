/**
 * Shared cost-side definitions for BizDocument INVOICE_IN aggregations.
 *
 * - AUTHORITATIVE_BIZ_DOC_STATUSES: the only statuses whose amounts count as real
 *   costs. NEW/NEEDS_REVIEW are unverified, REJECTED/ARCHIVED are excluded.
 * - Costs are reported NET of recoverable VAT (accounting standard): input VAT on
 *   Bulgarian invoices is reclaimable, intra-EU invoices are reverse-charge (the
 *   gross already equals the net).
 * - Credit notes are negative documents and must reduce cost totals, so cost
 *   queries filter `amountTotal: { not: null }` — never `gt: 0`.
 */
const AUTHORITATIVE_BIZ_DOC_STATUSES = ['REVIEWED', 'IMPORTED', 'MATCHED'];

const num = v => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Input VAT of an INVOICE_IN document, in the document's own currency.
 * Explicit vatAmount wins; otherwise BGN invoices are assumed to carry 20% VAT
 * (vat = gross/6); non-BGN invoices are treated as reverse-charge (0).
 */
function inputVatAmount(doc) {
  const explicit = num(doc.vatAmount);
  if (explicit !== 0) return explicit;
  if (String(doc.currency || '').toUpperCase() !== 'BGN') return 0;
  return num(doc.amountTotal) / 6;
}

/**
 * Net cost of an INVOICE_IN document, in the document's own currency.
 * Works for credit notes too (negative amounts stay negative).
 */
function netCostAmount(doc) {
  const net = num(doc.amountNet);
  if (net !== 0) return net;
  const total = num(doc.amountTotal);
  if (!total) return 0;
  return total - inputVatAmount(doc);
}

module.exports = { AUTHORITATIVE_BIZ_DOC_STATUSES, inputVatAmount, netCostAmount };
