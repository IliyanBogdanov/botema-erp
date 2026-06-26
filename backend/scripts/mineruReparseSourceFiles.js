/**
 * Re-parse PDF source files through the main parser with MinerU enabled.
 *
 * Safe defaults:
 * - dry-run unless --apply is passed
 * - only writes Document.extractedData with --apply
 * - only writes/updates BizDocument rows with --apply-bizdocs
 *
 * Usage:
 *   node scripts/mineruReparseSourceFiles.js --limit 5
 *   node scripts/mineruReparseSourceFiles.js --apply --limit 20
 *   node scripts/mineruReparseSourceFiles.js --apply --apply-bizdocs --only-missing --limit 100
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { Prisma, PrismaClient } = require('@prisma/client');
const { parseDocumentWithAI, downloadDriveFile } = require('../src/lib/aiParser');

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const APPLY_BIZDOCS = process.argv.includes('--apply-bizdocs');
const CREATE_NEW_BIZDOCS = process.argv.includes('--create-new-bizdocs');
const ONLY_MISSING = process.argv.includes('--only-missing');
const INCLUDE_PROCESSED = process.argv.includes('--include-processed');
const REPARSE_MINERU = process.argv.includes('--reparse-mineru');

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const POSITIONAL = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const LIMIT_ARG = argValue('--limit', POSITIONAL[0] || '10');
const SOURCE = String(argValue('--source', POSITIONAL[1] || 'all')).toUpperCase(); // DRIVE | GMAIL | all
const MIN_CONFIDENCE = Number(argValue('--min-confidence', '70'));
const LIMIT = Number(LIMIT_ARG);
const EFFECTIVE_LIMIT = Number.isFinite(LIMIT) && LIMIT > 0 ? LIMIT : 10;

function configureMineruDefaults() {
  process.env.MINERU_ENABLED = process.env.MINERU_ENABLED || 'true';
  process.env.MINERU_BACKEND = process.env.MINERU_BACKEND || 'pipeline';
  process.env.MINERU_METHOD = process.env.MINERU_METHOD || 'auto';
  process.env.MINERU_TIMEOUT_MS = process.env.MINERU_TIMEOUT_MS || '900000';

  const localMineru = path.resolve(__dirname, '../../.venv-mineru/Scripts/mineru.exe');
  if (!process.env.MINERU_COMMAND && fs.existsSync(localMineru)) {
    process.env.MINERU_COMMAND = localMineru;
  }
}

function getAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

function collectParts(payload, result = []) {
  if (!payload) return result;
  if (payload.filename && payload.body?.attachmentId) result.push(payload);
  for (const p of (payload.parts || [])) collectParts(p, result);
  return result;
}

function parseGmailMsgId(gmailMsgId) {
  const raw = String(gmailMsgId || '');
  if (raw.includes(':')) {
    const parts = raw.split(':');
    return { messageId: parts[0], attachmentId: parts[1] || null };
  }
  if (raw.length >= 17) {
    return { messageId: raw.substring(0, 16), attachmentId: raw.substring(17) || null };
  }
  return { messageId: raw, attachmentId: null };
}

function docKeyForSourceFile(sourceFile) {
  if (sourceFile.type === 'DRIVE') return sourceFile.driveFileId || null;
  if (sourceFile.type === 'GMAIL') {
    const { messageId } = parseGmailMsgId(sourceFile.gmailMsgId);
    return messageId ? `gmail:${messageId}:${sourceFile.filename}` : null;
  }
  return null;
}

async function downloadGmailAttachment(gmail, sourceFile) {
  const { messageId, attachmentId } = parseGmailMsgId(sourceFile.gmailMsgId);
  if (!messageId) throw new Error('Missing Gmail message id');

  if (attachmentId) {
    try {
      const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
      const base64 = (res.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
      return { buffer: Buffer.from(base64, 'base64'), messageId };
    } catch (_) {
      // Attachment ids can expire; fall back to looking up the live message.
    }
  }

  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const parts = collectParts(msg.data.payload);
  const part = parts.find(p => p.filename === sourceFile.filename)
    || parts.find(p => p.filename && p.filename.toLowerCase() === sourceFile.filename.toLowerCase());
  if (!part?.body?.attachmentId) throw new Error(`Attachment not found in Gmail message: ${sourceFile.filename}`);

  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: part.body.attachmentId,
  });
  const base64 = (res.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
  return { buffer: Buffer.from(base64, 'base64'), messageId };
}

function toDocumentType(docType) {
  if (docType === 'INVOICE_IN') return 'INVOICE_IN';
  if (docType === 'INVOICE_OUT') return 'INVOICE_OUT';
  if (docType === 'PROFORMA' || docType === 'PROFORMA_IN' || docType === 'PROFORMA_OUT') return 'PROFORMA';
  if (docType === 'DELIVERY_NOTE' || docType === 'DELIVERY') return 'DELIVERY';
  return 'OTHER';
}

function toBizDocType(parsed, sourceFile) {
  const type = parsed.docType || parsed.type;
  if (type === 'INVOICE_IN') return 'INVOICE_IN';
  if (type === 'INVOICE_OUT') return 'INVOICE_OUT';
  if (type === 'PROFORMA_IN') return 'PROFORMA_IN';
  if (type === 'PROFORMA_OUT') return 'PROFORMA_OUT';
  if (type === 'PROFORMA') {
    const text = `${sourceFile.folder || ''} ${sourceFile.fromEmail || ''}`.toLowerCase();
    return text.includes('изход') || text.includes('outgoing') ? 'PROFORMA_OUT' : 'PROFORMA_IN';
  }
  if (type === 'OFFER') return 'OFFER_IN';
  if (type === 'DELIVERY_NOTE' || type === 'DELIVERY') return 'DELIVERY_NOTE';
  return 'OTHER';
}

function asDate(value, fallback = null) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function asDecimal(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return new Prisma.Decimal(numeric);
}

async function findOrCreateCounterparty(name, type = 'SUPPLIER') {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: clean, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY || !APPLY_BIZDOCS) return null;
  const created = await prisma.counterparty.create({
    data: { name: clean, type, country: 'BG', currency: 'EUR' },
    select: { id: true },
  });
  return created.id;
}

function shouldImprove(existing, parsed) {
  if (!existing) return true;
  if (!existing.sourceFileId) return true;
  if (!existing.amountTotal && parsed.amountTotal) return true;
  if (!existing.docNumber && parsed.invoiceNo) return true;
  if (!existing.docDate && parsed.docDate) return true;
  if (!existing.currency && parsed.currency) return true;
  return false;
}

function amountClose(a, b, tolerance = 0.05) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
}

async function upsertDocument(sourceFile, parsed, docKey) {
  const data = {
    driveFileId: docKey,
    driveUrl: sourceFile.driveUrl || '',
    filename: sourceFile.filename,
    type: toDocumentType(parsed.docType || parsed.type),
    status: 'PENDING',
    extractedData: {
      ...parsed,
      sourceFileId: sourceFile.id,
      sourceType: sourceFile.type,
      folder: sourceFile.folder,
      subject: sourceFile.subject,
      fromEmail: sourceFile.fromEmail,
      mineruReparsedAt: new Date().toISOString(),
    },
    confidence: new Prisma.Decimal(Math.min(Number(parsed.confidence || 0), 100) / 100),
    suggestedAction: parsed.docType === 'INVOICE_IN' ? 'CREATE_PURCHASE' : 'ARCHIVE_ONLY',
  };

  const existing = await prisma.document.findUnique({ where: { driveFileId: docKey }, select: { id: true } });
  if (!APPLY) return existing ? 'would-update' : 'would-create';
  if (existing) {
    await prisma.document.update({ where: { id: existing.id }, data });
    return 'updated';
  }
  await prisma.document.create({ data });
  return 'created';
}

async function upsertBizDocument(sourceFile, parsed) {
  if (!APPLY_BIZDOCS) return 'skipped';

  const confidence = Number(parsed.confidence || 0);
  const amountTotal = asDecimal(parsed.amountTotal);
  const bizDocType = toBizDocType(parsed, sourceFile);
  if (!['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA_IN', 'PROFORMA_OUT', 'DELIVERY_NOTE'].includes(bizDocType)) return 'not-business';
  if (confidence < MIN_CONFIDENCE || !amountTotal) return 'low-confidence';

  const counterpartyId = await findOrCreateCounterparty(
    parsed.supplierName || parsed.clientName || parsed.counterpartyName,
    bizDocType.endsWith('_OUT') ? 'CLIENT' : 'SUPPLIER'
  );

  let existing = await prisma.bizDocument.findFirst({
    where: { sourceFileId: sourceFile.id },
  });
  if (!existing && parsed.invoiceNo) {
    const candidates = await prisma.bizDocument.findMany({
      where: {
        docType: bizDocType,
        docNumber: parsed.invoiceNo,
        status: { notIn: ['REJECTED', 'ARCHIVED'] },
      },
      take: 5,
    });
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const amountMatches = amountClose(candidate.amountTotal, parsed.amountTotal);
      const dateMatches = parsed.docDate ? sameDay(candidate.docDate, parsed.docDate) : true;
      if (amountMatches || dateMatches || !candidate.amountTotal || !candidate.docDate) {
        existing = candidate;
      } else {
        return 'conflict';
      }
    } else if (candidates.length > 1) {
      return 'ambiguous';
    }
  }

  const baseData = {
    sourceFileId: sourceFile.id,
    counterpartyId,
    docType: bizDocType,
    docNumber: parsed.invoiceNo || null,
    docDate: asDate(parsed.docDate, sourceFile.receivedAt || new Date()),
    dueDate: asDate(parsed.dueDate),
    currency: parsed.currency || 'EUR',
    amountNet: asDecimal(parsed.amountNet),
    vatAmount: asDecimal(parsed.vatAmount),
    amountTotal,
    status: existing?.status || 'NEEDS_REVIEW',
    confidence: new Prisma.Decimal(confidence),
    notes: [
      existing?.notes,
      `MinerU reparse ${new Date().toISOString()}: ${sourceFile.type} ${sourceFile.filename}`.slice(0, 180),
    ].filter(Boolean).join(' | ').slice(0, 1000),
  };

  if (!APPLY) return existing ? 'would-update' : 'would-create';

  if (existing) {
    if (!shouldImprove(existing, parsed)) return 'unchanged';
    const updateData = {
      sourceFileId: existing.sourceFileId || sourceFile.id,
      counterpartyId: existing.counterpartyId || counterpartyId,
      docNumber: existing.docNumber || baseData.docNumber,
      docDate: existing.docDate || baseData.docDate,
      dueDate: existing.dueDate || baseData.dueDate,
      currency: existing.currency || baseData.currency,
      amountNet: existing.amountNet || baseData.amountNet,
      vatAmount: existing.vatAmount || baseData.vatAmount,
      amountTotal: existing.amountTotal || baseData.amountTotal,
      confidence: existing.confidence || baseData.confidence,
      notes: baseData.notes,
    };
    await prisma.bizDocument.update({ where: { id: existing.id }, data: updateData });
    return 'updated';
  }

  if (!CREATE_NEW_BIZDOCS) return 'would-create-blocked';
  await prisma.bizDocument.create({ data: baseData });
  return 'created';
}

async function getSourceFiles() {
  const where = {
    OR: [
      { filename: { endsWith: '.pdf', mode: 'insensitive' } },
      { mimeType: { contains: 'pdf', mode: 'insensitive' } },
    ],
    ...(SOURCE === 'DRIVE' || SOURCE === 'GMAIL' ? { type: SOURCE } : {}),
    ...(SOURCE === 'DRIVE' ? { driveFileId: { not: null } } : {}),
    ...(SOURCE === 'GMAIL' ? { gmailMsgId: { not: null } } : {}),
    ...(INCLUDE_PROCESSED ? {} : { processedAt: null }),
  };
  if (SOURCE === 'ALL') {
    where.AND = [{
      OR: [
        { type: 'DRIVE', driveFileId: { not: null } },
        { type: 'GMAIL', gmailMsgId: { not: null } },
      ],
    }];
  }

  const rows = await prisma.sourceFile.findMany({
    where,
    orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
    take: EFFECTIVE_LIMIT * 10,
  });

  const downloadable = rows;
  let candidates = downloadable;

  if (!REPARSE_MINERU) {
    const keys = candidates.map(docKeyForSourceFile).filter(Boolean);
    const alreadyParsed = keys.length ? await prisma.document.findMany({
      where: {
        driveFileId: { in: keys },
        extractedData: { path: ['mineruReparsedAt'], not: null },
      },
      select: { driveFileId: true },
    }) : [];
    const parsedKeys = new Set(alreadyParsed.map(d => d.driveFileId));
    candidates = candidates.filter(row => !parsedKeys.has(docKeyForSourceFile(row)));
  }

  if (!ONLY_MISSING) return candidates.slice(0, EFFECTIVE_LIMIT);

  const result = [];
  for (const row of candidates) {
    const biz = await prisma.bizDocument.findFirst({ where: { sourceFileId: row.id } });
    if (!biz || !biz.amountTotal || !biz.docNumber || !biz.docDate) result.push(row);
    if (result.length >= EFFECTIVE_LIMIT) break;
  }
  return result;
}

async function main() {
  configureMineruDefaults();

  console.log(`=== MinerU SourceFile reparse ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  console.log({
    source: SOURCE,
    limit: EFFECTIVE_LIMIT,
    onlyMissing: ONLY_MISSING,
    includeProcessed: INCLUDE_PROCESSED,
    reparseMineru: REPARSE_MINERU,
    applyBizDocs: APPLY_BIZDOCS,
    createNewBizDocs: CREATE_NEW_BIZDOCS,
    mineruCommand: process.env.MINERU_COMMAND || 'mineru',
    mineruBackend: process.env.MINERU_BACKEND,
    mineruMethod: process.env.MINERU_METHOD,
  });

  const gmail = google.gmail({ version: 'v1', auth: getAuth() });
  const files = await getSourceFiles();
  console.log(`Found ${files.length} source files to parse`);

  const stats = { parsed: 0, failed: 0, document: {}, bizDocument: {} };

  for (const sf of files) {
    const label = `${sf.type} ${sf.filename}`;
    try {
      console.log(`\n→ ${label}`);
      let buffer;
      let docKey;
      if (sf.type === 'DRIVE') {
        if (!sf.driveFileId) throw new Error('Missing driveFileId');
        buffer = await downloadDriveFile(sf.driveFileId);
        docKey = sf.driveFileId;
      } else if (sf.type === 'GMAIL') {
        const downloaded = await downloadGmailAttachment(gmail, sf);
        buffer = downloaded.buffer;
        docKey = `gmail:${downloaded.messageId}:${sf.filename}`;
      } else {
        throw new Error(`Unsupported source type: ${sf.type}`);
      }

      const parsed = await parseDocumentWithAI(sf.filename, sf.folder || sf.subject || '', buffer);
      const docAction = await upsertDocument(sf, parsed, docKey);
      const bizAction = await upsertBizDocument(sf, parsed);

      if (APPLY) {
        await prisma.sourceFile.update({ where: { id: sf.id }, data: { processedAt: new Date() } });
      }

      stats.parsed++;
      stats.document[docAction] = (stats.document[docAction] || 0) + 1;
      stats.bizDocument[bizAction] = (stats.bizDocument[bizAction] || 0) + 1;
      console.log(`  ${parsed.docType || parsed.type || '?'} #${parsed.invoiceNo || '?'} ${parsed.amountTotal || '?'} ${parsed.currency || ''} conf=${parsed.confidence || '?'} doc=${docAction} biz=${bizAction}`);
    } catch (err) {
      stats.failed++;
      console.error(`  FAILED ${label}: ${err.message}`);
    }
  }

  console.log('\n=== DONE ===');
  console.log(JSON.stringify(stats, null, 2));
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
