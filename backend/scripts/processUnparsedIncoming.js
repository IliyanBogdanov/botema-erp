/**
 * 2026-07-09: Create BizDocuments for Drive SourceFiles that were scanned but
 * never parsed (Входящи фактури Apr-Jul 2026 в споделената папка).
 * Free AI chain only (Groq → OpenRouter). Same guards as aiFillNeedsReview:
 *  - own outgoing series → skipped (not a cost)
 *  - non-invoices (orders, payslips, packing lists, transactions) → skipped
 *  - duplicates of active docs → skipped
 *  - promote to REVIEWED only with counterparty + sane amount + conf ≥ 70,
 *    otherwise NEEDS_REVIEW
 * Dry run by default; --apply to write. --limit N.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
process.env.MINERU_ENABLED = 'false';

const { Prisma, PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const { parseDocumentWithAI, downloadDriveFile } = require('../src/lib/aiParser');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity;
const THROTTLE_MS = 4000;
const SHARED_ROOT = '1BnoBbHoYrEiPPgR3BeZcXIZ9RLaI6tph';

function getDrive() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
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
  return n.length < 3 || /^[\d\s\-./#]+$/.test(n) || /unknown|непознат|n\/a|#|country|coo\./i.test(n);
}
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dec = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : new Prisma.Decimal(Number(v));
const asDate = v => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };

// Clearly-not-an-invoice filenames — skip without burning an AI request
const SKIP_FILE = /^order_|packing|^pl for|^ci ap|рпв |ведомост|дължими вноски|транзакция|наличности|oferta|оферта|товарителница|consignment|extract|извлечение/i;

async function main() {
  console.log(`=== Unparsed incoming → BizDocuments ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const drive = getDrive();
  async function ls(id) { return (await drive.files.list({ q: `'${id}' in parents and trashed = false`, fields: 'files(id, name, mimeType)', pageSize: 200 })).data.files; }
  async function walk(id, path, out) {
    for (const f of await ls(id)) {
      if (f.mimeType.includes('folder')) await walk(f.id, `${path}/${f.name}`, out);
      else if (/\.pdf$/i.test(f.name)) out.push({ ...f, path });
    }
    return out;
  }
  const root = await ls(SHARED_ROOT);
  let all = [];
  for (const mon of ['Април', 'Май', 'Юни', 'Юли']) {
    const mdir = root.find(f => f.name === mon);
    if (!mdir) continue;
    const sub = await ls(mdir.id);
    const inDir = sub.find(f => /^входящи/i.test(f.name));
    if (inDir) await walk(inDir.id, `${mon}/${inDir.name}`, all);
  }
  const sfs = await prisma.sourceFile.findMany({
    where: {
      driveFileId: { in: all.map(f => f.id) },
      bizDocuments: { none: {} },
      NOT: { notes: { contains: '[SKIP_NOT_INVOICE]' } },
    },
    select: { id: true, driveFileId: true, filename: true, folder: true, receivedAt: true, notes: true },
  });
  console.log(`Без BizDocument: ${sfs.length} от ${all.length} PDF-а\n`);

  const allCps = await prisma.counterparty.findMany({ select: { id: true, name: true } });
  const stats = { reviewed: 0, needsReview: 0, skippedNonInvoice: 0, skippedDup: 0, skippedOwn: 0, failed: 0, cpCreated: 0 };
  let n = 0;

  for (const sf of sfs) {
    if (n >= LIMIT) break;
    n++;
    const tag = `${sf.filename.slice(0, 45)}`;
    try {
      if (SKIP_FILE.test(sf.filename)) {
        stats.skippedNonInvoice++;
        console.log(`SKIP-FILE ${tag} (очевидно не е фактура)`);
        continue;
      }
      const buffer = await downloadDriveFile(sf.driveFileId);
      const parsed = await parseDocumentWithAI(sf.filename, sf.folder || '', buffer);
      const conf = num(parsed.confidence);
      const pType = parsed.docType || parsed.type || '?';
      const pName = parsed.supplierName || '';
      const pAmt = num(parsed.amountTotal);
      const currency = parsed.currency || 'EUR';

      const ownSeries = /^0000000\d{2,3}$/.test(String(parsed.invoiceNo || '')) || /студио ботема|luminavera|луминавера/i.test(pName);
      // Tag non-invoices on the SourceFile so future runs skip them WITHOUT an AI call
      const tagSkip = async why => { if (APPLY) await prisma.sourceFile.update({ where: { id: sf.id }, data: { notes: `${sf.notes ? sf.notes + ' | ' : ''}[SKIP_NOT_INVOICE] ${why}`.slice(0, 900) } }); };
      if (ownSeries) { stats.skippedOwn++; console.log(`SKIP-OWN  ${tag} → наша фактура #${parsed.invoiceNo}`); await tagSkip('own outgoing'); await sleep(); continue; }
      if (!['INVOICE_IN', 'INVOICE'].includes(pType)) { stats.skippedNonInvoice++; console.log(`SKIP-TYPE ${tag} → ${pType} conf=${conf}`); await tagSkip(`parsed as ${pType}`); await sleep(); continue; }
      const amountEurEq = currency === 'BGN' ? pAmt / 1.95583 : currency === 'USD' ? pAmt / 1.14 : pAmt;
      if (!(amountEurEq > 0 && amountEurEq < 100000)) { stats.failed++; console.log(`INSANE    ${tag} → ${pAmt} ${currency}`); await sleep(); continue; }

      // counterparty
      let cp = null;
      if (!isGarbageName(pName)) {
        let best = null, bestSim = 0;
        for (const c of allCps) { const s = similarity(c.name, pName); if (s > bestSim) { bestSim = s; best = c; } }
        if (best && bestSim >= 0.85) cp = best;
        else if (APPLY) { cp = await prisma.counterparty.create({ data: { name: pName.trim(), type: 'SUPPLIER', country: 'BG', currency: 'EUR' }, select: { id: true, name: true } }); allCps.push(cp); stats.cpCreated++; }
        else cp = { id: null, name: pName.trim() };
      }

      // dedup vs active docs
      const docDate = asDate(parsed.docDate) || sf.receivedAt || new Date();
      const dupWhere = {
        docType: 'INVOICE_IN', status: { in: ['MATCHED', 'REVIEWED', 'IMPORTED', 'NEEDS_REVIEW'] },
        OR: [
          ...(cp?.id ? [{ counterpartyId: cp.id, amountTotal: pAmt, currency }] : []),
          ...(parsed.invoiceNo ? [{ docNumber: parsed.invoiceNo, amountTotal: pAmt }] : []),
        ],
      };
      const dup = dupWhere.OR.length ? (await prisma.bizDocument.findMany({ where: dupWhere, select: { id: true, docNumber: true, docDate: true } }))
        .find(c => !c.docDate || Math.abs(new Date(c.docDate) - new Date(docDate)) < 40 * 864e5) : null;
      if (dup) { stats.skippedDup++; console.log(`SKIP-DUP  ${tag} → вече записан като ${dup.id.slice(0, 12)} #${dup.docNumber}`); await tagSkip(`duplicate of ${dup.id}`); await sleep(); continue; }

      // МД (митнически декларации): parsed "amount" е стойността на стоката, не митото —
      // никога не се промотират автоматично (дублират доставчиковата фактура)
      const isCustoms = /^H1_/i.test(sf.filename) || /митническа декларация/i.test(sf.folder || '');
      const promote = !isCustoms && cp?.id !== null && cp !== null && conf >= 70;
      console.log(`${promote ? 'REVIEWED ' : 'NEEDS-REV'} ${tag} → @${cp?.name || 'NO-CP'} ${currency} ${pAmt} #${parsed.invoiceNo || '?'} ${new Date(docDate).toISOString().slice(0, 10)} conf=${conf}`);
      if (promote) stats.reviewed++; else stats.needsReview++;
      if (APPLY) {
        await prisma.bizDocument.create({
          data: {
            sourceFileId: sf.id,
            counterpartyId: cp?.id || null,
            docType: 'INVOICE_IN',
            docNumber: parsed.invoiceNo || null,
            docDate,
            dueDate: asDate(parsed.dueDate),
            currency,
            amountNet: dec(parsed.amountNet),
            vatAmount: dec(parsed.vatAmount),
            amountTotal: dec(pAmt),
            status: promote ? 'REVIEWED' : 'NEEDS_REVIEW',
            confidence: dec(conf),
            notes: `Създаден 2026-07-09 от непарснат Drive файл: ${sf.folder || ''} ${sf.filename}`.slice(0, 500),
          },
        });
      }
    } catch (err) {
      stats.failed++;
      console.log(`FAIL      ${tag}: ${String(err.message).slice(0, 100)}`);
    }
    await sleep();
  }
  function sleep() { return new Promise(r => setTimeout(r, THROTTLE_MS)); }
  console.log('\n=== DONE ===', JSON.stringify(stats));

  // For the scheduled daily batch: how many actionable files are still left
  // (excludes obvious non-invoices which will never get a BizDocument)
  const leftRows = await prisma.sourceFile.findMany({
    where: {
      driveFileId: { in: all.map(f => f.id) },
      bizDocuments: { none: {} },
      NOT: { notes: { contains: '[SKIP_NOT_INVOICE]' } },
    },
    select: { filename: true },
  });
  const actionable = leftRows.filter(r => !SKIP_FILE.test(r.filename)).length;
  console.log(`REMAINING_ACTIONABLE=${actionable}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
