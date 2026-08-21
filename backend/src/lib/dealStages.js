// Deal-stage pipeline shared config — mirrors the as-is process in the ERP
// spec: Оферта изпратена -> ... -> Затворено. Kept as plain data + small pure
// helpers so both the API response and (indirectly, via the same BG labels
// hand-authored on the frontend) the UI agree on the ten stages.

const STAGE_ORDER = [
  'OFFER_SENT',
  'CLIENT_APPROVED',
  'PROFORMA_ISSUED',
  'ADVANCE_PAID',
  'ORDERED',
  'COMMISSION_PAID',
  'GOODS_ARRIVED',
  'WAREHOUSED',
  'INVOICED_ZERO',
  'CLOSED',
];

const STAGE_LABELS = {
  OFFER_SENT: 'Оферта изпратена',
  CLIENT_APPROVED: 'Одобрена от клиент',
  PROFORMA_ISSUED: 'Проформа издадена',
  ADVANCE_PAID: 'Авансът платен',
  ORDERED: 'Поръчано при производител(и)',
  COMMISSION_PAID: 'Платен комисион на дизайнер',
  GOODS_ARRIVED: 'Стоката пристигнала',
  WAREHOUSED: 'Заведена в склад',
  INVOICED_ZERO: 'Нулева фактура издадена',
  CLOSED: 'Затворено',
};

// Who typically owns moving the deal past this stage, per the roles in the
// spec (Жоро: клиенти/дизайнери/оферти, Илиян: производители/плащания,
// Стефи: склад). Shown as a suggestion, not enforced.
const STAGE_SUGGESTED_OWNER = {
  OFFER_SENT: 'Жоро',
  CLIENT_APPROVED: 'Жоро',
  PROFORMA_ISSUED: 'Илиян',
  ADVANCE_PAID: 'Илиян',
  ORDERED: 'Илиян',
  COMMISSION_PAID: 'Жоро',
  GOODS_ARRIVED: 'Стефи',
  WAREHOUSED: 'Стефи',
  INVOICED_ZERO: 'Стефи',
  CLOSED: 'Жоро',
};

const stageIndex = stage => (stage ? STAGE_ORDER.indexOf(stage) : -1);

// Infers the furthest stage a project's own documents/payments/inventory
// already prove it has reached — not a replacement for the manual dealStage,
// just a nudge ("your documents suggest you're further along than you've
// marked"). Only flags stages with an unambiguous, cheap-to-check signal;
// CLIENT_APPROVED / COMMISSION_PAID / INVOICED_ZERO / CLOSED stay manual-only
// since nothing in the data model distinguishes them reliably.
function detectStageFromRecords(project) {
  const bizDocs = project.bizDocuments || [];
  const orders = project.orders || [];
  const payments = project.payments || [];
  const deliveries = project.deliveries || (orders.flatMap(o => o.deliveries || []));
  const inventory = project.inventory || [];

  let detected = null;
  const advance = stage => {
    if (stageIndex(stage) > stageIndex(detected)) detected = stage;
  };

  if (bizDocs.some(d => d.docType === 'OFFER_OUT')) advance('OFFER_SENT');
  if (bizDocs.some(d => d.docType === 'PROFORMA_OUT')) advance('PROFORMA_ISSUED');
  if (payments.some(p => p.category === 'INCOME')) advance('ADVANCE_PAID');
  if (orders.some(o => o.orderType === 'SUPPLIER_ORDER')) advance('ORDERED');
  if (deliveries.some(d => d.deliveryType === 'INBOUND' && d.status === 'DELIVERED')) advance('GOODS_ARRIVED');
  if (inventory.some(i => (i.qtyIn || 0) > 0)) advance('WAREHOUSED');

  return detected;
}

// Returns the detected stage only if it is strictly ahead of the stored one
// (nothing to suggest otherwise).
function suggestNextStage(project) {
  const detected = detectStageFromRecords(project);
  if (!detected) return null;
  return stageIndex(detected) > stageIndex(project.dealStage) ? detected : null;
}

module.exports = { STAGE_ORDER, STAGE_LABELS, STAGE_SUGGESTED_OWNER, stageIndex, suggestNextStage };
