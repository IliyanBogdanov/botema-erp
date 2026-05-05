const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');

// GET /api/payments
router.get('/', async (req, res) => {
  try {
    const { status, counterpartyId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (counterpartyId) where.counterpartyId = counterpartyId;

    const payments = await prisma.payment.findMany({
      where,
      include: {
        counterparty: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true } },
        reconciliationLinks: {
          include: {
            targetDoc: { select: { id: true, docType: true, docNumber: true, amountTotal: true } },
          },
        },
      },
      orderBy: { paymentDate: 'desc' },
    });
    res.json(payments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/payments/unmatched — плащания без фактура
router.get('/unmatched', async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { status: { in: ['UNMATCHED', 'PARTIAL'] } },
      include: {
        counterparty: { select: { id: true, name: true } },
        reconciliationLinks: true,
      },
      orderBy: { paymentDate: 'desc' },
    });
    res.json(payments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
