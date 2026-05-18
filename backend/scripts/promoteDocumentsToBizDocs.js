require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const { isBeyondLastIssuedOutgoingInvoice, getLastIssuedOutgoingInvoiceNo } = require('../src/lib/outgoingInvoicePolicy');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const toNumber = value => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const norm = value => String(value || '').trim();

function inferBizDocType(doc, data) {
  const type = data.type || data.docType || doc.type;
  const text = `${doc.filename || ''} ${data.description || ''} ${data.supplierName || ''}`.toLowerCase();
  const incomingHints = ['ap202', 'pi ap', 'ci ap', 'alphaluce', 'lodes', 'invoice-', 'faktura_', 'фактура', 'ftv_', 'orv_'];
  const outgoingHints = ['for-operation', 'operation-sale', 'micro.bg', '1717.'];

  if (type === 'INVOICE_OUT') return 'INVOICE_OUT';
  if (type === 'INVOICE_IN' || type === 'DELIVERY') return type === 'DELIVERY' ? 'DELIVERY_NOTE' : 'INVOICE_IN';
  if (type === 'PROFORMA') {
    if (incomingHints.some(h => text.includes(h))) return 'PROFORMA_IN';
    if (outgoingHints.some(h => text.includes(h))) return 'PROFORMA_OUT';
    return 'PROFORMA_OUT';
  }
  return 'OTHER';
}

async function findOrCreateCounterparty(docType, data) {
  const rawName = norm(data.supplierName || data.clientName || data.supplierOrBankName);
  if (!rawName) return null;
  const type = ['INVOICE_OUT', 'PROFORMA_OUT', 'OFFER_OUT'].includes(docType) ? 'CLIENT' : 'SUPPLIER';
  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: rawName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;
  const created = await prisma.counterparty.create({
    data: { name: rawName, type, country: 'BG', currency: data.currency || 'BGN' },
    select: { id: true },
  });
  return created.id;
}

async function main() {
  console.log(`=== PROMOTE DOCUMENTS TO BIZDOCS${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);
  const docs = await prisma.document.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  let created = 0, skipped = 0, archived = 0, linkedExisting = 0;

  for (const doc of docs) {
    const data = doc.extractedData || {};
    const docNumber = norm(data.invoiceNo || data.docNumber);
    const docDateRaw = data.date || data.docDate;
    const amountTotal = toNumber(data.amountTotal ?? data.amount);
    const currency = norm(data.currency || 'BGN').toUpperCase();
    const confidence = Number(doc.confidence || data.confidence || 0);
    const bizDocType = inferBizDocType(doc, data);

    const isSupportOnly = data.nonFinancial || bizDocType === 'OTHER' || doc.suggestedAction === 'ARCHIVE_ONLY';
    const beyondConfirmedOutgoing =
      bizDocType === 'INVOICE_OUT' && isBeyondLastIssuedOutgoingInvoice(docNumber);

    if (beyondConfirmedOutgoing) {
      if (APPLY) {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            status: 'PROCESSED',
            suggestedAction: 'ARCHIVE_ONLY',
            processedAt: new Date(),
            extractedData: {
              ...data,
              rejectedReason: `Outgoing invoice number is beyond confirmed last issued invoice #${getLastIssuedOutgoingInvoiceNo()}`,
            },
          },
        });
      }
      archived++;
      continue;
    }

    if (isSupportOnly && (!docNumber || !amountTotal || confidence < 90)) {
      if (APPLY) {
        await prisma.document.update({
          where: { id: doc.id },
          data: { status: 'PROCESSED', suggestedAction: 'ARCHIVE_ONLY', processedAt: new Date() },
        });
      }
      archived++;
      continue;
    }

    if (!docNumber || !docDateRaw || !amountTotal || !currency || confidence < 90) {
      skipped++;
      continue;
    }

    const docDate = new Date(docDateRaw);
    if (Number.isNaN(docDate.getTime())) {
      skipped++;
      continue;
    }

    const existing = await prisma.bizDocument.findFirst({
      where: {
        docType: bizDocType,
        docNumber,
        currency,
        amountTotal: { gte: amountTotal - 0.01, lte: amountTotal + 0.01 },
      },
      select: { id: true },
    });

    if (existing) {
      if (APPLY) {
        await prisma.document.update({
          where: { id: doc.id },
          data: { status: 'LINKED', processedAt: new Date(), extractedData: { ...data, bizDocumentId: existing.id } },
        });
      }
      linkedExisting++;
      continue;
    }

    const counterpartyId = await findOrCreateCounterparty(bizDocType, data);
    const sourceFile = doc.driveFileId
      ? await prisma.sourceFile.findFirst({ where: { driveFileId: doc.driveFileId }, select: { id: true } })
      : null;

    if (APPLY) {
      const bizDoc = await prisma.bizDocument.create({
        data: {
          docType: bizDocType,
          docNumber,
          docDate,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          currency,
          amountNet: toNumber(data.amountNet ?? data.amount),
          vatAmount: toNumber(data.vatAmount),
          amountTotal,
          vatType: currency === 'BGN' ? 'STANDARD_BG' : 'EU_INTRA',
          status: 'REVIEWED',
          confidence,
          counterpartyId: counterpartyId || undefined,
          sourceFileId: sourceFile?.id || undefined,
          notes: `Promoted from Document ${doc.id}: ${doc.filename}`,
        },
      });
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: 'LINKED', processedAt: new Date(), extractedData: { ...data, bizDocumentId: bizDoc.id } },
      });
      if (sourceFile) {
        await prisma.sourceFile.update({ where: { id: sourceFile.id }, data: { processedAt: new Date() } });
      }
    }
    created++;
  }

  console.log({ created, linkedExisting, archived, skipped });
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
