// Mirrors backend/src/lib/dealStages.js — kept as a small hand-authored
// constant since the ten stages are fixed business vocabulary from the ERP
// spec, not something the UI needs to fetch on every render.

export const DEAL_STAGE_ORDER = [
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
] as const;

export type DealStage = typeof DEAL_STAGE_ORDER[number];

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
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

export const DEAL_STAGE_SUGGESTED_OWNER: Record<DealStage, string> = {
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

export const DEAL_STAGE_OWNERS = ['Жоро', 'Илиян', 'Стефи'] as const;

export const dealStageIndex = (stage?: string | null) =>
  stage ? DEAL_STAGE_ORDER.indexOf(stage as DealStage) : -1;
