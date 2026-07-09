/**
 * 2026-07-09: Import outgoing invoices (revenue) from the shared Drive folder
 * https://drive.google.com/drive/folders/1BnoBbHoYrEiPPgR3BeZcXIZ9RLaI6tph
 *
 * - Walks all month folders recursively, collects files named Invoice-<10digits>-For-Operation-*
 *   (Proforma-Invoice-* are NOT revenue and are skipped)
 * - Deterministic extraction from the uniform Micro.bg/TCPDF text layer (no LLM):
 *   number, issue/due date, client name+EIK, net/VAT/total, currency, issuer (brand)
 * - Only imports when the issuer (Доставчик) is Студио Ботема / Луминавера
 * - Existing invoice numbers: real (non-cancelled) → skip; CANCELLED seed/auto-quarantine
 *   placeholders → replaced with the real data (status PENDING)
 * - Clients matched by EIK, then by name; created when missing
 *
 * Dry run by default; --apply to write.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { google } = require('googleapis');
const pdfParse = require('pdf-parse');
const { Prisma, PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const ROOT = '1BnoBbHoYrEiPPgR3BeZcXIZ9RLaI6tph';

function getDrive() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth: oauth2 });
}

async function listAll(drive, folderId) {
  const files = [];
  let pageToken = null;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 200, pageToken,
    });
    files.push(...res.data.files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function walk(drive, folderId, path, out) {
  const files = await listAll(drive, folderId);
  for (const f of files) {
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      await walk(drive, f.id, `${path}/${f.name}`, out);
    } else if (/^Invoice-\d{10}-For-Operation/i.test(f.name)) {
      out.push({ ...f, path });
    }
  }
  return out;
}

function bgDate(s) {
  const m = String(s || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`) : null;
}

function parseInvoiceText(text) {
  const t = String(text || '');
  const number = t.match(/No:\s*(\d{10})/)?.[1] || null;

  // Split into the Получател and Доставчик blocks — individuals often have an
  // EMPTY ЕИК line, and a flat regex over the whole text then grabs the
  // supplier's EIK for the client.
  const recIdx = t.indexOf('Получател');
  const supIdx = t.indexOf('Доставчик');
  const block = (from, to) => (from >= 0 ? t.slice(from, to > from ? to : undefined) : '');
  const recBlock = block(recIdx, supIdx);
  const supBlock = block(supIdx, t.indexOf('Дата на издаване'));
  const nameIn = b => b.match(/Име на фирма:\s*\n(.+)/)?.[1]?.trim() || null;
  const eikIn = b => b.match(/ЕИК:\s*\n(\d{9,13})\s*\n/)?.[1] || null;
  const clientName = nameIn(recBlock);
  const issuerName = nameIn(supBlock);
  const issuerEik = eikIn(supBlock);
  let clientEik = eikIn(recBlock);
  if (clientEik && clientEik === issuerEik) clientEik = null;

  const date = bgDate(t.match(/Дата на издаване:\s*([\d.]+)/)?.[1]);
  const dueDate = bgDate(t.match(/Дата на падеж:\s*([\d.]+)/)?.[1]);

  const money = (label) => {
    const m = t.match(new RegExp(label + String.raw`[^\n]*\n([A-Z]{3})\s*([\d]+(?:\.[\d]+)?)`));
    return m ? { currency: m[1], amount: Number(m[2]) } : null;
  };
  const net = money('Данъчна основа');
  const vat = money('Начислено ДДС');
  const total = money('Сума за плащане');
  const currency = total?.currency || net?.currency || t.match(/Валута:\s*([A-Z]{3})/)?.[1] || 'EUR';

  const item = t.match(/\n1(.+?)бр\./)?.[1]?.trim() || null;

  return {
    number, clientName, clientEik, issuerName, date, dueDate, currency,
    amountNet: net?.amount ?? null,
    vatAmount: vat?.amount ?? null,
    amountTotal: total?.amount ?? (net && vat ? Number((net.amount + vat.amount).toFixed(2)) : null),
    description: item,
  };
}

async function findOrCreateClient(inv, brand) {
  let client = null;
  if (inv.clientEik) client = await prisma.client.findFirst({ where: { eik: inv.clientEik } });
  if (!client && inv.clientName) client = await prisma.client.findFirst({ where: { name: { equals: inv.clientName, mode: 'insensitive' } } });
  if (client) return { id: client.id, name: client.name, created: false };
  if (!APPLY) return { id: null, name: inv.clientName, created: true };
  const created = await prisma.client.create({
    data: { name: inv.clientName, eik: inv.clientEik || null, brand, type: inv.clientEik ? 'COMPANY' : 'PERSON' },
  });
  return { id: created.id, name: created.name, created: true };
}

async function main() {
  console.log(`=== Drive outgoing invoices import ${APPLY ? '(APPLY)' : '(DRY RUN)'} ===`);
  const drive = getDrive();
  const files = await walk(drive, ROOT, '', []);
  // Dedup by invoice number in filename — same export can sit in two subfolders
  const byNum = new Map();
  for (const f of files) {
    const num = f.name.match(/^Invoice-(\d{10})/)[1];
    if (!byNum.has(num)) byNum.set(num, f);
  }
  console.log(`Found ${files.length} invoice PDFs, ${byNum.size} unique numbers\n`);

  const stats = { created: 0, replacedSeed: 0, skippedExisting: 0, parseFail: 0, notOurs: 0, clientsCreated: 0 };

  for (const [num, f] of [...byNum.entries()].sort()) {
    try {
      const res = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' });
      const pdf = await pdfParse(Buffer.from(res.data));
      const inv = parseInvoiceText(pdf.text);
      const tag = `#${num} ${f.path.slice(1, 40)}`;

      if (!inv.number || !inv.date || inv.amountTotal == null || !inv.clientName) {
        stats.parseFail++;
        console.log(`PARSE-FAIL ${tag}: ${JSON.stringify({ n: inv.number, d: inv.date, t: inv.amountTotal, c: inv.clientName })}`);
        continue;
      }
      if (inv.number !== num) {
        stats.parseFail++;
        console.log(`PARSE-FAIL ${tag}: номер в PDF ${inv.number} != име на файл ${num}`);
        continue;
      }
      const issuer = String(inv.issuerName || '').toLowerCase();
      const brand = issuer.includes('луминавера') || issuer.includes('luminavera') ? 'LUMINAVERA'
        : (issuer.includes('ботема') || issuer.includes('botema')) ? 'STUDIO_BOTEMA' : null;
      if (!brand) {
        stats.notOurs++;
        console.log(`NOT-OURS  ${tag}: издател "${inv.issuerName}"`);
        continue;
      }

      // Placeholders: seed demo rows (ANY status — some were left PAID!) and
      // auto-quarantined stubs. The real invoice with that number is this PDF.
      const existing = await prisma.invoice.findFirst({ where: { number: num }, include: { client: { select: { name: true } } } });
      const isPlaceholder = existing && /\[seed:|auto-quarantine/i.test(existing.notes || '');
      if (existing && !isPlaceholder) {
        // Repair pass for rows imported by this script: fix a mis-assigned client
        const importedByUs = /Импорт от Drive 2026-07-09/.test(existing.notes || '');
        if (importedByUs && inv.clientName && existing.client?.name !== inv.clientName) {
          const fixed = await findOrCreateClient(inv, existing.brand || 'STUDIO_BOTEMA');
          if (fixed.created) stats.clientsCreated++;
          console.log(`FIX-CLIENT ${tag}: "${existing.client?.name}" → "${fixed.name}"`);
          if (APPLY) await prisma.invoice.update({ where: { id: existing.id }, data: { clientId: fixed.id } });
          stats.clientFixed = (stats.clientFixed || 0) + 1;
          continue;
        }
        stats.skippedExisting++;
        console.log(`SKIP      ${tag}: вече съществува (${existing.status})`);
        continue;
      }

      const client = await findOrCreateClient(inv, brand);
      if (client.created) stats.clientsCreated++;

      const action = isPlaceholder ? 'REPLACE' : 'CREATE';
      console.log(`${action.padEnd(9)} ${tag} | ${inv.date.toISOString().slice(0, 10)} | ${inv.currency} ${inv.amountTotal} (нето ${inv.amountNet}) | ${client.name}${client.created ? ' [НОВ КЛИЕНТ]' : ''} | ${brand}`);
      if (action === 'CREATE') stats.created++; else stats.replacedSeed++;
      if (!APPLY) continue;

      const data = {
        number: num,
        date: inv.date,
        dueDate: inv.dueDate,
        clientId: client.id,
        type: 'INVOICE',
        brand,
        currency: inv.currency,
        amountNet: new Prisma.Decimal(inv.amountNet ?? 0),
        vatAmount: new Prisma.Decimal(inv.vatAmount ?? 0),
        amountTotal: new Prisma.Decimal(inv.amountTotal),
        status: 'PENDING',
        description: (inv.description || '').slice(0, 300) || null,
        driveFileId: f.id,
        notes: `Импорт от Drive 2026-07-09 (${f.path.slice(1)})${isPlaceholder ? ' | замени seed/quarantine плейсхолдър' : ''}`.slice(0, 500),
      };
      if (isPlaceholder) {
        await prisma.invoice.update({ where: { id: existing.id }, data });
      } else {
        await prisma.invoice.create({ data });
      }
    } catch (err) {
      stats.parseFail++;
      console.log(`FAIL      #${num}: ${String(err.message).slice(0, 120)}`);
    }
  }
  console.log('\n=== DONE ===', JSON.stringify(stats));
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
