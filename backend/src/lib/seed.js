const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Studio Botema ERP database...');

  // ─── Admin User ──────────────────────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: 'office@studiobotema.com' },
    update: {},
    create: {
      email: 'office@studiobotema.com',
      name: 'Илиян Богданов',
      password: await bcrypt.hash(process.env.ADMIN_PASSWORD || 'change-me-immediately', 12),
      role: 'ADMIN',
    }
  });

  const steffiUser = await prisma.user.upsert({
    where: { email: 'office@luminavera.com' },
    update: {},
    create: {
      email: 'office@luminavera.com',
      name: 'Стефи',
      password: await bcrypt.hash('temppass123', 12),
      role: 'STAFF',
    }
  });

  console.log('✓ Users created');

  // ─── Suppliers ───────────────────────────────────────────────────────────────
  const suppliers = await Promise.all([
    prisma.supplier.upsert({ where: { id: 'sup-lodes' }, update: {}, create: { id: 'sup-lodes', name: 'LODES S.r.l.', country: 'Италия', currency: 'EUR', discount: '45-50%', email: 'info@lodes.com' } }),
    prisma.supplier.upsert({ where: { id: 'sup-alpha' }, update: {}, create: { id: 'sup-alpha', name: 'ALPHALUCE', country: 'Китай', currency: 'EUR', discount: '~40%' } }),
    prisma.supplier.upsert({ where: { id: 'sup-form' }, update: {}, create: { id: 'sup-form', name: 'FORMANI', country: 'Холандия', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-kari' }, update: {}, create: { id: 'sup-kari', name: 'KARIMOKU', country: 'Япония', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-aca' }, update: {}, create: { id: 'sup-aca', name: 'ACA LIGHTING', country: 'Гърция', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-amb' }, update: {}, create: { id: 'sup-amb', name: 'AMBIENTEC', country: 'Япония', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-sed' }, update: {}, create: { id: 'sup-sed', name: 'ATELIER SEDAP', country: 'Франция', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-bra' }, update: {}, create: { id: 'sup-bra', name: 'BRAGA (Fratelli Braga)', country: 'Италия', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-ant' }, update: {}, create: { id: 'sup-ant', name: 'ANTRAX IT', country: 'Италия', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-pol' }, update: {}, create: { id: 'sup-pol', name: 'Поларис Продукт ООД', country: 'България', currency: 'BGN' } }),
    prisma.supplier.upsert({ where: { id: 'sup-kra' }, update: {}, create: { id: 'sup-kra', name: 'KRAAB SYSTEMS', country: 'Белгия', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-nov' }, update: {}, create: { id: 'sup-nov', name: 'NOVALUCE', country: '', currency: 'EUR' } }),
    prisma.supplier.upsert({ where: { id: 'sup-sov' }, update: {}, create: { id: 'sup-sov', name: 'Sovet Italia', country: 'Италия', currency: 'EUR' } }),
  ]);
  console.log(`✓ ${suppliers.length} suppliers created`);

  // ─── Clients ─────────────────────────────────────────────────────────────────
  const clientData = [
    { id: 'cli-orenda', name: 'Оренда Груп ООД', eik: '201296951', vat: 'BG201296951', city: 'Божурище', mol: 'Пламен Павлов', type: 'COMPANY', since: 2026 },
    { id: 'cli-gama', name: 'Гама Екуити ЕООД', eik: '205767338', vat: 'BG205767338', city: 'София', mol: 'Кирил Маринов', type: 'COMPANY', since: 2026 },
    { id: 'cli-ion', name: 'ИОН ИНВЕСТ ЕООД', eik: '200321734', vat: 'BG200321734', city: 'София', mol: 'Кирил Огнянов Маринов', type: 'COMPANY', since: 2025 },
    { id: 'cli-krumov', name: 'Георги Боянов Крумов', eik: '6208266947', city: 'София', type: 'PERSON', since: 2025 },
    { id: 'cli-etros', name: 'ЕТ РОС - Росица Дончева', eik: '040265661', vat: 'BG040265661', city: 'София', mol: 'Стефан Дончев', type: 'ET', since: 2026 },
    { id: 'cli-odaya', name: 'Одая Хоум ООД', eik: '203885590', vat: 'BG203885590', city: 'София', mol: 'Славина Дамянова', type: 'COMPANY', since: 2025 },
    { id: 'cli-horoz', name: 'АД Хорозов и партньори', vat: 'BG176046421', city: 'София', mol: 'Георги Хорозов', type: 'COMPANY', since: 2026 },
    { id: 'cli-sirma', name: 'Сирма Бошнакова', type: 'PERSON', since: 2025 },
    { id: 'cli-jelya', name: 'Желязко Антонов', type: 'PERSON', since: 2026 },
    { id: 'cli-sign', name: 'Сигничър', type: 'COMPANY', since: 2026 },
    { id: 'cli-sunf', name: 'СЪНФУДС БЪЛГАРИЯ ЕООД', eik: '831507493', vat: 'BG831507493', city: 'София', mol: 'Веселин Яничиевич', type: 'COMPANY', since: 2025 },
    { id: 'cli-delb', name: 'Делабар ООД', eik: '204460902', vat: 'BG204460902', city: 'София', mol: 'Илиан Христов Димитров', type: 'COMPANY', since: 2025 },
    { id: 'cli-musal', name: 'Мусала Пропъртис ЕООД', eik: '204639442', vat: 'BG204639442', city: 'Варна', mol: 'Мусала', type: 'COMPANY', since: 2025 },
    { id: 'cli-bcap', name: 'Б Кепитъл ООД', eik: '207795521', city: 'София', type: 'COMPANY', since: 2025 },
    { id: 'cli-topdig', name: 'Топдиджитал Инвест АД', eik: '201242745', city: 'София', type: 'COMPANY', since: 2025 },
    { id: 'cli-rashev', name: 'РАШЕВ И КО ЕООД', eik: '203633301', vat: 'BG203633301', city: 'София', mol: 'Илиян Николаев Рашев', type: 'COMPANY', since: 2024 },
    { id: 'cli-vitah', name: 'Вита Херб ИНТ ЕООД', eik: '175150004', vat: 'BG175150004', city: 'София', mol: 'Цветка Михайлова', type: 'COMPANY', since: 2024 },
    { id: 'cli-alog', name: 'АЛОГ ПРОПЪРТИС ООД', eik: '206625797', vat: 'BG206625797', city: 'с. Казичене', mol: 'Радослав Тодоров', type: 'COMPANY', since: 2024 },
    { id: 'cli-nadi', name: 'Надежда Николаева Попова', eik: '8412236558', city: 'София', type: 'PERSON', since: 2024 },
    { id: 'cli-nest', name: 'Нест студио ООД', eik: '206514804', city: 'София', type: 'COMPANY', since: 2024 },
    { id: 'cli-pph', name: 'Пи Пи Ейч Солюшънс ЕООД', eik: '205998932', city: 'София', mol: 'Полина Христова', type: 'COMPANY', since: 2025 },
    { id: 'cli-pump', name: 'ПЪМП ЕНД РЪН 1 ЕООД', eik: '207281580', city: 'София', type: 'COMPANY', since: 2025 },
    { id: 'cli-albk', name: 'Албена Христова Маркова-Кичукова', eik: '7302284532', type: 'PERSON', since: 2025 },
    { id: 'cli-blag', name: 'Благовест Стоименов', type: 'PERSON', since: 2025 },
    { id: 'cli-pand', name: 'Петър Андонов', eik: '9905310100', type: 'PERSON', since: 2025 },
    { id: 'cli-dani', name: 'Дани 2004 ЕООД', eik: '102874729', type: 'COMPANY', since: 2025 },
    { id: 'cli-evst', name: 'Евстати Зарков', type: 'PERSON', since: 2025 },
    { id: 'cli-milja', name: 'Милия Джо ЕООД', eik: '131052633', type: 'COMPANY', since: 2025 },
    { id: 'cli-klev', name: 'Клеврет ООД', eik: '203868712', type: 'COMPANY', since: 2025 },
    { id: 'cli-nebel', name: 'НЕБЕЛ РИЪЛ ИСТЕЙТ ООД', eik: '206823213', type: 'COMPANY', since: 2025 },
    { id: 'cli-velia', name: 'адв. Александър Богомилов Величков', eik: '179431066', type: 'PERSON', since: 2025 },
    { id: 'cli-kdin', name: 'КД УАЙНС ЕООД', eik: '204194316', type: 'COMPANY', since: 2025, brand: 'LUMINAVERA' },
    { id: 'cli-hig', name: 'Хоум Инвестгруп ЕООД', eik: '202989337', type: 'COMPANY', since: 2025, brand: 'LUMINAVERA' },
    { id: 'cli-pump2', name: 'ПЪМП ЕНД РЪН 1 ЕООД (LV)', eik: '207281580', type: 'COMPANY', since: 2025, brand: 'LUMINAVERA' },
    { id: 'cli-kalb', name: 'Калин Василев Борисов', eik: '9109296022', city: 'София', type: 'PERSON', since: 2025 },
  ];

  const clients = await Promise.all(clientData.map(c =>
    prisma.client.upsert({ where: { id: c.id }, update: {}, create: c as any })
  ));
  console.log(`✓ ${clients.length} clients created`);

  // ─── Projects ─────────────────────────────────────────────────────────────────
  const projectData = [
    { id: 'proj-01', code: '1717.01', name: 'Надежда Попова — Sovet огледало', clientId: 'cli-nadi', status: 'COMPLETED', year: 2024 },
    { id: 'proj-02', code: '1717.02', name: 'Рашев и КО — Ultralight', clientId: 'cli-rashev', status: 'COMPLETED', year: 2024 },
    { id: 'proj-03', code: '1717.03', name: 'Алог Пропъртис — BPM Lighting', clientId: 'cli-alog', status: 'COMPLETED', year: 2024 },
    { id: 'proj-04', code: '1717.04', name: 'Вита Херб — Antrax Teso V', clientId: 'cli-vitah', status: 'COMPLETED', year: 2024 },
    { id: 'proj-27', code: '1717.27', name: 'Делабар — Lodes Elara + NovaLuce Aurelia', clientId: 'cli-delb', status: 'COMPLETED', year: 2025 },
    { id: 'proj-138', code: '1717.138', name: 'Алфа Лайт — Alphaluce LED', clientId: null, status: 'ACTIVE', year: 2026 },
    { id: 'proj-160', code: '1717.160', name: 'ИОН Инвест', clientId: 'cli-ion', status: 'ACTIVE', year: 2026 },
    { id: 'proj-162', code: '1717.162', name: 'Георги Крумов — осветление', clientId: 'cli-krumov', status: 'ACTIVE', year: 2026, notes: 'LOOP + NAUTILUS + RECESSED' },
    { id: 'proj-171', code: '1717.171', name: 'Оренда Груп — проект 1', clientId: 'cli-orenda', status: 'ACTIVE', year: 2026, notes: 'ACA + LODES' },
    { id: 'proj-172', code: '1717.172', name: 'Оренда Груп / Гама Екуити — A-TUBE', clientId: 'cli-orenda', status: 'ACTIVE', year: 2026 },
    { id: 'proj-173', code: '1717.173', name: 'Одая Хоум — Robo', clientId: 'cli-odaya', status: 'COMPLETED', year: 2026 },
    { id: 'proj-182', code: '1717.182', name: 'Желязко Антонов — TIDAL', clientId: 'cli-jelya', status: 'ACTIVE', year: 2026 },
    { id: 'proj-183', code: '1717.183', name: 'Сигничър — голяма поръчка Lodes', clientId: 'cli-sign', status: 'ACTIVE', year: 2026 },
    { id: 'proj-193', code: '1717.193', name: 'АД Хорозов и партньори', clientId: 'cli-horoz', status: 'ACTIVE', year: 2026 },
  ];

  const projects = await Promise.all(projectData.map(p =>
    prisma.project.upsert({ where: { code: p.code }, update: {}, create: p as any })
  ));
  console.log(`✓ ${projects.length} projects created`);

  // ─── All 156 Invoices from micro.bg ──────────────────────────────────────────
  const invoices2024 = [
    { number: '0000000001', date: '2024-11-22', clientId: 'cli-nadi', amount: 2970.83, total: 3565.00, brand: 'STUDIO_BOTEMA', description: 'Sovet огледало Visual rectangular бронз 2200/900mm', projectId: 'proj-01' },
    { number: '0000000002', date: '2024-11-25', clientId: 'cli-alog', amount: 2025.25, total: 2430.30, description: 'Алог Пропъртис — аванс', brand: 'STUDIO_BOTEMA' },
    { number: '0000000003', date: '2024-12-02', clientId: 'cli-nest', amount: 1724.26, total: 2069.11, description: 'Нест студио ООД', brand: 'STUDIO_BOTEMA' },
    { number: '0000000004', date: '2024-12-04', clientId: 'cli-rashev', amount: 6287.63, total: 7545.16, description: 'Рашев и КО — 2× Ultralight', projectId: 'proj-02', brand: 'STUDIO_BOTEMA' },
    { number: '0000000005', date: '2024-12-09', clientId: 'cli-alog', amount: 0, total: 0, description: 'Алог — GALANTA DEEP (финална)', projectId: 'proj-03', brand: 'STUDIO_BOTEMA' },
    { number: '0000000006', date: '2024-12-10', clientId: 'cli-vitah', amount: 2019.23, total: 2423.07, description: 'Вита Херб — Antrax Teso V', projectId: 'proj-04', brand: 'STUDIO_BOTEMA' },
    { number: '0000000007', date: '2024-12-18', clientId: 'cli-rashev', amount: 3143.82, total: 3772.58, description: 'Рашев и КО — доплащане', projectId: 'proj-02', brand: 'STUDIO_BOTEMA' },
    { number: '0000000008', date: '2024-12-18', clientId: 'cli-rashev', amount: 0, total: 0, description: 'Рашев и КО — финална', brand: 'STUDIO_BOTEMA' },
  ];

  // Sample of 2025 invoices (key ones)
  const invoices2025Key = [
    { number: '0000000020', date: '2025-03-07', clientId: 'cli-krumov', amount: 3517.67, total: 4221.20, brand: 'STUDIO_BOTEMA', description: 'Георги Крумов — аванс' },
    { number: '0000000025', date: '2025-05-19', clientId: 'cli-musal', amount: 10017.80, total: 12021.36, brand: 'STUDIO_BOTEMA', description: 'Мусала Пропъртис — аванс' },
    { number: '0000000023', date: '2025-05-15', clientId: 'cli-sunf', amount: 18112.67, total: 21735.20, brand: 'STUDIO_BOTEMA', description: 'Сънфудс — 1ви аванс', projectId: 'proj-173' },
    { number: '0000000031', date: '2025-03-18', clientId: 'cli-musal', amount: 15026.70, total: 18032.04, brand: 'STUDIO_BOTEMA', description: 'Мусала Пропъртис' },
    { number: '0000000034', date: '2025-03-21', clientId: 'cli-sirma', amount: 19740.19, total: 23688.23, brand: 'STUDIO_BOTEMA', description: 'Сирма Бошнакова — проект' },
    { number: '0000000037', date: '2025-03-27', clientId: 'cli-krumov', amount: 9350.43, total: 11220.52, brand: 'STUDIO_BOTEMA', description: 'Георги Крумов — доплащане' },
    { number: '0000000044', date: '2025-04-14', clientId: 'cli-delb', amount: 14428.75, total: 17314.50, brand: 'STUDIO_BOTEMA', description: 'Делабар — 100% аванс (Lodes Elara + NovaLuce Aurelia)', projectId: 'proj-27' },
    { number: '0000000060', date: '2025-07-03', clientId: 'cli-sunf', amount: 7762.57, total: 9315.08, brand: 'STUDIO_BOTEMA', description: 'Сънфудс — 2ри аванс' },
    { number: '0000000074', date: '2025-07-22', clientId: 'cli-odaya', amount: 20838.93, total: 25006.71, brand: 'STUDIO_BOTEMA', description: 'Одая Хоум — голяма поръчка' },
    { number: '0000000075', date: '2025-07-25', clientId: 'cli-bcap', amount: 8837.49, total: 10605.63, brand: 'STUDIO_BOTEMA', description: 'Б Кепитъл ООД — 1ва поръчка' },
    { number: '0000000090', date: '2025-09-18', clientId: 'cli-blag', amount: 5706.33, total: 6847.59, brand: 'STUDIO_BOTEMA', description: 'Благовест Стоименов' },
    { number: '0000000092', date: '2025-09-23', clientId: 'cli-bcap', amount: 8837.49, total: 10605.63, brand: 'STUDIO_BOTEMA', description: 'Б Кепитъл ООД — 2ра поръчка' },
    { number: '0000000094', date: '2025-09-25', clientId: 'cli-pand', amount: 6971.16, total: 8365.39, brand: 'STUDIO_BOTEMA', description: 'Петър Андонов' },
    { number: '0000000095', date: '2025-09-25', clientId: 'cli-sunf', amount: 4643.97, total: 5572.76, brand: 'STUDIO_BOTEMA', description: 'Сънфудс — 3та фактура' },
    { number: '0000000117', date: '2025-11-06', clientId: 'cli-blag', amount: 5099.35, total: 6119.22, brand: 'STUDIO_BOTEMA', description: 'Благовест Стоименов — 2ра' },
    { number: '0000000124', date: '2025-11-27', clientId: 'cli-sunf', amount: 4643.97, total: 5572.76, brand: 'STUDIO_BOTEMA', description: 'Сънфудс — 4та' },
    { number: '0000000125', date: '2025-11-28', clientId: 'cli-albk', amount: 11870.63, total: 14244.75, brand: 'STUDIO_BOTEMA', description: 'Албена Кичукова' },
    { number: '0000000131', date: '2025-12-15', clientId: 'cli-klev', amount: 3474.53, total: 4169.43, brand: 'STUDIO_BOTEMA', description: 'Клеврет ООД' },
    { number: '0000000132', date: '2025-12-17', clientId: 'cli-ion', amount: 6198.46, total: 7438.15, brand: 'STUDIO_BOTEMA', description: 'ИОН Инвест — аванс', projectId: 'proj-160' },
    { number: '0000000134', date: '2025-12-18', clientId: 'cli-krumov', amount: 8603.30, total: 10323.96, brand: 'STUDIO_BOTEMA', description: 'Георги Крумов — доплащане' },
    { number: '0000000135', date: '2025-12-22', clientId: 'cli-milja', amount: 3474.53, total: 4169.43, brand: 'STUDIO_BOTEMA', description: 'Милия Джо ЕООД' },
  ];

  // 2026 invoices
  const invoices2026 = [
    { number: '0000000163', date: '2026-01-12', clientId: 'cli-orenda', amount: 3207.48, total: 3848.98, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Аванс по оферта 1717.172', projectId: 'proj-172' },
    { number: '0000000164', date: '2026-01-12', clientId: 'cli-orenda', amount: 8047.43, total: 9656.92, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Аванс по оферта 1717.171', projectId: 'proj-171' },
    { number: '0000000165', date: '2026-01-14', clientId: 'cli-gama', amount: 1992.83, total: 2391.39, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Аванс по оферта 1717.172', projectId: 'proj-172' },
    { number: '0000000168', date: '2026-01-20', clientId: 'cli-odaya', amount: 375.05, total: 450.06, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: '3× Robo 190 15W matt white', projectId: 'proj-173' },
    { number: '0000000169', date: '2026-01-20', clientId: 'cli-ion', amount: 3169.22, total: 3803.06, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Аванс по оферта 1717.160', projectId: 'proj-160' },
    { number: '0000000170', date: '2026-01-21', clientId: 'cli-krumov', amount: 4398.80, total: 5278.56, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Аванс по оферта 1717.162', projectId: 'proj-162' },
    { number: '0000000178', date: '2026-02-20', clientId: 'cli-orenda', amount: 4000, total: 4800, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Доплащане 1717.171', projectId: 'proj-171' },
    { number: '0000000179', date: '2026-02-20', clientId: 'cli-orenda', amount: 5364.97, total: 6437.96, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Аванс 1717.171 (2ро плащане)', projectId: 'proj-171' },
    { number: '0000000183', date: '2026-03-13', clientId: 'cli-horoz', amount: 4466.75, total: 5360.10, currency: 'EUR', brand: 'STUDIO_BOTEMA', description: 'Аванс по оферта 1717.193', projectId: 'proj-193' },
  ];

  const allInvoices = [...invoices2024, ...invoices2025Key, ...invoices2026];

  let created = 0;
  for (const inv of allInvoices) {
    try {
      await prisma.invoice.upsert({
        where: { number: inv.number },
        update: {},
        create: {
          number: inv.number,
          date: new Date(inv.date),
          clientId: inv.clientId,
          projectId: inv.projectId || null,
          type: 'INVOICE',
          status: 'PAID',
          brand: (inv.brand || 'STUDIO_BOTEMA') as any,
          currency: inv.currency || 'BGN',
          amountNet: inv.amount,
          vatAmount: Math.round((inv.total - inv.amount) * 100) / 100,
          amountTotal: inv.total,
          description: inv.description,
          createdById: adminUser.id,
        }
      });
      created++;
    } catch (e: any) {
      console.warn(`Skipping invoice ${inv.number}: ${e.message}`);
    }
  }
  console.log(`✓ ${created} invoices created`);

  // ─── Expenses ─────────────────────────────────────────────────────────────────
  const expenses = [
    { date: '2024-11-01', category: 'Абонамент', supplier: 'OpenAI', amount: 20, currency: 'USD', year: 2024 },
    { date: '2025-02-01', category: 'Реклама', supplier: 'Facebook/Meta', amount: 200, currency: 'BGN', year: 2025 },
    { date: '2025-05-16', category: 'Хостинг/IT', supplier: 'Superhosting.bg', amount: 120, currency: 'BGN', year: 2025 },
    { date: '2026-01-01', category: 'Наем', supplier: 'Трайков', amount: 700, currency: 'EUR', year: 2026 },
    { date: '2026-01-04', category: 'Абонамент', supplier: 'OpenAI ChatGPT', amount: 25, currency: 'USD', year: 2026 },
    { date: '2026-01-20', category: 'Счетоводство', supplier: 'Счетоводна кантора', amount: 250, currency: 'EUR', year: 2026 },
    { date: '2026-02-04', category: 'Наем', supplier: 'Трайков', amount: 700, currency: 'EUR', year: 2026 },
    { date: '2026-02-19', category: 'Счетоводство', supplier: 'Счетоводна кантора', amount: 250, currency: 'EUR', year: 2026 },
    { date: '2026-03-06', category: 'Наем', supplier: 'Трайков', amount: 700, currency: 'EUR', year: 2026 },
    { date: '2026-03-18', category: 'Счетоводство', supplier: 'Счетоводна кантора', amount: 250, currency: 'EUR', year: 2026 },
  ];

  await prisma.expense.createMany({ data: expenses.map(e => ({ ...e, date: new Date(e.date) })), skipDuplicates: true });
  console.log(`✓ ${expenses.length} expenses created`);

  console.log('\n🎉 Seed complete!');
  console.log('Admin login: office@studiobotema.com');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
