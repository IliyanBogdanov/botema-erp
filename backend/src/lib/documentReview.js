const { createLogger } = require('./logger');

const log = createLogger('documentReview');

const toNumber = value => {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const normalizeText = value => String(value || '').trim();

const getSuggestedAction = data => {
  const type = data?.type || data?.docType;
  if (type === 'INVOICE_OUT') return 'CREATE_INVOICE';
  if (type === 'INVOICE_IN' || type === 'DELIVERY' || type === 'DELIVERY_NOTE') return 'CREATE_PURCHASE';
  if (type === 'PROFORMA' || type === 'PROFORMA_IN' || type === 'PROFORMA_OUT') return 'ARCHIVE_ONLY';
  return 'ARCHIVE_ONLY';
};

const getConfidence = data => {
  if (typeof data?.confidence === 'number') return data.confidence;
  const present = [
    data?.invoiceNo,
    data?.date || data?.docDate,
    data?.amount ?? data?.amountTotal ?? data?.amountNet,
    data?.currency,
  ].filter(v => v != null && v !== '').length;
  return Math.round((present / 4) * 100) / 100;
};

const calculateTotals = data => {
  const amountNet = toNumber(data.amountNet ?? data.amount);
  const vatAmount = toNumber(data.vatAmount);
  const amountTotal = toNumber(data.amountTotal ?? data.total ?? (amountNet + vatAmount));
  return { amountNet, vatAmount, amountTotal };
};

async function analyzeDocument(prisma, extractedData = {}) {
  const data = extractedData || {};
  const flags = [];
  const type = data.type || data.docType;
  const invoiceNo = normalizeText(data.invoiceNo);
  const currency = normalizeText(data.currency);
  const date = normalizeText(data.date || data.docDate);
  const supplierName = normalizeText(data.supplierName);
  const clientName = normalizeText(data.clientName);
  const { amountNet, vatAmount, amountTotal } = calculateTotals(data);
  let duplicateOfId = null;

  log.debug('Analyzing document', { type, invoiceNo, currency, date, amountTotal, supplierName });

  if (!invoiceNo) { flags.push('MISSING_INVOICE_NO'); log.debug('Flag: MISSING_INVOICE_NO'); }
  if (!date || Number.isNaN(new Date(date).getTime())) { flags.push('MISSING_DATE'); log.debug('Flag: MISSING_DATE', { date }); }
  if (!currency) { flags.push('MISSING_CURRENCY'); log.debug('Flag: MISSING_CURRENCY'); }
  if (!amountTotal && !amountNet) { flags.push('MISSING_AMOUNT'); log.debug('Flag: MISSING_AMOUNT'); }
  if (!vatAmount && type !== 'PROFORMA' && type !== 'PROFORMA_IN' && type !== 'PROFORMA_OUT') { flags.push('MISSING_VAT'); log.debug('Flag: MISSING_VAT'); }
  if (amountNet && vatAmount && amountTotal && Math.abs((amountNet + vatAmount) - amountTotal) > 0.05) {
    flags.push('TOTAL_MISMATCH');
    log.warn('Flag: TOTAL_MISMATCH', { amountNet, vatAmount, amountTotal, diff: Math.abs((amountNet + vatAmount) - amountTotal) });
  }

  if (type === 'INVOICE_IN' || type === 'DELIVERY' || type === 'DELIVERY_NOTE') {
    const supplier = supplierName
      ? await prisma.supplier.findFirst({ where: { name: { contains: supplierName, mode: 'insensitive' } } })
      : null;
    if (!supplier) {
      flags.push('UNKNOWN_COUNTERPARTY');
      log.debug('Flag: UNKNOWN_COUNTERPARTY', { supplierName });
    }
    if (invoiceNo && supplier) {
      const duplicate = await prisma.purchase.findFirst({
        where: { invoiceNo, supplierId: supplier.id },
        select: { id: true },
      });
      if (duplicate) {
        duplicateOfId = duplicate.id;
        flags.push('DUPLICATE_INVOICE');
        log.warn('Flag: DUPLICATE_INVOICE', { invoiceNo, supplierId: supplier.id, duplicateId: duplicate.id });
      }
    }
  }

  if (type === 'INVOICE_OUT') {
    const client = clientName
      ? await prisma.client.findFirst({ where: { name: { contains: clientName, mode: 'insensitive' } } })
      : null;
    if (!client) {
      flags.push('UNKNOWN_COUNTERPARTY');
      log.debug('Flag: UNKNOWN_COUNTERPARTY', { clientName });
    }
    if (invoiceNo) {
      const duplicate = await prisma.invoice.findFirst({ where: { number: invoiceNo }, select: { id: true } });
      if (duplicate) {
        duplicateOfId = duplicate.id;
        flags.push('DUPLICATE_INVOICE');
        log.warn('Flag: DUPLICATE_INVOICE', { invoiceNo, duplicateId: duplicate.id });
      }
    }
  }

  const confidence = getConfidence(data);
  // AI returns confidence on 0-100 scale; threshold must match that scale
  if (confidence < 75) {
    flags.push('LOW_CONFIDENCE');
    log.debug('Flag: LOW_CONFIDENCE', { confidence });
  }

  const uniqueFlags = [...new Set(flags)];
  log.info('Analysis complete', { type, invoiceNo, confidence, flags: uniqueFlags, suggestedAction: getSuggestedAction(data) });

  return {
    confidence,
    suggestedAction: getSuggestedAction(data),
    duplicateOfId,
    riskFlags: uniqueFlags,
  };
}

// Resolves/creates the Counterparty(type=SUPPLIER) for this document, PLUS a
// legacy Supplier row (Purchase.supplierId is still a required legacy FK —
// see migrateClientsSuppliersToCounterparty.js) so the created Purchase
// satisfies both. Counterparty is the one to actually maintain going forward.
async function findOrCreateSupplierCounterparty(prisma, supplierId, data) {
  let cp = null;
  if (supplierId) cp = await prisma.counterparty.findUnique({ where: { id: supplierId } });
  if (!cp) {
    const name = normalizeText(data.supplierName) || 'Непознат доставчик';
    cp = await prisma.counterparty.findFirst({ where: { type: 'SUPPLIER', name: { contains: name, mode: 'insensitive' } } });
    if (!cp) cp = await prisma.counterparty.create({ data: { name, type: 'SUPPLIER', country: 'BG', currency: data.currency || 'EUR' } });
  }
  let supplier = await prisma.supplier.findFirst({ where: { name: { equals: cp.name, mode: 'insensitive' } } });
  if (!supplier) supplier = await prisma.supplier.create({ data: { name: cp.name, currency: data.currency || 'BGN' } });
  return { supplier, counterparty: cp };
}

// Resolves/creates the Counterparty(type=CLIENT) for this document. Invoice.clientId
// is legacy — new invoices go through counterpartyId only.
async function findOrCreateClientCounterparty(prisma, clientId, data) {
  if (clientId) {
    const cp = await prisma.counterparty.findUnique({ where: { id: clientId } });
    if (cp) return cp;
  }
  const name = normalizeText(data.clientName) || 'Непознат клиент';
  const existing = await prisma.counterparty.findFirst({ where: { type: 'CLIENT', name: { contains: name, mode: 'insensitive' } } });
  if (existing) return existing;
  return prisma.counterparty.create({ data: { name, type: 'CLIENT', country: 'BG', currency: 'BGN' } });
}

async function reviewDocument(prisma, docId, payload, userId) {
  const doc = await prisma.document.findUnique({ where: { id: docId } });
  if (!doc) {
    const err = new Error('Document not found');
    err.status = 404;
    throw err;
  }

  const action = payload.action || doc.suggestedAction || 'ARCHIVE_ONLY';
  const data = { ...(doc.extractedData || {}), ...(payload.invoiceData || payload.data || {}) };
  if (!data.type && data.docType) data.type = data.docType;
  if (!data.date && data.docDate) data.date = data.docDate;

  if (action === 'REJECT') {
    return prisma.document.update({
      where: { id: doc.id },
      data: { status: 'REJECTED', reviewedById: userId, reviewedAt: new Date(), processedAt: new Date() },
    });
  }

  if (action === 'ARCHIVE_ONLY') {
    await prisma.alert.updateMany({
      where: { documentId: doc.id, status: { in: ['ACTIVE', 'SNOOZED'] } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    return prisma.document.update({
      where: { id: doc.id },
      data: { status: 'PROCESSED', extractedData: data, reviewedById: userId, reviewedAt: new Date(), processedAt: new Date() },
    });
  }

  const totals = calculateTotals(data);
  let created = null;

  if (action === 'CREATE_PURCHASE') {
    const { supplier, counterparty: supplierCp } = await findOrCreateSupplierCounterparty(prisma, payload.supplierId, data);
    created = await prisma.purchase.create({
      data: {
        invoiceNo: normalizeText(data.invoiceNo) || null,
        date: new Date(data.date || data.docDate || Date.now()),
        supplierId: supplier.id,
        counterpartyId: supplierCp.id,
        projectId: payload.projectId || null,
        currency: data.currency || supplier.currency || 'BGN',
        amount: totals.amountTotal || totals.amountNet,
        description: data.description || doc.filename,
        status: payload.status || 'PAID',
        driveFileId: doc.driveFileId,
        year: new Date(data.date || data.docDate || Date.now()).getFullYear(),
        items: Array.isArray(data.items) ? {
          create: data.items.map(item => ({
            code: item.code || null,
            description: item.description || data.description || doc.filename,
            qty: toNumber(item.qty) || 1,
            unitPrice: toNumber(item.unitPrice),
            total: toNumber(item.total) || (toNumber(item.qty) || 1) * toNumber(item.unitPrice),
          })),
        } : undefined,
      },
    });
  }

  if (action === 'CREATE_EXPENSE') {
    created = await prisma.expense.create({
      data: {
        date: new Date(data.date || data.docDate || Date.now()),
        category: payload.category || data.category || 'Документи',
        supplier: data.supplierName || data.clientName || 'Непознат контрагент',
        description: data.description || doc.filename,
        amount: totals.amountTotal || totals.amountNet,
        currency: data.currency || 'BGN',
        year: new Date(data.date || data.docDate || Date.now()).getFullYear(),
      },
    });
  }

  if (action === 'CREATE_INVOICE') {
    const client = await findOrCreateClientCounterparty(prisma, payload.clientId, data);
    const items = Array.isArray(data.items) && data.items.length
      ? data.items
      : [{ description: data.description || doc.filename, qty: 1, unitPrice: totals.amountNet || totals.amountTotal, vatPct: totals.vatAmount ? 20 : 0 }];
    const amountNet = items.reduce((s, i) => s + (toNumber(i.qty) || 1) * toNumber(i.unitPrice), 0);
    const vatAmount = items.reduce((s, i) => s + (toNumber(i.qty) || 1) * toNumber(i.unitPrice) * (toNumber(i.vatPct) || 0) / 100, 0);
    created = await prisma.invoice.create({
      data: {
        number: normalizeText(data.invoiceNo) || `DOC-${doc.id.slice(-8)}`,
        date: new Date(data.date || data.docDate || Date.now()),
        counterpartyId: client.id,
        projectId: payload.projectId || null,
        type: data.type === 'PROFORMA' ? 'PROFORMA' : 'INVOICE',
        status: payload.status || 'PENDING',
        brand: payload.brand || 'STUDIO_BOTEMA',
        currency: data.currency || 'BGN',
        amountNet,
        vatAmount,
        amountTotal: totals.amountTotal || amountNet + vatAmount,
        description: data.description || doc.filename,
        driveFileId: doc.driveFileId,
        createdById: userId,
        items: {
          create: items.map(i => ({
            description: i.description || data.description || doc.filename,
            qty: toNumber(i.qty) || 1,
            unitPrice: toNumber(i.unitPrice),
            vatPct: toNumber(i.vatPct),
            total: (toNumber(i.qty) || 1) * toNumber(i.unitPrice) * (1 + (toNumber(i.vatPct) || 0) / 100),
          })),
        },
      },
    });
  }

  await prisma.alert.updateMany({
    where: { documentId: doc.id, status: { in: ['ACTIVE', 'SNOOZED'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      status: 'LINKED',
      extractedData: data,
      reviewedById: userId,
      reviewedAt: new Date(),
      processedAt: new Date(),
    },
  });

  return { document: updated, created };
}

module.exports = { analyzeDocument, reviewDocument, calculateTotals };
