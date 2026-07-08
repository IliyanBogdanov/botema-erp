/**
 * 2026-07-08 audit cleanup:
 *  1. Merge counterparties: АКА ЛАЙТИНГ БГ → Watt 2025, OpenAI OpCo → OpenAI/ChatGPT, АЛОГ ООД ↔ Alog BG
 *  2. Reject verified duplicate INVOICE_IN BizDocuments (keep the payment-linked/richer copy)
 *  3. Enrich kept stubs with docNumber/counterparty from the rejected copy
 * Run without args = dry run; --apply to execute.
 */
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function findCp(name) {
  return prisma.counterparty.findFirst({ where: { name: { contains: name, mode: 'insensitive' } } });
}

async function mergeCp(fromName, toName) {
  const from = await findCp(fromName);
  const to = await findCp(toName);
  if (!from || !to || from.id === to.id) { console.log(`  SKIP merge "${fromName}" → "${toName}" (from=${from?.id}, to=${to?.id})`); return; }
  const docs = await prisma.bizDocument.count({ where: { counterpartyId: from.id } });
  const pays = await prisma.payment.count({ where: { counterpartyId: from.id } });
  console.log(`  MERGE CP "${from.name}" (${docs} docs, ${pays} pays) → "${to.name}"`);
  if (!APPLY) return;
  await prisma.payment.updateMany({ where: { counterpartyId: from.id }, data: { counterpartyId: to.id } });
  await prisma.bizDocument.updateMany({ where: { counterpartyId: from.id }, data: { counterpartyId: to.id } });
  await prisma.order.updateMany({ where: { clientId: from.id }, data: { clientId: to.id } });
  await prisma.order.updateMany({ where: { supplierId: from.id }, data: { supplierId: to.id } });
  await prisma.delivery.updateMany({ where: { counterpartyId: from.id }, data: { counterpartyId: to.id } });
  await prisma.missingDocument.updateMany({ where: { counterpartyId: from.id }, data: { counterpartyId: to.id } });
  await prisma.contact.updateMany({ where: { counterpartyId: from.id }, data: { counterpartyId: to.id } });
  await prisma.counterparty.delete({ where: { id: from.id } });
}

async function byPrefix(prefix) {
  const d = await prisma.bizDocument.findFirst({ where: { id: { startsWith: prefix } } });
  if (!d) console.log(`  !! doc not found: ${prefix}`);
  return d;
}

async function rejectDoc(prefix, reason) {
  const d = await byPrefix(prefix);
  if (!d) return;
  if (d.status === 'REJECTED') { console.log(`  already rejected: ${prefix}`); return; }
  console.log(`  REJECT ${d.id.slice(0, 12)} #${d.docNumber} ${d.currency} ${d.amountTotal} — ${reason}`);
  if (!APPLY) return;
  await prisma.bizDocument.update({
    where: { id: d.id },
    data: { status: 'REJECTED', notes: `${d.notes ? d.notes + ' | ' : ''}REJECTED 2026-07-08 audit: ${reason}` },
  });
}

async function enrichDoc(prefix, data, why) {
  const d = await byPrefix(prefix);
  if (!d) return;
  console.log(`  ENRICH ${d.id.slice(0, 12)} #${d.docNumber} → ${JSON.stringify(data)} (${why})`);
  if (!APPLY) return;
  await prisma.bizDocument.update({ where: { id: d.id }, data });
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE ===' : '=== DRY RUN (use --apply) ===');

  console.log('\n[1] Counterparty merges');
  await mergeCp('АКА ЛАЙТИНГ', 'Watt 2025');
  await mergeCp('OpenAI OpCo', 'OpenAI / ChatGPT');
  await mergeCp('Alog BG', 'АЛОГ ООД'); // АЛОГ ООД е официалното име

  console.log('\n[2] Duplicate rejections + enrichment of kept copies');
  // Bonaldo advance invoice — EXENZA CP was an AI parse error (PDF from "Поръчка Боналдо" folder)
  await rejectDoc('cmpcb41iz002', 'дубликат на Bonaldo 1/348 (FATT. ANTICIPO); контрагентът EXENZA е parse грешка');
  await enrichDoc('cmp0z2hfh009', { docNumber: '1/348' }, 'номерът беше слепен с датата "1/34804/09/2025"');

  // OpenAI OpCo copies of already-matched ChatGPT docs
  await rejectDoc('cmpb5184s002', 'дубликат на OpenAI EBE8D25B0017 (MATCHED)');
  await rejectDoc('cmpb51yze004', 'дубликат на OpenAI EBE8D25B0016 (MATCHED)');
  await rejectDoc('cmpb50q36001', 'дубликат на OpenAI EBE8D25B0018 (MATCHED)');

  // АКА ЛАЙТИНГ = Watt 2025 (same invoices, short vs long number format)
  await rejectDoc('cmpckmvuy00d', 'дубликат на Watt 2025 #17048 (MATCHED)');
  await rejectDoc('cmpcl4cic00g', 'дубликат на Watt 2025 #2025012694 (MATCHED)');
  await rejectDoc('cmpckk6ze00d', 'дубликат на Watt 2025 #17123 (MATCHED)');

  // СуперХостинг: proforma/order number copies vs real invoice numbers
  await rejectDoc('cmpcmpzvb00p', 'дубликат: #9649737 е номер на поръчка, фактурата е #1001591064');
  await rejectDoc('cmpcn5tbj00s', 'дубликат: #9768847 е номер на поръчка, фактурата е #1001666290');

  // Р И М ИНТЕРИОР: keep MATCHED stub, enrich from REVIEWED copy
  const rim = await findCp('Р И М ИНТЕРИОР');
  await enrichDoc('cmp55resd003', { docNumber: '2000000128', ...(rim ? { counterpartyId: rim.id } : {}) }, 'метаданни от отхвърленото копие');
  await rejectDoc('cmpcnc2nd00u', 'дубликат на MATCHED Р И М ИНТЕРИОР 4737.60 BGN');

  // Alog 11.87: MATCHED stub беше грешно на DHL; фактурата е Alog #0000013292
  const alog = await findCp('АЛОГ ООД');
  await enrichDoc('cmp55uvmg004', { docNumber: '0000013292', ...(alog ? { counterpartyId: alog.id } : {}) }, 'реалната фактура е АЛОГ, не DHL');
  await rejectDoc('cmpcfec4t003', 'дубликат на MATCHED Alog 11.87 BGN');

  // АЛОГ 4.89
  await enrichDoc('cmp55lvl6002', { docNumber: '0000013106' }, 'номер от отхвърленото копие');
  await rejectDoc('cmpcmu33h00q', 'дубликат на MATCHED АЛОГ 4.89 BGN');

  // Layered: PRE/100104 = PRE-100104; SQ100098 (2014 дата) е quotation за същата поръчка
  await rejectDoc('cmpcmyzpw00r', 'дубликат на Layered PRE-100104');
  const sq = await prisma.bizDocument.findFirst({ where: { docNumber: 'SQ100098', docType: 'INVOICE_IN', status: { not: 'REJECTED' } } });
  if (sq) await rejectDoc(sq.id.slice(0, 12), 'quotation (SQ), не фактура; дубликат на Layered PRE-100104; невъзможна дата 2014');

  // Студио Кюб: keep the REVIEWED doc with real CP/number, reject "Непознат доставчик" stub (0 links)
  await rejectDoc('cmp55grpy001', 'дубликат на Студио Кюб #0000000090; стъб без връзки с "Непознат доставчик"');

  // ANTRAX 2501422 vs 2506321: два различни PDF-а и номера (аванс+финал) — ОСТАВАТ и двата.

  console.log('\nDone.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
