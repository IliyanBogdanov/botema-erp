/**
 * Bank-first cash-flow classification. Every payment gets a category so the
 * dashboards can report costs directly from the bank (the leading source of
 * truth) instead of from the noisy document layer.
 *
 * Categories: INCOME (incoming), PURCHASE (supplier goods), SALARY, TAX,
 * RENT, BANK_FEE, SOFTWARE_ADS, LOGISTICS, SERVICES, CASH, OTHER.
 */

const RULES = [
  // Bank fees: Texim fee rows carry ".10 HH:MM" suffixed refs / "такса" texts
  { cat: 'BANK_FEE', rx: /такса|коми[зс]ион[ае]? банк|fee|\.10 \d{2}:\d{2}:\d{2}|месечно обслужване|поддръжка на сметка/i },
  { cat: 'SALARY', rx: /заплат|възнаграждение|аванс служител|salary|осиг\. вноски|хонорар/i },
  { cat: 'TAX', rx: /нап |данък|ддс|осигур|митниц|мита|acciz|акциз|данъчн|наказателн|глоба|патент/i },
  { cat: 'RENT', rx: /наем|rent/i },
  { cat: 'SOFTWARE_ADS', rx: /openai|chatgpt|anthropic|claude|google\s*\*?ads|facebk|facebook|meta ads|canva|github|vercel|railway|adobe|microsoft|суперхостинг|superhosting|hosting|домейн|domain|stripe|midjourney/i },
  { cat: 'LOGISTICS', rx: /dhl|speedy|спиди|econt|еконт|fercam|transpress|транспрес|товарителниц|shipping|freight|транспорт|куриер|alog|алог/i },
  { cat: 'SERVICES', rx: /счетовод|адвокат|юрист|нотариус|консулт|застрахов|insurance|одит/i },
  { cat: 'CASH', rx: /atm|теглене|касов|withdrawal|внасяне на каса/i },
];

/**
 * @param {object} p  payment { notes, reference, counterparty?: { name, type } }
 * @param {Set<string>} supplierCpIds  counterparty ids that have INVOICE_IN documents
 * @returns {string} category
 */
function classifyPayment(p, supplierCpIds = new Set()) {
  const dir = (p.notes || '').match(/\[(IN|OUT)\]/)?.[1];
  if (dir === 'IN') return 'INCOME';

  const text = `${p.reference || ''} ${p.counterparty?.name || ''} ${p.notes || ''}`;
  for (const r of RULES) {
    if (r.rx.test(text)) return r.cat;
  }
  // Known supplier (has cost documents) → goods purchase
  if (p.counterpartyId && supplierCpIds.has(p.counterpartyId)) return 'PURCHASE';
  // Foreign-looking beneficiary names (latin, srl/spa/gmbh/bv/ltd) → purchase
  if (/\b(srl|s\.r\.l|spa|s\.p\.a|gmbh|b\.v|sp\. z o\.o|ltd|inc|furniture|lighting|design)\b/i.test(text)) return 'PURCHASE';
  return dir === 'OUT' ? 'OTHER' : 'OTHER';
}

module.exports = { classifyPayment, RULES };
