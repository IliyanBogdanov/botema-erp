const express = require('express');
const { auth } = require('../middleware/auth');
const { reviewDocument, analyzeDocument } = require('../lib/documentReview');
const { generateAlerts } = require('../lib/alertEngine');
const { downloadDriveFile, parseDocumentWithAI } = require('../lib/aiParser');
const prisma = require('../lib/prisma');

const router = express.Router();

// In-memory job store for reparse jobs
const reparseJobs = {};

router.get('/', auth, async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const where = status ? { status } : {};
    const take = parseInt(limit);
    const skip = (parseInt(page) - 1) * take;
    const [docs, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { alerts: { where: { status: 'ACTIVE' }, orderBy: { detectedAt: 'desc' } } },
      }),
      prisma.document.count({ where }),
    ]);
    res.json({ data: docs, total, page: parseInt(page), pages: Math.ceil(total / take) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/reparse-job/:jobId — poll reparse job status
router.get('/reparse-job/:jobId', auth, (req, res) => {
  const job = reparseJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// POST /api/documents/reparse-all — batch AI re-parse all pending low-confidence docs
router.post('/reparse-all', auth, async (req, res) => {
  const jobId = `reparse-${Date.now()}`;
  reparseJobs[jobId] = { jobId, status: 'running', done: 0, total: 0, errors: 0, log: [], started: new Date() };

  res.json({ accepted: true, jobId, message: `Re-parse job started. Poll GET /api/documents/reparse-job/${jobId}` });

  (async () => {
    const job = reparseJobs[jobId];
    try {
      const allDocs = await prisma.document.findMany({
        where: { status: 'PENDING', confidence: { lte: 20 } },
        orderBy: { createdAt: 'desc' },
      });
      const docs = allDocs.filter(d => d.driveFileId);

      job.total = docs.length;
      job.log.push(`Found ${docs.length} documents to re-parse`);

      for (const doc of docs) {
        try {
          const folder = (doc.extractedData && doc.extractedData.folder) || '';
          const filename = doc.filename || doc.driveFileId;

          job.log.push(`Parsing: ${filename}`);

          const pdfBuffer = await downloadDriveFile(doc.driveFileId);
          const parsed = await parseDocumentWithAI(filename, folder, pdfBuffer);

          const mergedData = Object.assign({}, doc.extractedData || {}, parsed, {
            folder: doc.extractedData && doc.extractedData.folder,
            source: doc.extractedData && doc.extractedData.source,
          });

          const analysis = await analyzeDocument(prisma, mergedData);

          await prisma.document.update({
            where: { id: doc.id },
            data: {
              extractedData: mergedData,
              confidence: parsed.confidence || 0,
              riskFlags: analysis.riskFlags || [],
              suggestedAction: analysis.suggestedAction,
            },
          });

          job.done++;
          job.log.push(`✓ ${filename} — ${parsed.amountTotal || '?'} ${parsed.currency || ''} (conf: ${parsed.confidence})`);
        } catch (err) {
          job.errors++;
          job.log.push(`✗ ${doc.filename}: ${err.message}`);
        }
        if (job.log.length > 300) job.log.shift();
      }

      job.status = 'done';
      job.finished = new Date();
      job.log.push(`Finished: ${job.done} parsed, ${job.errors} errors`);
    } catch (err) {
      job.status = 'error';
      job.error = err.message;
      job.finished = new Date();
    }
  })();
});

// GET /api/documents/:id/file — stream Drive PDF inline
router.get('/:id/file', auth, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.driveFileId) return res.status(404).json({ error: 'No Drive file attached' });

    const buffer = await downloadDriveFile(doc.driveFileId);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${doc.filename || 'document.pdf'}"`);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/:id/link — manually link to invoice or purchase
router.post('/:id/link', auth, async (req, res) => {
  try {
    const { invoiceId, purchaseId } = req.body;
    if (!invoiceId && !purchaseId) return res.status(400).json({ error: 'invoiceId or purchaseId required' });

    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const updateData = { status: 'LINKED' };
    if (invoiceId) updateData.invoiceId = invoiceId;
    if (purchaseId) updateData.purchaseId = purchaseId;

    if (invoiceId && doc.driveFileId) {
      await prisma.invoice.updateMany({ where: { id: invoiceId, driveFileId: null }, data: { driveFileId: doc.driveFileId } });
    }
    if (purchaseId && doc.driveFileId) {
      await prisma.purchase.updateMany({ where: { id: purchaseId, driveFileId: null }, data: { driveFileId: doc.driveFileId } });
    }

    const updated = await prisma.document.update({ where: { id: doc.id }, data: updateData });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', auth, async (req, res) => {
  try {
    const doc = await prisma.document.update({ where: { id: req.params.id }, data: req.body });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/:id/reparse — re-parse single document from Drive PDF
router.post('/:id/reparse', auth, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (!doc.driveFileId) return res.status(400).json({ error: 'No Drive file attached' });

    const folder = (doc.extractedData && doc.extractedData.folder) || '';
    const filename = doc.filename || doc.driveFileId;

    const pdfBuffer = await downloadDriveFile(doc.driveFileId);
    const parsed = await parseDocumentWithAI(filename, folder, pdfBuffer);

    const mergedData = Object.assign({}, doc.extractedData || {}, parsed, {
      folder: doc.extractedData && doc.extractedData.folder,
      source: doc.extractedData && doc.extractedData.source,
    });

    const analysis = await analyzeDocument(prisma, mergedData);

    const updated = await prisma.document.update({
      where: { id: doc.id },
      data: {
        extractedData: mergedData,
        confidence: parsed.confidence || 0,
        riskFlags: analysis.riskFlags || [],
        suggestedAction: analysis.suggestedAction,
      },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/analyze', auth, async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const analysis = await analyzeDocument(prisma, doc.extractedData || {});
    const updated = await prisma.document.update({ where: { id: doc.id }, data: analysis });
    await generateAlerts(prisma);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/review', auth, async (req, res) => {
  try {
    const result = await reviewDocument(prisma, req.params.id, req.body, req.user.id);
    res.json(result);
    generateAlerts(prisma).catch(err => console.error('generateAlerts error:', err));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
