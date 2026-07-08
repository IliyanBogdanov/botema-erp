/**
 * 2026-07-08 audit, part 2:
 *  A) Disposition of unverifiable / mis-parsed docs found during the date audit:
 *     - customs МД H1/170232: keep one BGN doc (payment-verified), reject 3 mis-parsed copies
 *     - credit-note 4/100 positive copy → REJECTED (negative IMPORTED original stays)
 *     - Ambientec product-code duplicate → REJECTED
 *     - unverifiable docs (no source, ambiguous parses) → NEEDS_REVIEW (out of sums until verified)
 *  B) Fix docDate on active docs stuck at default 2025-01-01 using the Drive folder
 *     year/month (Drive/Root/YYYY/Month/...) — receivedAt when it falls in the same month,
 *     otherwise the 15th of the folder month.
 * Dry run by default; --apply to write.
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  'януари': 1, 'февруари': 2, 'март': 3, 'април': 4, 'май': 5, 'юни': 6, 'юли': 7,
  'август': 8, 'септември': 9, 'октомври': 10, 'ноември': 11, 'декември': 12,
};

function folderYearMonth(folder) {
  const m = String(folder || '').match(/(?:^|\/)(20\d{2})\/([^/]+)\//);
  if (!m) return null;
  const month = MONTHS[m[2].trim().toLowerCase()];
  if (!month) return null;
  return { year: Number(m[1]), month };
}

async function setStatus(idPrefix, status, reason) {
  const d = await prisma.bizDocument.findFirst({ where: { id: { startsWith: idPrefix } } });
  if (!d) { console.log(`  !! not found ${idPrefix}`); return; }
  if (d.status === status) { console.log(`  already ${status}: ${idPrefix}`); return; }
  console.log(`  ${status.padEnd(12)} ${d.id.slice(0, 12)} #${d.docNumber} ${d.currency} ${d.amountTotal} — ${reason}`);
  if (!APPLY) return;
  await prisma.bizDocument.update({
    where: { id: d.id },
    data: { status, notes: `${d.notes ? d.notes + ' | ' : ''}${status} 2026-07-08 audit: ${reason}`.slice(0, 1000) },
  });
}

async function update(idPrefix, data, reason) {
  const d = await prisma.bizDocument.findFirst({ where: { id: { startsWith: idPrefix } } });
  if (!d) { console.log(`  !! not found ${idPrefix}`); return; }
  console.log(`  UPDATE       ${d.id.slice(0, 12)} #${d.docNumber} → ${JSON.stringify(data)} — ${reason}`);
  if (!APPLY) return;
  await prisma.bizDocument.update({
    where: { id: d.id },
    data: { ...data, notes: `${d.notes ? d.notes + ' | ' : ''}2026-07-08 audit: ${reason}`.slice(0, 1000) },
  });
}

async function main() {
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (--apply) ===');

  console.log('\n[A] Спорни документи');
  // МД H1/BG005100/170232 — банково плащане 1043.11 BGN до Агенция Митници на 2025-11-24 (реф. 2949022031)
  await update('cmp0z1gfn002', { docNumber: 'H1/BG005100/170232', docDate: new Date('2025-11-24') }, 'МД потвърдена от банково плащане 24.11.2025');
  await setStatus('cmp0z1gq5002', 'REJECTED', 'дубликат на МД H1/170232 (едно мито, две Purchase копия)');
  await setStatus('cmp2d3jlm006', 'REJECTED', 'същата МД H1/170232, грешно EUR + грешен CP (GUANGDONG е износителят по декларацията)');
  await setStatus('cmpcjeadm006', 'REJECTED', 'същата МД H1/170232, грешен CP (DHL е куриерът); плащането е към Митници');

  // Кредитно известие Bonaldo/EXENZA 4/100: отрицателният IMPORTED оригинал остава, положителното копие пада
  await setStatus('cmp0z1e0x002', 'REJECTED', 'положително копие на кредитно известие 4/100 от 06.11.2025 (оригиналът е -2728.80)');

  // Ambientec: FVR25-21496 е фактурата; продуктов код като номер = дубликат; OFV25-01524 е оферта (посл. parse: OFFER)
  await setStatus('cmp0z1cjh001', 'REJECTED', 'дубликат на Ambientec FVR25-21496 (продуктов код 71041BR1-60CP като номер)');
  await setStatus('cmp2mo39y004', 'NEEDS_REVIEW', 'вероятно оферта OFV25-01524, не фактура (parse: OFFER); същата сума като FVR25-21496');

  // Непроверими (без source файл / двусмислени parse-ове) — извън сумите до ръчна проверка
  await setStatus('cmpcb7173003', 'NEEDS_REVIEW', 'doc0577...pdf: посл. parse = DELIVERY_NOTE, сумата съвпада с фактура 1/445 — възможен дубликат');
  await setStatus('cmp2d2cnx004', 'NEEDS_REVIEW', 'МД H1/2534: 1168.95 USD е стойност на стоката, не мито; непроверимо без PDF');
  await setStatus('cmp2m8yhf001', 'NEEDS_REVIEW', 'IKEA бележка с дата 2014 и валута EUR — непроверима, няма source файл');
  const dhl2023 = await prisma.bizDocument.findFirst({ where: { docNumber: '30656', docType: 'INVOICE_IN', status: { in: ['MATCHED', 'REVIEWED'] } } });
  if (dhl2023) await setStatus(dhl2023.id.slice(0, 12), 'NEEDS_REVIEW', 'МД H1/30656 под CP DHL, 456.30 BGN, дата 2023 — непроверима');

  // BRAGA #625: source Drive "April/Braga invoice", получен 05.05.2025 → 08.04.2025 (денят/месецът от парсваната дата)
  await update('cmpcn8d4800t', { docDate: new Date('2025-04-08') }, 'дата 2016→2025: Drive папка April/Braga invoice, файл получен 05.05.2025');

  console.log('\n[B] Дати от Drive папки (default 2025-01-01)');
  const targets = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { in: ['MATCHED', 'REVIEWED'] }, docDate: new Date('2025-01-01') },
    select: { id: true, docNumber: true, amountTotal: true, currency: true, notes: true, sourceFile: { select: { folder: true, receivedAt: true } }, counterparty: { select: { name: true } } },
  });
  let fixed = 0, noEvidence = 0;
  for (const d of targets) {
    let folder = d.sourceFile?.folder || null;
    let recv = d.sourceFile?.receivedAt || null;
    if (!folder) {
      const m = (d.notes || '').match(/Мигрирано от Purchase (\w+)/);
      if (m) {
        const pur = await prisma.purchase.findUnique({ where: { id: m[1] }, select: { driveFileId: true } });
        if (pur?.driveFileId) {
          const sf = await prisma.sourceFile.findFirst({ where: { driveFileId: pur.driveFileId }, select: { folder: true, receivedAt: true } });
          folder = sf?.folder || null;
          recv = sf?.receivedAt || null;
        }
      }
    }
    const ym = folderYearMonth(folder);
    if (!ym) { noEvidence++; console.log(`  NO-EVIDENCE ${d.id.slice(0, 12)} #${d.docNumber} ${d.currency} ${d.amountTotal} @${d.counterparty?.name || ''}`); continue; }
    const recvInMonth = recv && recv.getUTCFullYear() === ym.year && recv.getUTCMonth() + 1 === ym.month;
    const newDate = recvInMonth ? recv : new Date(Date.UTC(ym.year, ym.month - 1, 15));
    fixed++;
    console.log(`  DATE ${d.id.slice(0, 12)} #${(d.docNumber || '?').padEnd(16)} ${d.currency} ${String(d.amountTotal).padStart(9)} → ${newDate.toISOString().slice(0, 10)} (${recvInMonth ? 'receivedAt' : 'folder mid-month'}) @${(d.counterparty?.name || '').slice(0, 25)}`);
    if (APPLY) {
      await prisma.bizDocument.update({
        where: { id: d.id },
        data: { docDate: newDate, notes: `${(d.notes || '') ? (d.notes || '') + ' | ' : ''}date 2026-07-08 audit: от Drive папка ${ym.year}/${ym.month} (беше default 2025-01-01)`.slice(0, 1000) },
      });
    }
  }
  console.log(`\nДати поправени: ${fixed}, без доказателство: ${noEvidence}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
