/**
 * 2026-07-08 audit: fix wrong docDate on active INVOICE_IN BizDocuments using MinerU-only re-parse.
 * Targets:
 *   A) active docs with default date 2025-01-01 (migrated from Purchase with missing date)
 *   B) active docs with impossible dates (< 2024-01-01)
 * PDF source: BizDocument.sourceFile, or the migrated Purchase.driveFileId from notes,
 * or a SourceFile matched by filename hint in notes.
 * Safety: date is updated ONLY if the parsed amount matches the doc amount (±5%) or the
 * parsed invoice number matches, and the parsed date is within 2023-01-01..2026-12-31.
 * Dry run by default; --apply to write. --limit N to cap.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

process.env.MINERU_ENABLED = 'true';
process.env.MINERU_ONLY = 'true';
process.env.DISABLE_GEMINI_EXTRACTION = 'true';
process.env.DISABLE_GROQ_EXTRACTION = 'true';
process.env.DISABLE_OPENROUTER_EXTRACTION = 'true';
process.env.DISABLE_OPENAI_EXTRACTION = 'true';
process.env.MINERU_BACKEND = process.env.MINERU_BACKEND || 'pipeline';
process.env.MINERU_TIMEOUT_MS = process.env.MINERU_TIMEOUT_MS || '180000';
const localMineru = path.resolve(__dirname, '../../.venv-mineru/Scripts/mineru.exe');
if (!process.env.MINERU_COMMAND && fs.existsSync(localMineru)) process.env.MINERU_COMMAND = localMineru;

const { parseDocumentWithAI, downloadDriveFile } = require('../src/lib/aiParser');
const { google } = require('googleapis');
const prisma = new PrismaClient();

function getGmail() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function collectParts(payload, result = []) {
  if (!payload) return result;
  if (payload.filename && payload.body?.attachmentId) result.push(payload);
  for (const p of (payload.parts || [])) collectParts(p, result);
  return result;
}

async function downloadGmailByMsgId(gmail, gmailMsgId, filename) {
  const messageId = String(gmailMsgId || '').split(':')[0];
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const parts = collectParts(msg.data.payload);
  const part = parts.find(p => p.filename && p.filename.toLowerCase() === String(filename).toLowerCase());
  if (!part?.body?.attachmentId) throw new Error(`Attachment not found: ${filename}`);
  const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: part.body.attachmentId });
  const base64 = (res.data.data || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

const APPLY = process.argv.includes('--apply');
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity;

const MIN_DATE = new Date('2023-01-01');
const MAX_DATE = new Date('2026-12-31');

function amountClose(a, b, tolPct = 0.05) {
  if (a == null || b == null) return false;
  const x = Number(a), y = Number(b);
  if (!x || !y) return false;
  return Math.abs(x - y) / Math.max(x, y) <= tolPct;
}

async function resolvePdf(doc) {
  // 1) direct source file
  if (doc.sourceFile?.driveFileId) return { kind: 'drive', id: doc.sourceFile.driveFileId, label: doc.sourceFile.filename };
  // 2) migrated Purchase → driveFileId
  const m = (doc.notes || '').match(/Мигрирано от Purchase (\w+)/);
  if (m) {
    const pur = await prisma.purchase.findUnique({ where: { id: m[1] }, select: { driveFileId: true, invoiceNo: true } });
    if (pur?.driveFileId) return { kind: 'drive', id: pur.driveFileId, label: `purchase:${pur.invoiceNo}` };
  }
  // 3) filename hint in notes ("PDF: xxx.pdf" or "| filename.pdf")
  const fm = (doc.notes || '').match(/PDF:\s*([^|]+\.pdf)/i) || (doc.notes || '').match(/\|\s*([^|]+\.pdf)\s*$/i);
  if (fm) {
    const fname = fm[1].trim();
    const sf = await prisma.sourceFile.findFirst({
      where: { filename: { equals: fname, mode: 'insensitive' }, OR: [{ driveFileId: { not: null } }, { gmailMsgId: { not: null } }] },
      orderBy: { driveFileId: { sort: 'desc', nulls: 'last' } },
    });
    if (sf?.driveFileId) return { kind: 'drive', id: sf.driveFileId, label: sf.filename };
    if (sf?.gmailMsgId) return { kind: 'gmail', id: sf.gmailMsgId, filename: sf.filename, label: sf.filename };
  }
  return null;
}

async function main() {
  console.log(`=== MinerU date fix ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const targets = await prisma.bizDocument.findMany({
    where: {
      docType: 'INVOICE_IN',
      status: { in: ['MATCHED', 'REVIEWED'] },
      OR: [{ docDate: new Date('2025-01-01') }, { docDate: { lt: new Date('2024-01-01') } }],
    },
    select: {
      id: true, docNumber: true, docDate: true, amountTotal: true, currency: true, notes: true,
      sourceFile: { select: { driveFileId: true, filename: true } },
    },
    orderBy: { docDate: 'asc' },
  });
  console.log(`Targets: ${targets.length}`);

  const gmail = getGmail();
  const stats = { fixed: 0, noPdf: 0, parseFail: 0, noSafeDate: 0, sameDate: 0 };
  let n = 0;
  for (const doc of targets) {
    if (n >= LIMIT) break;
    n++;
    const tag = `${doc.id.slice(0, 12)} #${doc.docNumber || '?'} ${doc.currency} ${doc.amountTotal} (${doc.docDate?.toISOString().slice(0, 10)})`;
    const pdf = await resolvePdf(doc);
    if (!pdf) { stats.noPdf++; console.log(`NO-PDF   ${tag}`); continue; }
    try {
      const buffer = pdf.kind === 'gmail'
        ? await downloadGmailByMsgId(gmail, pdf.id, pdf.filename)
        : await downloadDriveFile(pdf.id);
      const parsed = await parseDocumentWithAI(pdf.label || 'doc.pdf', '', buffer);
      const pd = parsed.docDate ? new Date(parsed.docDate) : null;
      const dateOk = pd && !Number.isNaN(pd.getTime()) && pd >= MIN_DATE && pd <= MAX_DATE;
      const evidence = amountClose(parsed.amountTotal, doc.amountTotal)
        || (parsed.invoiceNo && doc.docNumber && (parsed.invoiceNo === doc.docNumber || parsed.invoiceNo.includes(doc.docNumber) || doc.docNumber.includes(parsed.invoiceNo)));
      if (!dateOk || !evidence) {
        stats.noSafeDate++;
        console.log(`UNSAFE   ${tag} → parsed date=${parsed.docDate || '-'} amt=${parsed.amountTotal || '-'} no=${parsed.invoiceNo || '-'} (evidence=${!!evidence})`);
        continue;
      }
      if (doc.docDate && pd.toISOString().slice(0, 10) === doc.docDate.toISOString().slice(0, 10)) {
        stats.sameDate++;
        console.log(`SAME     ${tag}`);
        continue;
      }
      console.log(`FIX      ${tag} → ${pd.toISOString().slice(0, 10)} [amt=${parsed.amountTotal} no=${parsed.invoiceNo}]`);
      stats.fixed++;
      if (APPLY) {
        await prisma.bizDocument.update({
          where: { id: doc.id },
          data: {
            docDate: pd,
            notes: `${doc.notes ? doc.notes + ' | ' : ''}date fixed 2026-07-08 MinerU (was ${doc.docDate?.toISOString().slice(0, 10)})`.slice(0, 1000),
          },
        });
      }
    } catch (err) {
      stats.parseFail++;
      console.log(`FAIL     ${tag}: ${String(err.message).slice(0, 140)}`);
    }
  }
  console.log('\n=== DONE ===', JSON.stringify(stats));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
