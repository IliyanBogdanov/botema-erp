const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const fx = require('../lib/fx');

// GET /api/rates — live FX snapshot (shared cache with all KPI aggregations)
router.get('/', auth, async (req, res) => {
  try {
    const { perEur, fetchedAt, live } = await fx.loadRates();
    const bgnPerEur = perEur.BGN;

    res.json({
      base: 'EUR',
      fetchedAt: live ? fetchedAt : null,
      eurBgn: bgnPerEur,
      usdBgn: perEur.USD ? perEur.USD / bgnPerEur : null,
      gbpBgn: perEur.GBP ? bgnPerEur / perEur.GBP : null,
      chfBgn: perEur.CHF ? bgnPerEur / perEur.CHF : null,
      usdEur: perEur.USD || null,
      gbpEur: perEur.GBP || null,
      chfEur: perEur.CHF || null,
      note: live
        ? 'EUR/BGN is fixed by Bulgarian currency board at 1.95583'
        : 'Using fallback rates — live fetch failed',
    });
  } catch (e) {
    res.json({
      base: 'EUR',
      fetchedAt: null,
      eurBgn: fx.BGN_PER_EUR,
      usdEur: fx.FALLBACK_PER_EUR.USD,
      gbpEur: null,
      chfEur: null,
      note: 'Using fallback rate — live fetch failed',
      error: e.message,
    });
  }
});

module.exports = router;
