/**
 * 2026-07-09: AI processing of NEEDS_REVIEW INVOICE_IN docs (missing counterparty).
 * FREE requests only: Gemini free tier (direct PDF) → Groq → OpenRouter :free.
 * OPENAI_API_KEY is stripped from env so the paid gpt-4o-mini fallback can never fire.
 *
 * Per doc: download the source PDF, parse with AI, then:
 *  - not an invoice (proforma/offer/delivery/price list, conf ≥60) → ARCHIVED
 *  - duplicate of an active doc (same CP + amount + close date, or number+amount) → REJECTED
 *  - counterparty resolved + amount + conf ≥70 → REVIEWED (fields filled from parse)
 *  - otherwise stays NEEDS_REVIEW with whatever fields could be filled
 *
 * Dry run by default; --apply to write; --limit N.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
delete process.env.OPENAI_API_KEY;      // никакви платени заявки
delete process.env.ANTHROPIC_API_KEY;   // не се ползва от парсера, но за всеки случай
process.env.MINERU_ENABLED = 'false';   // директен Gemini PDF parse — по-бърз и по-точен

const { Prisma, PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const { parseDocumentWithAI, downloadDriveFile } = require('../src/lib/aiParser');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity;
const THROTTLE_MS = 7000; // Gemini free tier ~10 RPM

function getGmail() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function collectParts(payload, result = []) {
  if (!payload) return result;
  if (payload.filename && payload.body?.attachmentId) result.push(payload);
  for (const p of (payload.parts || [])) collectParts(p, result);
  return result;
}

async function downloadGmail(gmail, sf) {
  // gmailMsgId format: "<messageId(16 hex)>-<attachmentId>"; attachment ids expire,
  // so always re-fetch the live message and find the part by filename.
  const raw = String(sf.gmailMsgId || '');
  const messageId = raw.includes(':') ? raw.split(':')[0] : raw.substring(0, 16);
  const msg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const parts = collectParts(msg.data.payload);
  const part = parts.find(p => p.filename && p.filename.toLowerCase() === String(sf.filename).toLowerCase());
  if (!part?.body?.attachmentId) throw new Error(`Attachment not found: ${sf.filename}`);
  const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: part.body.attachmentId });
  return Buffer.from((res.data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(еоод|оод|ад|ет|ltd|gmbh|s\.?r\.?l\.?|spa|s\.?p\.?a\.?|inc|llc|b\.?v\.?|sn|srl|co)\b/gi, '')
    .replace(/[^\wа-я\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? inter / union : 0;
}

function isGarbageName(name) {
  const n = String(name || '').trim();
  if (n.length < 3) return true;
  if (/^[\d\s\-./#]+$/.test(n)) return true;
  if (/unknown|непознат|n\/a|#|country|coo\./i.test(n)) return true;
  return false;
}

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dec = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : new Prisma.Decimal(Number(v));
const asDate = v => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

async function resolveCounterparty(allCps, name) {
  if (isGarbageName(name)) return null;
  let best = null, bestSim = 0;
  for (const cp of allCps) {
    const sim = similarity(cp.name, name);
    if (sim > bestSim) { bestSim = sim; best = cp; }
  }
  if (best && bestSim >= 0.85) return { id: best.id, name: best.name, created: false };
  if (!APPLY) return { id: null, name: String(name).trim(), created: true };
  const created = await prisma.counterparty.create({
    data: { name: String(name).trim(), type: 'SUPPLIER', country: 'BG', currency: 'EUR' },
    select: { id: true, name: true },
  });
  allCps.push(created);
  return { id: created.id, name: created.name, created: true };
}

async function main() {
  console.log(`=== AI fill NEEDS_REVIEW ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const docs = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: 'NEEDS_REVIEW', sourceFileId: { not: null } },
    include: { sourceFile: true },
    orderBy: { docDate: 'desc' },
  });
  console.log(`Targets: ${docs.length} (limit ${LIMIT})`);

  const allCps = await prisma.counterparty.findMany({ select: { id: true, name: true } });
  const gmail = getGmail();
  const stats = { reviewed: 0, archived: 0, rejected: 0, stillReview: 0, failed: 0, cpCreated: 0 };
  let n = 0;

  for (const doc of docs) {
    if (n >= LIMIT) break;
    n++;
    const sf = doc.sourceFile;
    const tag = `${doc.id.slice(0, 12)} ${doc.currency} ${doc.amountTotal} #${doc.docNumber || '?'} [${sf.type}] ${String(sf.filename).slice(0, 40)}`;
    try {
      const buffer = sf.type === 'GMAIL' ? await downloadGmail(gmail, sf) : await downloadDriveFile(sf.driveFileId);
      const parsed = await parseDocumentWithAI(sf.filename, sf.folder || sf.subject || '', buffer);
      const conf = num(parsed.confidence);
      const pType = parsed.docType || parsed.type || '?';
      const pName = parsed.supplierName || parsed.counterpartyName || '';
      const pAmt = num(parsed.amountTotal);

      // 0) Собствена изходяща фактура (наша серия 0000000xxx / For-Operation export) —
      //    не е разход; маркирай за приходен импорт
      const ownSeries = /^0000000\d{2,3}$/.test(String(parsed.invoiceNo || '')) || /For-Operation-(Sale|Advance)/i.test(String(sf.filename || ''));
      const ownCp = /студио ботема|luminavera|луминавера/i.test(String(pName || ''));
      if (ownSeries || ownCp) {
        stats.stillReview++;
        console.log(`OWN-OUT  ${tag} → наша изходяща фактура #${parsed.invoiceNo || '?'}, не разход`);
        if (APPLY) await prisma.bizDocument.update({ where: { id: doc.id }, data: { docType: 'INVOICE_OUT', status: 'NEEDS_REVIEW', notes: `${doc.notes ? doc.notes + ' | ' : ''}2026-07-09 AI: изходяща фактура (наша серия), кандидат за приходен импорт`.slice(0, 1000) } });
        await new Promise(r => setTimeout(r, THROTTLE_MS));
        continue;
      }

      // 1) Не е фактура → архив
      if (!['INVOICE_IN', 'INVOICE'].includes(pType) && conf >= 60) {
        stats.archived++;
        console.log(`ARCHIVE  ${tag} → parse: ${pType} conf=${conf}`);
        if (APPLY) await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'ARCHIVED', notes: `${doc.notes ? doc.notes + ' | ' : ''}ARCHIVED 2026-07-09 AI: parse=${pType} conf=${conf} (не е входяща фактура)`.slice(0, 1000) } });
        await new Promise(r => setTimeout(r, THROTTLE_MS));
        continue;
      }

      const cp = await resolveCounterparty(allCps, pName);
      if (cp?.created) stats.cpCreated++;

      const amountTotal = pAmt || num(doc.amountTotal);
      const currency = parsed.currency || doc.currency;
      const docDate = asDate(parsed.docDate) || doc.docDate;
      const docNumber = parsed.invoiceNo || doc.docNumber;

      // 2) Дубликат на активен документ?
      let dup = null;
      if (cp?.id && amountTotal) {
        const candidates = await prisma.bizDocument.findMany({
          where: {
            id: { not: doc.id },
            docType: 'INVOICE_IN',
            status: { in: ['MATCHED', 'REVIEWED', 'IMPORTED'] },
            OR: [
              { counterpartyId: cp.id, amountTotal, currency },
              ...(docNumber ? [{ docNumber, amountTotal }] : []),
            ],
          },
          select: { id: true, docNumber: true, docDate: true },
        });
        dup = candidates.find(c => !docDate || !c.docDate || Math.abs(new Date(c.docDate) - new Date(docDate)) < 40 * 864e5) || null;
      }
      if (dup) {
        stats.rejected++;
        console.log(`REJECT   ${tag} → дубликат на активен ${dup.id.slice(0, 12)} #${dup.docNumber}`);
        if (APPLY) await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'REJECTED', counterpartyId: cp.id, notes: `${doc.notes ? doc.notes + ' | ' : ''}REJECTED 2026-07-09 AI: дубликат на ${dup.id} #${dup.docNumber}`.slice(0, 1000) } });
        await new Promise(r => setTimeout(r, THROTTLE_MS));
        continue;
      }

      // 3) Попълване + евентуално промотиране.
      // Sanity: суми над 100K EUR екв. са почти сигурно parse грешка (номер като сума) —
      // никога не се промотират автоматично.
      const amountEurEq = currency === 'BGN' ? amountTotal / 1.95583 : currency === 'USD' ? amountTotal / 1.14 : amountTotal;
      const amountSane = amountEurEq > 0 && amountEurEq < 100000;
      const promote = cp?.id !== undefined && cp !== null && amountSane && conf >= 70;
      if (!amountSane && amountTotal) console.log(`INSANE   ${tag} → parsed amount ${amountTotal} ${currency} — не се промотира`);
      const data = {
        ...(cp ? { counterpartyId: cp.id } : {}),
        docNumber,
        docDate,
        dueDate: asDate(parsed.dueDate) || doc.dueDate,
        currency,
        amountNet: amountSane ? (dec(parsed.amountNet) ?? doc.amountNet) : doc.amountNet,
        vatAmount: amountSane ? (dec(parsed.vatAmount) ?? doc.vatAmount) : doc.vatAmount,
        amountTotal: amountSane ? (dec(amountTotal) ?? doc.amountTotal) : doc.amountTotal,
        confidence: dec(conf) ?? doc.confidence,
        status: promote ? 'REVIEWED' : 'NEEDS_REVIEW',
        notes: `${doc.notes ? doc.notes + ' | ' : ''}AI parse 2026-07-09: ${pType} @${cp?.name || 'NO-CP'} conf=${conf}${promote ? ' → REVIEWED' : ''}`.slice(0, 1000),
      };
      if (promote) stats.reviewed++; else stats.stillReview++;
      console.log(`${promote ? 'REVIEWED' : 'KEEP    '} ${tag} → @${cp?.name || 'NO-CP'} ${currency} ${amountTotal} #${docNumber || '?'} ${docDate ? new Date(docDate).toISOString().slice(0, 10) : '?'} conf=${conf}`);
      if (APPLY) await prisma.bizDocument.update({ where: { id: doc.id }, data });
    } catch (err) {
      stats.failed++;
      console.log(`FAIL     ${tag}: ${String(err.message).slice(0, 120)}`);
    }
    await new Promise(r => setTimeout(r, THROTTLE_MS));
  }

  console.log('\n=== DONE ===', JSON.stringify(stats));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
