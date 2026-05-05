/**
 * Studio Botema ERP — Business Data Seed
 * Counterparties, projects, biz_documents, payments, reconciliation, missing_documents
 * Real cases: Lodes, СИЛТЕМ, Giada, Polaris, Speedy COD, Micro.bg, DHL, Alphaluce, etc.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding normalized business data...\n');

  // ── COUNTERPARTIES ────────────────────────────────────────────────────────

  const cp = {};

  const counterpartiesData = [
    // Клиенти
    { key: 'lodes',      name: 'Lodes S.r.l.',             type: 'CLIENT',    country: 'IT', currency: 'EUR', eik: null },
    { key: 'siltem',     name: 'СИЛТЕМ ЕООД',               type: 'CLIENT',    country: 'BG', currency: 'BGN' },
    { key: 'giada',      name: 'Giada',                     type: 'CLIENT',    country: 'IT', currency: 'EUR' },
    { key: 'polaris',    name: 'Polaris',                   type: 'CLIENT',    country: 'BG', currency: 'BGN' },
    { key: 'omega',      name: 'Omega Light',               type: 'SUPPLIER',  country: 'BG', currency: 'BGN' },
    { key: 'et_ros',     name: 'ЕТ РОС',                    type: 'CLIENT',    country: 'BG', currency: 'BGN' },
    // Доставчици
    { key: 'alphaluce',  name: 'Alphaluce',                 type: 'SUPPLIER',  country: 'IT', currency: 'EUR' },
    { key: 'dhl',        name: 'DHL Express',               type: 'COURIER',   country: 'DE', currency: 'EUR', subtype: 'COURIER' },
    { key: 'speedy',     name: 'Speedy',                    type: 'COURIER',   country: 'BG', currency: 'BGN', subtype: 'COURIER' },
    { key: 'micro_bg',   name: 'Micro.bg',                  type: 'CLIENT',    country: 'BG', currency: 'BGN' },
    // Компании
    { key: 'botema',     name: 'Studio Botema ЕООД',        type: 'OTHER',     country: 'BG', currency: 'BGN', eik: '206753744', companyId: 'studio_botema' },
    { key: 'luminavera', name: 'Luminavera ЕООД',           type: 'OTHER',     country: 'BG', currency: 'BGN', companyId: 'luminavera' },
  ];

  for (const c of counterpartiesData) {
    const { key, ...data } = c;
    cp[key] = await prisma.counterparty.upsert({
      where: { id: `seed-cp-${key}` },
      update: {},
      create: { id: `seed-cp-${key}`, ...data },
    });
    console.log(`  ✓ Counterparty: ${data.name}`);
  }

  // ── PROJECTS ──────────────────────────────────────────────────────────────

  const proj = {};

  const projectsData = [
    { key: 'siltem_209',  code: '1717.209', name: 'СИЛТЕМ — Проект 209',  status: 'ACTIVE', year: 2025 },
    { key: 'giada_213',   code: '1717.213', name: 'Giada — Проект 213',   status: 'ACTIVE', year: 2025 },
    { key: 'polaris_apr', code: '1717.220', name: 'Polaris — Април 2026', status: 'ACTIVE', year: 2026 },
    { key: 'lodes_ref',   code: '1717.215', name: 'Lodes — ODV 7722',     status: 'ACTIVE', year: 2026 },
  ];

  for (const p of projectsData) {
    const { key, ...data } = p;
    const existing = await prisma.project.findUnique({ where: { code: data.code } });
    proj[key] = existing ?? await prisma.project.create({ data });
    console.log(`  ✓ Project: ${data.code} — ${data.name}`);
  }

  // ── SOURCE FILES (representatives) ────────────────────────────────────────

  const sf = {};

  const sourceFilesData = [
    { key: 'lodes_inv_2604608',  type: 'DRIVE', filename: 'Invoice-2604608-Lodes.pdf',         folder: 'Drive/2026/Purchases/Lodes' },
    { key: 'lodes_dn_2608078',   type: 'DRIVE', filename: 'DeliveryNote-2608078-Lodes.pdf',    folder: 'Drive/2026/Deliveries/Lodes' },
    { key: 'lodes_dn_2608163',   type: 'DRIVE', filename: 'DeliveryNote-2608163-Lodes.pdf',    folder: 'Drive/2026/Deliveries/Lodes' },
    { key: 'lodes_dn_2608572',   type: 'DRIVE', filename: 'DeliveryNote-2608572-Lodes.pdf',    folder: 'Drive/2026/Deliveries/Lodes' },
    { key: 'siltem_offer',       type: 'DRIVE', filename: 'Offer-СИЛТЕМ-1717.209.pdf',          folder: 'Drive/2025/Offers' },
    { key: 'siltem_proforma',    type: 'DRIVE', filename: 'Proforma-СИЛТЕМ-1717.209.pdf',       folder: 'Drive/2025/Proformas' },
    { key: 'siltem_inv_193',     type: 'DRIVE', filename: 'Invoice-193-СИЛТЕМ.pdf',             folder: 'Drive/2025/Invoices/Out' },
    { key: 'polaris_inv',        type: 'DRIVE', filename: 'Invoice-9000002677-Polaris.pdf',     folder: 'Drive/2026/Purchases/Polaris' },
    { key: 'polaris_protocol',   type: 'DRIVE', filename: 'Protocol-CCF_000007-Polaris.pdf',   folder: 'Drive/2026/Protocols' },
    { key: 'dhl_sofi',           type: 'DRIVE', filename: 'DHL-SOFI000447615.pdf',             folder: 'Drive/2026/Purchases/DHL' },
    { key: 'alphaluce_awb',      type: 'DRIVE', filename: 'AWB-9187470891-Alphaluce.pdf',      folder: 'Drive/2026/Imports/Alphaluce' },
    { key: 'alphaluce_ci',       type: 'DRIVE', filename: 'CommercialInvoice-Alphaluce.pdf',   folder: 'Drive/2026/Imports/Alphaluce' },
    { key: 'alphaluce_customs',  type: 'DRIVE', filename: 'CustomsDeclaration-Alphaluce.pdf',  folder: 'Drive/2026/Imports/Alphaluce' },
  ];

  for (const s of sourceFilesData) {
    const { key, ...data } = s;
    sf[key] = await prisma.sourceFile.upsert({
      where: { id: `seed-sf-${key}` },
      update: {},
      create: { id: `seed-sf-${key}`, ...data },
    });
  }
  console.log(`  ✓ ${sourceFilesData.length} source files created`);

  // ── BIZ DOCUMENTS ─────────────────────────────────────────────────────────

  const bd = {};

  const bizDocsData = [
    // Lodes
    {
      key: 'lodes_inv_2604608', docType: 'INVOICE_IN', docNumber: '2604608',
      docDate: new Date('2026-03-15'), currency: 'EUR', amountNet: 12500, vatAmount: 0, amountTotal: 12500,
      vatType: 'EU_INTRA', status: 'MATCHED', counterpartyId: cp.lodes.id,
      projectId: proj.lodes_ref.id, sourceFileId: sf.lodes_inv_2604608.id,
      notes: 'Входяща фактура Lodes за ODV 7722. EU intra-community — reverse charge.',
    },
    {
      key: 'lodes_dn_2608078', docType: 'DELIVERY_NOTE', docNumber: '2608078',
      docDate: new Date('2026-03-20'), currency: 'EUR', status: 'IMPORTED',
      counterpartyId: cp.lodes.id, projectId: proj.lodes_ref.id, sourceFileId: sf.lodes_dn_2608078.id,
      notes: 'Delivery note 2608078 към Invoice 2604608',
    },
    {
      key: 'lodes_dn_2608163', docType: 'DELIVERY_NOTE', docNumber: '2608163',
      docDate: new Date('2026-03-22'), currency: 'EUR', status: 'IMPORTED',
      counterpartyId: cp.lodes.id, projectId: proj.lodes_ref.id, sourceFileId: sf.lodes_dn_2608163.id,
    },
    {
      key: 'lodes_dn_2608572', docType: 'DELIVERY_NOTE', docNumber: '2608572',
      docDate: new Date('2026-03-28'), currency: 'EUR', status: 'IMPORTED',
      counterpartyId: cp.lodes.id, projectId: proj.lodes_ref.id, sourceFileId: sf.lodes_dn_2608572.id,
    },
    // СИЛТЕМ 1717.209
    {
      key: 'siltem_offer', docType: 'OFFER_OUT', docNumber: 'OF-2025-209',
      docDate: new Date('2025-09-01'), currency: 'BGN', status: 'IMPORTED',
      counterpartyId: cp.siltem.id, projectId: proj.siltem_209.id, sourceFileId: sf.siltem_offer.id,
      notes: 'Оферта към СИЛТЕМ за проект 1717.209',
    },
    {
      key: 'siltem_proforma', docType: 'PROFORMA_OUT', docNumber: 'PF-2025-209',
      docDate: new Date('2025-10-01'), currency: 'BGN', amountNet: 8500, vatAmount: 1700, amountTotal: 10200,
      status: 'IMPORTED', counterpartyId: cp.siltem.id, projectId: proj.siltem_209.id,
      sourceFileId: sf.siltem_proforma.id,
    },
    {
      key: 'siltem_inv_193', docType: 'INVOICE_OUT', docNumber: '193',
      docDate: new Date('2025-11-15'), currency: 'BGN', amountNet: 8500, vatAmount: 1700, amountTotal: 10200,
      vatType: 'STANDARD_BG', status: 'MATCHED', counterpartyId: cp.siltem.id,
      projectId: proj.siltem_209.id, sourceFileId: sf.siltem_inv_193.id,
      notes: 'Изходяща фактура 193 — СИЛТЕМ. Свързана с изписвания от склад.',
    },
    // Giada 1717.213
    {
      key: 'giada_offer', docType: 'OFFER_OUT', docNumber: 'OF-2025-213',
      docDate: new Date('2025-11-01'), currency: 'EUR', status: 'NEEDS_REVIEW',
      counterpartyId: cp.giada.id, projectId: proj.giada_213.id,
      notes: 'Оферта към Giada. Lodes referral. Статус: OFFER_SENT.',
      internalRef: 'OFFER_SENT',
    },
    // Polaris
    {
      key: 'polaris_inv', docType: 'INVOICE_IN', docNumber: '9000002677',
      docDate: new Date('2026-04-10'), currency: 'BGN', status: 'NEEDS_REVIEW',
      counterpartyId: cp.polaris.id, projectId: proj.polaris_apr.id,
      sourceFileId: sf.polaris_inv.id, notes: 'Входяща фактура Polaris April 2026',
    },
    {
      key: 'polaris_protocol', docType: 'PROTOCOL', docNumber: 'CCF_000007',
      docDate: new Date('2026-04-15'), currency: 'BGN', status: 'NEEDS_REVIEW',
      counterpartyId: cp.polaris.id, projectId: proj.polaris_apr.id,
      sourceFileId: sf.polaris_protocol.id, notes: 'Приемо-предавателен протокол Polaris',
    },
    // DHL
    {
      key: 'dhl_sofi', docType: 'INVOICE_IN', docNumber: 'SOFI000447615',
      docDate: new Date('2026-04-05'), currency: 'BGN', status: 'NEEDS_REVIEW',
      counterpartyId: cp.dhl.id, sourceFileId: sf.dhl_sofi.id,
      notes: 'DHL транспортен разход. Може да е свързан с Alphaluce доставка.',
    },
    // Alphaluce / митница
    {
      key: 'alphaluce_awb', docType: 'CMR', docNumber: '9187470891',
      docDate: new Date('2026-03-10'), currency: 'EUR', status: 'IMPORTED',
      counterpartyId: cp.alphaluce.id, sourceFileId: sf.alphaluce_awb.id,
      notes: 'DHL AWB за Alphaluce пратка',
    },
    {
      key: 'alphaluce_ci', docType: 'INVOICE_IN',
      docDate: new Date('2026-03-08'), currency: 'EUR', status: 'IMPORTED',
      counterpartyId: cp.alphaluce.id, sourceFileId: sf.alphaluce_ci.id,
      notes: 'Commercial Invoice Alphaluce — свързан с AWB 9187470891',
    },
    {
      key: 'alphaluce_customs', docType: 'CUSTOMS',
      docDate: new Date('2026-03-12'), currency: 'BGN', vatType: 'IMPORT',
      status: 'IMPORTED', counterpartyId: cp.alphaluce.id,
      sourceFileId: sf.alphaluce_customs.id,
      notes: 'Митническа декларация за Alphaluce внос. ДДС при внос.',
    },
  ];

  for (const d of bizDocsData) {
    const { key, ...data } = d;
    bd[key] = await prisma.bizDocument.upsert({
      where: { id: `seed-bd-${key}` },
      update: {},
      create: { id: `seed-bd-${key}`, ...data },
    });
  }
  console.log(`  ✓ ${bizDocsData.length} biz documents created`);

  // ── PAYMENTS ──────────────────────────────────────────────────────────────

  const pay = {};

  const paymentsData = [
    {
      key: 'lodes_pay_apr2026', paymentType: 'BANK_TRANSFER',
      paymentDate: new Date('2026-04-01'), amount: 12500, currency: 'EUR',
      counterpartyId: cp.lodes.id, projectId: proj.lodes_ref.id,
      reference: 'ODV 7722 partial', status: 'PARTIAL',
      notes: 'Lodes плащане 01.04.2026 — частично свързано с ODV 7722',
    },
    {
      key: 'siltem_pay', paymentType: 'BANK_TRANSFER',
      paymentDate: new Date('2025-11-20'), amount: 10200, currency: 'BGN',
      counterpartyId: cp.siltem.id, projectId: proj.siltem_209.id,
      reference: 'Invoice 193', status: 'MATCHED',
    },
    {
      key: 'polaris_pay', paymentType: 'BANK_TRANSFER',
      paymentDate: new Date('2026-04-20'), amount: 5000, currency: 'BGN',
      counterpartyId: cp.polaris.id, projectId: proj.polaris_apr.id,
      status: 'UNMATCHED', notes: 'Plащане Polaris — чака потвърждение на Invoice 9000002677',
    },
  ];

  for (const p of paymentsData) {
    const { key, ...data } = p;
    pay[key] = await prisma.payment.upsert({
      where: { id: `seed-pay-${key}` },
      update: {},
      create: { id: `seed-pay-${key}`, ...data },
    });
  }
  console.log(`  ✓ ${paymentsData.length} payments created`);

  // ── RECONCILIATION LINKS ──────────────────────────────────────────────────

  const links = [
    // Lodes: payment → invoice
    {
      key: 'lodes_pay_to_inv', linkType: 'PAYMENT_TO_INVOICE',
      paymentId: pay.lodes_pay_apr2026.id, targetDocId: bd.lodes_inv_2604608.id,
      amountLinked: 12500, currency: 'EUR', confidence: 0.95,
      notes: 'Lodes плащане → Invoice 2604608',
    },
    // Lodes: invoice → delivery notes
    {
      key: 'lodes_inv_to_dn1', linkType: 'INVOICE_TO_DELIVERY',
      sourceDocId: bd.lodes_inv_2604608.id, targetDocId: bd.lodes_dn_2608078.id,
      confidence: 1.0,
    },
    {
      key: 'lodes_inv_to_dn2', linkType: 'INVOICE_TO_DELIVERY',
      sourceDocId: bd.lodes_inv_2604608.id, targetDocId: bd.lodes_dn_2608163.id,
      confidence: 1.0,
    },
    {
      key: 'lodes_inv_to_dn3', linkType: 'INVOICE_TO_DELIVERY',
      sourceDocId: bd.lodes_inv_2604608.id, targetDocId: bd.lodes_dn_2608572.id,
      confidence: 0.9,
    },
    // СИЛТЕМ: proforma → invoice
    {
      key: 'siltem_pf_to_inv', linkType: 'INVOICE_TO_DELIVERY',
      sourceDocId: bd.siltem_proforma.id, targetDocId: bd.siltem_inv_193.id,
      confidence: 1.0, notes: 'Проформа → Фактура 193',
    },
    // СИЛТЕМ: payment → invoice
    {
      key: 'siltem_pay_to_inv', linkType: 'PAYMENT_TO_INVOICE',
      paymentId: pay.siltem_pay.id, targetDocId: bd.siltem_inv_193.id,
      amountLinked: 10200, currency: 'BGN', confidence: 1.0,
    },
    // Alphaluce: CMR → invoice
    {
      key: 'alphaluce_cmr_to_ci', linkType: 'INVOICE_TO_DELIVERY',
      sourceDocId: bd.alphaluce_awb.id, targetDocId: bd.alphaluce_ci.id,
      confidence: 0.95, notes: 'AWB 9187470891 → Commercial Invoice',
    },
  ];

  for (const l of links) {
    const { key, ...data } = l;
    await prisma.reconciliationLink.upsert({
      where: { id: `seed-rl-${key}` },
      update: {},
      create: { id: `seed-rl-${key}`, ...data },
    });
  }
  console.log(`  ✓ ${links.length} reconciliation links created`);

  // ── MISSING DOCUMENTS ─────────────────────────────────────────────────────

  const missing = [
    {
      key: 'lodes_advance', missingType: 'ADVANCE_INVOICE',
      description: 'Липсва авансова фактура от Lodes за ODV 7722/9374/9375',
      counterpartyId: cp.lodes.id, projectId: proj.lodes_ref.id,
      relatedDocId: bd.lodes_inv_2604608.id, currency: 'EUR',
      status: 'OPEN', notes: 'Проверете с Lodes дали е издадена авансова фактура преди 2604608.',
    },
    {
      key: 'polaris_dn', missingType: 'DELIVERY_NOTE',
      description: 'Липсва товарителница за доставка Polaris April 2026',
      counterpartyId: cp.polaris.id, projectId: proj.polaris_apr.id,
      relatedDocId: bd.polaris_inv.id, status: 'OPEN',
    },
    {
      key: 'alphaluce_packing', missingType: 'CUSTOMS_DOC',
      description: 'Packing list за Alphaluce пратка AWB 9187470891 — нужен за митница',
      counterpartyId: cp.alphaluce.id,
      relatedDocId: bd.alphaluce_customs.id, status: 'OPEN',
    },
  ];

  for (const m of missing) {
    const { key, ...data } = m;
    await prisma.missingDocument.upsert({
      where: { id: `seed-md-${key}` },
      update: {},
      create: { id: `seed-md-${key}`, ...data },
    });
  }
  console.log(`  ✓ ${missing.length} missing documents tracked`);

  // ── COVERAGE ──────────────────────────────────────────────────────────────

  const coverageData = [
    { source: 'DRIVE', path: 'Drive/2026', year: 2026, status: 'IN_PROGRESS', itemsFound: 120, itemsDone: 45 },
    { source: 'DRIVE', path: 'Drive/2025', year: 2025, status: 'PARTIAL',     itemsFound: 280, itemsDone: 180 },
    { source: 'DRIVE', path: 'Drive/2024', year: 2024, status: 'PENDING',     itemsFound: 0,   itemsDone: 0 },
    { source: 'GMAIL', path: 'Gmail/2026', year: 2026, status: 'IN_PROGRESS', itemsFound: 60,  itemsDone: 25 },
    { source: 'GMAIL', path: 'Gmail/2025', year: 2025, status: 'PENDING',     itemsFound: 0,   itemsDone: 0 },
    { source: 'GMAIL', path: 'Gmail/2024', year: 2024, status: 'PENDING',     itemsFound: 0,   itemsDone: 0 },
  ];

  for (const c of coverageData) {
    await prisma.coverage.upsert({
      where: { source_path_year: { source: c.source, path: c.path, year: c.year } },
      update: { status: c.status, itemsFound: c.itemsFound, itemsDone: c.itemsDone },
      create: c,
    });
  }
  console.log(`  ✓ ${coverageData.length} coverage records`);

  console.log('\n✅ Seed complete!');
  console.log('   Counterparties:', counterpartiesData.length);
  console.log('   Projects:      ', projectsData.length, '(new)');
  console.log('   Source files:  ', sourceFilesData.length);
  console.log('   Biz documents: ', bizDocsData.length);
  console.log('   Payments:      ', paymentsData.length);
  console.log('   Recon links:   ', links.length);
  console.log('   Missing docs:  ', missing.length);
  console.log('   Coverage:      ', coverageData.length);
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
