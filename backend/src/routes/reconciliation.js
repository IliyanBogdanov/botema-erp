const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');
const { autoMatch, getStats } = require('../lib/reconciliationEngine');

// GET /api/reconciliation — all links
router.get('/', auth, async (req, res) => {
  try {
    const { linkType } = req.query;
    const links = await prisma.reconciliationLink.findMany({
      where: linkType ? { linkType } : undefined,
      include: {
        sourceDoc: { select: { id: true, docType: true, docNumber: true, counterpartyId: true } },
        targetDoc: { select: { id: true, docType: true, docNumber: true } },
        payment: { select: { id: true, amount: true, currency: true, paymentDate: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(links);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/missing
router.get('/missing', auth, async (req, res) => {
  try {
    const missing = await prisma.missingDocument.findMany({
      where: { status: 'OPEN' },
      include: {
        counterparty: { select: { id: true, name: true } },
        project: { select: { id: true, code: true, name: true } },
        relatedDoc: { select: { id: true, docType: true, docNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(missing);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/coverage
router.get('/coverage', auth, async (req, res) => {
  try {
    const coverage = await prisma.coverage.findMany({ orderBy: [{ source: 'asc' }, { year: 'desc' }] });
    res.json(coverage);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/reconciliation/stats?year=2025
router.get('/stats', auth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : null;
    const stats = await getStats(year);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reconciliation/auto-match?year=2025
router.post('/auto-match', auth, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : null;
    const result = await autoMatch({ year });
    res.json(result);
  } catch (e) {
    console.error('auto-match error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reconciliation/sync-invoice-status
// For every MATCHED payment → BizDocument link, mark the corresponding Invoice as PAID.
router.post('/sync-invoice-status', auth, async (req, res) => {
  try {
    // Find all payment→bizdoc links for MATCHED or PARTIAL payments
    const links = await prisma.reconciliationLink.findMany({
      where: { linkType: 'PAYMENT_TO_INVOICE', targetDocId: { not: null } },
      include: {
        payment: { select: { id: true, status: true, amount: true, currency: true } },
        targetDoc: { select: { id: true, docNumber: true, docType: true } },
      },
    });

    // Only INVOICE_OUT BizDocs map to the Invoice table (outgoing invoices TO clients)
    // INVOICE_IN are supplier/purchase invoices — they live in Purchase table, not Invoice
    const matchedLinks = links.filter(l =>
      (l.payment?.status === 'MATCHED' || l.payment?.status === 'PARTIAL') &&
      l.targetDoc?.docType === 'INVOICE_OUT'
    );

    // Also mark ALL matched BizDocs (any type) as PAID directly
    const allMatchedLinks = links.filter(l =>
      l.payment?.status === 'MATCHED' || l.payment?.status === 'PARTIAL'
    );
    let bizDocsPaid = 0;
    for (const link of allMatchedLinks) {
      if (!link.targetDoc?.id) continue;
      try {
        await prisma.bizDocument.updateMany({
          where: { id: link.targetDoc.id, status: { not: 'MATCHED' } },
          data: { status: 'MATCHED' },
        });
        bizDocsPaid++;
      } catch { /* ignore */ }
    }

    let updated = 0;
    let alreadyPaid = 0;
    let notFound = 0;
    const notFoundNums = [];

    for (const link of matchedLinks) {
      const docNumber = link.targetDoc?.docNumber;
      if (!docNumber) { notFound++; continue; }

      // Try exact, stripped zeros, and zero-padded (10 digits) variants
      const strippedNum = docNumber.replace(/^0+/, '') || docNumber;
      const paddedNum = strippedNum.padStart(10, '0');
      const invoice = await prisma.invoice.findFirst({
        where: { number: { in: [docNumber, strippedNum, paddedNum] } },
        select: { id: true, status: true },
      });

      if (!invoice) {
        notFound++;
        notFoundNums.push(docNumber);
        continue;
      }

      if (invoice.status === 'PAID') { alreadyPaid++; continue; }

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID' },
      });
      updated++;
    }

    res.json({
      processed: matchedLinks.length,
      updated,
      alreadyPaid,
      notFound,
      bizDocsPaidDirectly: bizDocsPaid,
      notFoundNums: notFoundNums.slice(0, 20),
    });
  } catch (e) {
    console.error('sync-invoice-status error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
