/**
 * Central FX module — single source of truth for currency conversion.
 * BGN/EUR is fixed by the Bulgarian currency board (1.95583).
 * USD/GBP/CHF come from the live ECB-derived feed (open.er-api.com), cached 6h,
 * with hardcoded fallbacks when the feed is unreachable.
 */
const BGN_PER_EUR = 1.95583;

// Units of currency per 1 EUR
const FALLBACK_PER_EUR = {
  EUR: 1,
  BGN: BGN_PER_EUR,
  USD: 1.14,
  GBP: 0.85,
  CHF: 0.93,
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let cache = null; // { perEur: {...}, fetchedAt: Date, live: boolean }

async function loadRates() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt.getTime() < CACHE_TTL_MS) return cache;
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    if (!res.ok) throw new Error(`Rate fetch failed: ${res.status}`);
    const json = await res.json();
    if (json.result !== 'success') throw new Error('Rate API returned error');
    const perEur = { ...FALLBACK_PER_EUR, ...json.rates, BGN: BGN_PER_EUR, EUR: 1 };
    cache = { perEur, fetchedAt: new Date(), live: true };
  } catch (err) {
    // Keep serving fallbacks; retry after TTL/next call
    if (!cache) cache = { perEur: { ...FALLBACK_PER_EUR }, fetchedAt: new Date(0), live: false };
  }
  return cache;
}

/** Current per-EUR rate map (sync; live if cache is warm, fallback otherwise). */
function ratesPerEur() {
  return cache?.perEur || FALLBACK_PER_EUR;
}

function toEur(amount, currency, perEur = null) {
  const n = Number(amount || 0);
  if (!n) return 0;
  const cur = String(currency || 'EUR').toUpperCase();
  if (cur === 'EUR') return n;
  const rate = (perEur || ratesPerEur())[cur];
  return rate ? n / rate : n; // unknown currency: pass through (logged nowhere on purpose — rare)
}

function toBgn(amount, currency, perEur = null) {
  return toEur(amount, currency, perEur) * BGN_PER_EUR;
}

module.exports = { BGN_PER_EUR, FALLBACK_PER_EUR, loadRates, ratesPerEur, toEur, toBgn };
