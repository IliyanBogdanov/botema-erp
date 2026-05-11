const express = require('express');
const router = express.Router();
const { auth } = require('./auth');

// In-memory cache: { rates: {...}, fetchedAt: Date }
let ratesCache = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// EUR/BGN is fixed by currency board — always 1.95583
const EUR_BGN_FIXED = 1.95583;

async function fetchRates() {
  // open.er-api.com — free, no key required, EUR as base
  const res = await fetch('https://open.er-api.com/v6/latest/EUR');
  if (!res.ok) throw new Error(`Rate fetch failed: ${res.status}`);
  const json = await res.json();
  if (json.result !== 'success') throw new Error('Rate API returned error');

  const rates = json.rates || {};
  // Override EUR/BGN with the legally fixed rate
  rates.BGN = EUR_BGN_FIXED;

  ratesCache = { rates, fetchedAt: new Date() };
  return ratesCache;
}

// GET /api/rates
router.get('/', auth, async (req, res) => {
  try {
    const now = Date.now();
    if (!ratesCache || now - new Date(ratesCache.fetchedAt).getTime() > CACHE_TTL_MS) {
      await fetchRates();
    }

    const { rates, fetchedAt } = ratesCache;
    const bgnPerEur = rates.BGN || EUR_BGN_FIXED;
    const usdPerEur = rates.USD || null;
    const gbpPerEur = rates.GBP || null;
    const chfPerEur = rates.CHF || null;

    res.json({
      base: 'EUR',
      fetchedAt,
      eurBgn: bgnPerEur,
      usdBgn: usdPerEur ? usdPerEur / bgnPerEur : null,  // not used but available
      gbpBgn: gbpPerEur ? bgnPerEur / gbpPerEur : null,
      chfBgn: chfPerEur ? bgnPerEur / chfPerEur : null,
      usdEur: usdPerEur,
      gbpEur: gbpPerEur,
      chfEur: chfPerEur,
      note: 'EUR/BGN is fixed by Bulgarian currency board at 1.95583',
    });
  } catch (e) {
    // Fallback to hardcoded if API is unreachable
    res.json({
      base: 'EUR',
      fetchedAt: null,
      eurBgn: EUR_BGN_FIXED,
      usdEur: null,
      gbpEur: null,
      chfEur: null,
      note: 'Using fallback rate — live fetch failed',
      error: e.message,
    });
  }
});

module.exports = router;
