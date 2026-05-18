const DEFAULT_LAST_ISSUED_OUTGOING_INVOICE_NO = 198;

function getLastIssuedOutgoingInvoiceNo() {
  const configured = Number(process.env.LAST_ISSUED_OUTGOING_INVOICE_NO);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_LAST_ISSUED_OUTGOING_INVOICE_NO;
}

function parseStrictInvoiceNumber(value) {
  const normalized = String(value || '').trim();
  if (!/^0*\d+$/.test(normalized)) return null;
  const parsed = Number(normalized.replace(/^0+/, '') || '0');
  return Number.isFinite(parsed) ? parsed : null;
}

function isBeyondLastIssuedOutgoingInvoice(value, lastIssued = getLastIssuedOutgoingInvoiceNo()) {
  const parsed = parseStrictInvoiceNumber(value);
  return parsed != null && parsed > lastIssued;
}

module.exports = {
  DEFAULT_LAST_ISSUED_OUTGOING_INVOICE_NO,
  getLastIssuedOutgoingInvoiceNo,
  parseStrictInvoiceNumber,
  isBeyondLastIssuedOutgoingInvoice,
};
