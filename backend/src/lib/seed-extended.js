/**
 * Studio Botema ERP — Extended Business Cases + Inventory Seed
 * Speedy COD, Micro.bg 188-195, Omega Light, ЕТ РОС, DHL detail
 * СИЛТЕМ inventory movements (DELIVERY_IN, WRITE_OFF, CLIENT_DELIVERY)
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding extended business cases + inventory...\n');

  // ── Re-fetch counterparties seeded earlier ───────────────────────────────
  const allCp = await prisma.counterparty.findMany();
  const cp = Object.fromEntries(allCp.map(c => [c.id.replace('seed-cp-', ''), c]));

  const allBd = await prisma.bizDocument.findMany();
  const bd = Object.fromEntries(allBd.map(d => [d.id.replace('seed-bd-', ''), d]));

  const allProj = await prisma.project.findMany();
  const proj = Object.fromEntries(allProj.map(p => [p.code, p]));

  // ── EXTRA COUNTERPARTIES ─────────────────────────────────────────────────

  const extraCp = [
    { key: 'speedy2', name: 'Speedy — Наложен платеж', type: 'COURIER', country: 'BG', currency: 'BGN' },
    { key: 'omega2',  name: 'Omega Light ЕООД',         type: 'SUPPLIER', country: 'BG', currency: 'BGN' },
    { key: 'et_ros2', name: 'ЕТ РОС — LED ленти',       type: 'CLIENT',   country: 'BG', currency: 'BGN' },
  ];
  for (const c of extraCp) {
    const { key, ...data } = c;
    await prisma.counterparty.upsert({
      where: { id: `seed-cp-${key}` },
      update: {},
      create: { id: `seed-cp-${key}`, ...data },
    });
  }

  // ── MICRO.BG ФАКТУРИ 188–195 ─────────────────────────────────────────────
  console.log('  Micro.bg изходящи фактури 188–195...');

  const microInvoices = [
    { no: '188', date: '2025-09-05',  net: 850,   vat: 170,   total: 1020  },
    { no: '189', date: '2025-09-18',  net: 1200,  vat: 240,   total: 1440  },
    { no: '190', date: '2025-10-03',  net: 640,   vat: 128,   total: 768   },
    { no: '191', date: '2025-10-22',  net: 950,   vat: 190,   total: 1140  },
    { no: '192', date: '2025-11-07',  net: 1800,  vat: 360,   total: 2160  },
    { no: '193', date: '2025-11-15',  net: 8500,  vat: 1700,  total: 10200 },  // СИЛТЕМ
    { no: '194', date: '2025-12-02',  net: 560,   vat: 112,   total: 672   },
    { no: '195', date: '2025-12-18',  net: 2300,  vat: 460,   total: 2760  },
  ];

  for (const inv of microInvoices) {
    const cpId = inv.no === '193' ? cp['siltem']?.id : cp['micro_bg']?.id;
    await prisma.bizDocument.upsert({
      where: { id: `seed-bd-microbg-${inv.no}` },
      update: {},
      create: {
        id: `seed-bd-microbg-${inv.no}`,
        docType: 'INVOICE_OUT',
        docNumber: inv.no,
        docDate: new Date(inv.date),
        currency: 'BGN',
        amountNet: inv.net,
        vatAmount: inv.vat,
        amountTotal: inv.total,
        vatType: 'STANDARD_BG',
        status: inv.no === '193' ? 'MATCHED' : 'IMPORTED',
        counterpartyId: cpId,
        projectId: inv.no === '193' ? proj['1717.209']?.id : null,
        notes: `Изходяща фактура ${inv.no} — Micro.bg`,
      },
    });
  }
  console.log(`    ✓ ${microInvoices.length} Micro.bg invoices`);

  // ── SPEEDY COD ПЛАЩАНИЯ ──────────────────────────────────────────────────
  console.log('  Speedy COD плащания...');

  const speedyCOD = [
    { ref: 'COD-2026-001', date: '2026-01-15', amount: 89.99  },
    { ref: 'COD-2026-002', date: '2026-01-28', amount: 145.00 },
    { ref: 'COD-2026-003', date: '2026-02-10', amount: 210.50 },
    { ref: 'COD-2026-004', date: '2026-02-25', amount: 67.80  },
    { ref: 'COD-2026-005', date: '2026-03-12', amount: 320.00 },
    { ref: 'COD-2026-006', date: '2026-03-28', amount: 185.00 },
    { ref: 'COD-2026-007', date: '2026-04-10', amount: 420.50 },
  ];

  for (const cod of speedyCOD) {
    await prisma.payment.upsert({
      where: { id: `seed-pay-${cod.ref}` },
      update: {},
      create: {
        id: `seed-pay-${cod.ref}`,
        paymentType: 'COD',
        paymentDate: new Date(cod.date),
        amount: cod.amount,
        currency: 'BGN',
        counterpartyId: cp['speedy']?.id,
        reference: cod.ref,
        status: 'UNMATCHED',
        notes: 'Speedy наложен платеж — трябва да се свърже с онлайн поръчка/фактура',
      },
    });
  }
  console.log(`    ✓ ${speedyCOD.length} Speedy COD payments`);

  // ── OMEGA LIGHT ДОКУМЕНТИ ────────────────────────────────────────────────
  console.log('  Omega Light...');

  await prisma.bizDocument.upsert({
    where: { id: 'seed-bd-omega-inv-1' },
    update: {},
    create: {
      id: 'seed-bd-omega-inv-1',
      docType: 'INVOICE_IN',
      docNumber: 'OML-2026-041',
      docDate: new Date('2026-03-20'),
      currency: 'BGN',
      amountNet: 4200,
      vatAmount: 840,
      amountTotal: 5040,
      vatType: 'STANDARD_BG',
      status: 'NEEDS_REVIEW',
      counterpartyId: cp['omega']?.id,
      internalRef: 'OML-000001',
      notes: 'Omega Light — захранвания и стоки. Вътрешен код OML-000001.',
    },
  });
  console.log('    ✓ Omega Light invoice');

  // ── ЕТ РОС LED ЛЕНТИ ────────────────────────────────────────────────────
  console.log('  ЕТ РОС LED ленти...');

  await prisma.bizDocument.upsert({
    where: { id: 'seed-bd-etros-inv-1' },
    update: {},
    create: {
      id: 'seed-bd-etros-inv-1',
      docType: 'INVOICE_OUT',
      docNumber: 'ETROS-2026-01',
      docDate: new Date('2026-04-05'),
      currency: 'BGN',
      amountNet: 1850,
      vatAmount: 370,
      amountTotal: 2220,
      vatType: 'STANDARD_BG',
      status: 'NEEDS_REVIEW',
      counterpartyId: cp['et_ros']?.id,
      notes: 'ЕТ РОС — LED ленти и консумативи. Изписване от склад.',
    },
  });
  console.log('    ✓ ЕТ РОС invoice');

  // ── INVENTORY: СИЛТЕМ 1717.209 ───────────────────────────────────────────
  const siltemProj = proj['1717.209'];
  if (!siltemProj) {
    console.log('    ⚠ Project 1717.209 not found, skipping inventory');
  } else {
    console.log('\n  СИЛТЕМ inventory movements (1717.209)...');

    const inv193 = await prisma.bizDocument.findFirst({ where: { docNumber: '193' } });

    // Стоки доставени за проект СИЛТЕМ
    const siltemItems = [
      { supId:'sup-lodes',  code:'LODES-ELARA-S',  name:'Lodes Elara S — Стенна лампа',        cat:'LIGHTING',    qtyIn:4,  unit:'бр',  price:380  },
      { supId:'sup-lodes',  code:'LODES-ELARA-M',  name:'Lodes Elara M — Стенна лампа',        cat:'LIGHTING',    qtyIn:2,  unit:'бр',  price:520  },
      { supId:'sup-nov',    code:'NOVA-AUR-60',    name:'NovaLuce Aurelia 60 — Таванна лампа', cat:'LIGHTING',    qtyIn:6,  unit:'бр',  price:290  },
      { supId:'sup-alpha',  code:'LED-STRIP-WW',   name:'LED лента топло бяло 24V 14W/м',     cat:'ELECTRICAL',  qtyIn:48, unit:'м',   price:18.5 },
      { supId:'sup-alpha',  code:'LED-STRIP-CW',   name:'LED лента студено бяло 24V 14W/м',   cat:'ELECTRICAL',  qtyIn:24, unit:'м',   price:18.5 },
      { supId:'sup-alpha',  code:'DRV-MEAN-100',   name:'Mean Well захранване 100W 24V',       cat:'ELECTRICAL',  qtyIn:4,  unit:'бр',  price:85   },
      { supId:'sup-alpha',  code:'DRV-MEAN-200',   name:'Mean Well захранване 200W 24V',       cat:'ELECTRICAL',  qtyIn:2,  unit:'бр',  price:145  },
      { supId:'sup-alpha',  code:'CON-DIMMER',     name:'Dimmer контролер PWM',                cat:'ELECTRICAL',  qtyIn:6,  unit:'бр',  price:45   },
    ];

    for (const item of siltemItems) {
      const invItem = await prisma.inventoryItem.upsert({
        where: { id: `seed-inv-siltem-${item.code}` },
        update: {},
        create: {
          id: `seed-inv-siltem-${item.code}`,
          supplierId: item.supId,
          projectId: siltemProj.id,
          code: item.code,
          name: item.name,
          category: item.cat,
          qtyIn: item.qtyIn,
          qtyOut: 0,
          notes: `СИЛТЕМ 1717.209 — доставено. Цена: ${item.price} EUR/бр`,
        },
      });

      // StockMovement DELIVERY_IN
      await prisma.stockMovement.upsert({
        where: { id: `seed-sm-in-${item.code}` },
        update: {},
        create: {
          id: `seed-sm-in-${item.code}`,
          itemId: invItem.id,
          type: 'IN',
          qty: item.qtyIn,
          date: new Date('2025-10-15'),
          reference: `Invoice ${inv193?.docNumber ?? '193'} / 1717.209`,
          notes: 'Входяща доставка СИЛТЕМ',
        },
      });
    }
    console.log(`    ✓ ${siltemItems.length} inventory items (СИЛТЕМ) + IN movements`);

    // WRITE_OFF: LED лента топло бяло — 47м изписани за клиента
    const ledItem = await prisma.inventoryItem.findUnique({ where: { id: 'seed-inv-siltem-LED-STRIP-WW' } });
    if (ledItem) {
      await prisma.inventoryItem.update({
        where: { id: ledItem.id },
        data: { qtyOut: 47 },
      });
      await prisma.stockMovement.upsert({
        where: { id: 'seed-sm-out-LED-STRIP-WW' },
        update: {},
        create: {
          id: 'seed-sm-out-LED-STRIP-WW',
          itemId: ledItem.id,
          type: 'OUT',
          qty: 47,
          date: new Date('2025-11-15'),
          reference: 'Invoice 193 — СИЛТЕМ изписване',
          notes: 'Нарязани: 4×5м + 3×6м + 2×9м = 47м. 1м отпадък.',
        },
      });
      console.log('    ✓ LED лента WW — WRITE_OFF 47м');
    }

    // WRITE_OFF: LED лента студено бяло — 22м
    const ledCW = await prisma.inventoryItem.findUnique({ where: { id: 'seed-inv-siltem-LED-STRIP-CW' } });
    if (ledCW) {
      await prisma.inventoryItem.update({ where: { id: ledCW.id }, data: { qtyOut: 22 } });
      await prisma.stockMovement.upsert({
        where: { id: 'seed-sm-out-LED-STRIP-CW' },
        update: {},
        create: {
          id: 'seed-sm-out-LED-STRIP-CW',
          itemId: ledCW.id,
          type: 'OUT',
          qty: 22,
          date: new Date('2025-11-15'),
          reference: 'Invoice 193 — СИЛТЕМ изписване',
          notes: '22м изписани. 2м остатък в склада.',
        },
      });
      console.log('    ✓ LED лента CW — WRITE_OFF 22м');
    }
  }

  // ── COVERAGE UPDATE ──────────────────────────────────────────────────────
  await prisma.coverage.updateMany({
    where: { source: 'DRIVE', path: 'Drive/2025' },
    data: { notes: 'First-level done. Подпапки остават: Purchases/Lodes, Purchases/Alphaluce, Invoices/Out, Protocols' },
  });

  console.log('\n✅ Extended seed complete!');
  console.log('   Micro.bg invoices 188–195: 8');
  console.log('   Speedy COD payments:       7');
  console.log('   Omega Light invoice:       1');
  console.log('   ЕТ РОС invoice:            1');
  console.log('   СИЛТЕМ inventory items:    8 + 1 write_off');
}

main()
  .catch(e => { console.error('Seed failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
