const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const prisma = require('../src/lib/prisma');

const SEED_MARKER = '[seed:realistic-invoices-v1]';
const VAT_RATE = 0.2;

const INVOICE_PLANS = [
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PAID',
    date: '2025-01-28',
    dueDate: '2025-02-07',
    grossTotal: 18600,
    projectHints: ['оренда', '1717.171'],
    description: 'Интериорен дизайн и работен проект за корпоративен офис',
    items: [
      { description: 'Концепция, функционално разпределение и moodboard', weight: 0.34 },
      { description: '3D визуализации и материална спецификация', weight: 0.38 },
      { description: 'Работен проект и координация с изпълнители', weight: 0.28 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PAID',
    date: '2025-02-19',
    dueDate: '2025-03-05',
    grossTotal: 7320,
    projectHints: ['ион', '1717.160'],
    description: 'Консултация и подбор на обзавеждане за жилищен интериор',
    items: [
      { description: 'Дизайнерска консултация и подбор на мебели', weight: 0.46 },
      { description: 'Спецификация за осветление и декоративни елементи', weight: 0.29 },
      { description: 'Координация на поръчки и доставки', weight: 0.25 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'OVERDUE',
    date: '2025-03-14',
    dueDate: '2025-03-28',
    grossTotal: 14520,
    projectHints: ['крyмов', 'крумов', '1717.162'],
    description: 'Доставка на осветителни тела и монтаж за апартамент',
    items: [
      { description: 'Доставка на декоративни осветителни тела', weight: 0.62 },
      { description: 'Монтаж и настройка на осветлението', weight: 0.24 },
      { description: 'Финален оглед и корекции по сцени', weight: 0.14 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PAID',
    date: '2025-04-23',
    dueDate: '2025-05-07',
    grossTotal: 27840,
    projectHints: ['хорозов', '1717.193'],
    description: 'Обзавеждане по индивидуален проект и авторски надзор',
    items: [
      { description: 'Работен проект за общи части и кабинети', weight: 0.31 },
      { description: 'Доставка на мебели по спецификация', weight: 0.49 },
      { description: 'Авторски надзор по монтажните дейности', weight: 0.20 },
    ],
  },
  {
    brand: 'LUMINAVERA',
    status: 'PENDING',
    date: '2025-05-16',
    dueDate: '2026-08-05',
    grossTotal: 5940,
    clientHints: ['кд уайнс'],
    description: 'Светлотехническа консултация и примерна схема за винен бар',
    items: [
      { description: 'Светлотехнически анализ и разпределение по зони', weight: 0.44 },
      { description: 'Подбор на декоративни пендели и LED профили', weight: 0.34 },
      { description: 'Презентация на мостри и корекции', weight: 0.22 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'OVERDUE',
    date: '2025-06-11',
    dueDate: '2025-06-25',
    grossTotal: 4320,
    projectHints: ['желязко', '1717.182'],
    description: 'Проектна консултация и подбор на декоративно осветление',
    items: [
      { description: 'Онлайн и присъствена консултация', weight: 0.33 },
      { description: 'Подбор на тела и мостри за одобрение', weight: 0.37 },
      { description: 'Светлинни сценарии и количествена сметка', weight: 0.30 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PAID',
    date: '2025-07-09',
    dueDate: '2025-07-23',
    grossTotal: 22800,
    projectHints: ['делабар', '1717.27'],
    description: 'Доставка и монтаж на дизайнерски осветителни решения за шоурум',
    items: [
      { description: 'Доставка на осветителни тела Lodes и NovaLuce', weight: 0.68 },
      { description: 'Монтаж и насочване на осветлението', weight: 0.20 },
      { description: 'Финални настройки и обучение на екипа', weight: 0.12 },
    ],
  },
  {
    brand: 'LUMINAVERA',
    status: 'PAID',
    date: '2025-08-21',
    dueDate: '2025-09-04',
    grossTotal: 9600,
    clientHints: ['пъмп', 'pump'],
    description: 'Декоративно осветление и монтаж за бутиков фитнес бар',
    items: [
      { description: 'Доставка на декоративни аплици и шини', weight: 0.55 },
      { description: 'Монтаж на осветителни кръгове', weight: 0.27 },
      { description: 'Настройка на димиране и сцени', weight: 0.18 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'OVERDUE',
    date: '2025-09-12',
    dueDate: '2025-09-26',
    grossTotal: 32400,
    projectHints: ['алог', '1717.03'],
    description: 'Доставка на мебели по индивидуален проект за офисна среда',
    items: [
      { description: 'Корпусна мебел по поръчка', weight: 0.51 },
      { description: 'Тапицирани елементи и маси', weight: 0.31 },
      { description: 'Монтаж, нивелация и финални корекции', weight: 0.18 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PENDING',
    date: '2025-10-17',
    dueDate: '2026-09-12',
    grossTotal: 8400,
    projectHints: ['вита', '1717.04'],
    description: 'Интериорна концепция и мостри за рецепция и зала за срещи',
    items: [
      { description: 'Концепция и колаж с материали', weight: 0.39 },
      { description: '3D визуализации и спецификация', weight: 0.36 },
      { description: 'Подготовка на оферта и бюджет', weight: 0.25 },
    ],
  },
  {
    brand: 'LUMINAVERA',
    status: 'OVERDUE',
    date: '2025-11-06',
    dueDate: '2025-11-20',
    grossTotal: 12540,
    clientHints: ['хоум инвестгруп', 'инвестгруп'],
    description: 'Доставка на архитектурно осветление за общи части',
    items: [
      { description: 'Доставка на downlight и wall washer тела', weight: 0.63 },
      { description: 'Монтажни аксесоари и драйвери', weight: 0.17 },
      { description: 'Настройка на сценариите по етажи', weight: 0.20 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PAID',
    date: '2025-12-09',
    dueDate: '2025-12-23',
    grossTotal: 36720,
    projectHints: ['сигничър', '1717.183'],
    description: 'Комплексна доставка на мебели, осветление и монтаж',
    items: [
      { description: 'Доставка на мебели и декоративни осветителни тела', weight: 0.57 },
      { description: 'Монтаж на мебели и електроаксесоари', weight: 0.25 },
      { description: 'Координация с подизпълнители и финален стайлинг', weight: 0.18 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'OVERDUE',
    date: '2026-01-15',
    dueDate: '2026-01-29',
    grossTotal: 5160,
    projectHints: ['одая', '1717.173'],
    description: 'Допълнителна доставка на осветление и монтажни услуги',
    items: [
      { description: 'Доставка на допълнителни осветителни тела', weight: 0.58 },
      { description: 'Монтаж и повторно позициониране', weight: 0.26 },
      { description: 'Финален тест и предаване', weight: 0.16 },
    ],
  },
  {
    brand: 'LUMINAVERA',
    status: 'PAID',
    date: '2026-02-18',
    dueDate: '2026-03-04',
    grossTotal: 22140,
    clientHints: ['кд уайнс'],
    description: 'Доставка на дизайнерско осветление за дегустационна зала',
    items: [
      { description: 'Пендели, линейни профили и захранвания', weight: 0.61 },
      { description: 'Монтаж, центровка и фокусиране', weight: 0.24 },
      { description: 'Програмиране на светлинни сцени', weight: 0.15 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PENDING',
    date: '2026-03-21',
    dueDate: '2026-10-15',
    grossTotal: 9360,
    projectHints: ['надежда', '1717.01'],
    description: 'Изработка на индивидуална мебел и огледало по размер',
    items: [
      { description: 'Проектиране и работни чертежи', weight: 0.24 },
      { description: 'Изработка на мебел и огледало по размер', weight: 0.56 },
      { description: 'Доставка и монтаж на адрес', weight: 0.20 },
    ],
  },
  {
    brand: 'LUMINAVERA',
    status: 'PAID',
    date: '2026-04-24',
    dueDate: '2026-05-08',
    grossTotal: 44880,
    clientHints: ['хоум инвестгруп', 'инвестгруп'],
    description: 'Цялостна доставка на осветление за жилищен комплекс',
    items: [
      { description: 'Доставка на фасадно и интериорно осветление', weight: 0.69 },
      { description: 'Монтажни комплекти и драйвери', weight: 0.11 },
      { description: 'Координация на монтаж и настройка по апартаменти', weight: 0.20 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'CANCELLED',
    date: '2026-05-12',
    dueDate: '2026-05-26',
    grossTotal: 6720,
    projectHints: ['рашев', '1717.02'],
    description: 'Отменена поръчка за мостри, консултация и примерен сет мебели',
    items: [
      { description: 'Консултация и примерни материали', weight: 0.42 },
      { description: 'Подготовка на мостри и ориентировъчна оферта', weight: 0.35 },
      { description: 'Логистика за мострени комплекти', weight: 0.23 },
    ],
  },
  {
    brand: 'STUDIO_BOTEMA',
    status: 'PENDING',
    date: '2026-06-27',
    dueDate: '2026-11-20',
    grossTotal: 25800,
    projectHints: ['оренда', '1717.172'],
    description: 'Финално обзавеждане и стайлинг за представителни пространства',
    items: [
      { description: 'Доставка на мебели, текстил и декорация', weight: 0.58 },
      { description: 'Структуриране на монтажните дейности', weight: 0.19 },
      { description: 'Финален стайлинг и подготовка за заснемане', weight: 0.23 },
    ],
  },
];

function round2(value) {
  return Number(value.toFixed(2));
}

function normalizeText(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildItems(grossTotal, itemTemplates) {
  const totalNet = round2(grossTotal / (1 + VAT_RATE));
  const weights = itemTemplates.reduce((sum, item) => sum + item.weight, 0);
  const items = [];
  let runningNet = 0;
  let runningGross = 0;

  itemTemplates.forEach((template, index) => {
    const isLast = index === itemTemplates.length - 1;
    const net = isLast
      ? round2(totalNet - runningNet)
      : round2(totalNet * (template.weight / weights));
    const gross = isLast
      ? round2(grossTotal - runningGross)
      : round2(net * (1 + VAT_RATE));

    items.push({
      description: template.description,
      qty: 1,
      unitPrice: net,
      vatPct: 20,
      total: gross,
    });

    runningNet = round2(runningNet + net);
    runningGross = round2(runningGross + gross);
  });

  return {
    items,
    amountNet: totalNet,
    vatAmount: round2(grossTotal - totalNet),
    amountTotal: round2(grossTotal),
  };
}

function findByHints(records, hints, getText) {
  if (!hints || !hints.length) return null;

  const normalizedHints = hints.map(normalizeText).filter(Boolean);
  return records.find(record => {
    const haystack = normalizeText(getText(record));
    return normalizedHints.some(hint => haystack.includes(hint));
  }) || null;
}

async function getNextNumbers(count) {
  const invoices = await prisma.invoice.findMany({
    select: { number: true },
  });

  const maxNumber = invoices.reduce((max, invoice) => {
    const numeric = parseInt(String(invoice.number || '').replace(/\D/g, ''), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  return Array.from({ length: count }, (_, index) => String(maxNumber + index + 1).padStart(10, '0'));
}

async function main() {
  const [clients, projects, users] = await Promise.all([
    prisma.client.findMany({ orderBy: [{ brand: 'asc' }, { name: 'asc' }] }),
    prisma.project.findMany({ where: { clientId: { not: null } }, include: { client: true }, orderBy: [{ year: 'desc' }, { code: 'asc' }] }),
    prisma.user.findMany({ orderBy: { createdAt: 'asc' } }),
  ]);

  if (!clients.length) {
    throw new Error('No clients found in DB. Cannot seed invoices.');
  }

  const studioUser = users.find(user => normalizeText(user.email).includes('studiobotema')) || users[0] || null;
  const luminaveraUser = users.find(user => normalizeText(user.email).includes('luminavera')) || studioUser || users[0] || null;

  const clientsByBrand = {
    STUDIO_BOTEMA: clients.filter(client => client.brand === 'STUDIO_BOTEMA'),
    LUMINAVERA: clients.filter(client => client.brand === 'LUMINAVERA'),
  };

  const projectsByBrand = {
    STUDIO_BOTEMA: projects.filter(project => project.client?.brand === 'STUDIO_BOTEMA'),
    LUMINAVERA: projects.filter(project => project.client?.brand === 'LUMINAVERA'),
  };

  await prisma.invoice.deleteMany({ where: { notes: { contains: SEED_MARKER } } });

  const numberPool = await getNextNumbers(INVOICE_PLANS.length);
  const usedProjectIds = new Set();
  const seededInvoices = [];

  for (let index = 0; index < INVOICE_PLANS.length; index += 1) {
    const plan = INVOICE_PLANS[index];
    const brandClients = clientsByBrand[plan.brand].length ? clientsByBrand[plan.brand] : clients;
    const brandProjects = projectsByBrand[plan.brand] || [];

    let project = findByHints(brandProjects, plan.projectHints, record => `${record.code} ${record.name} ${record.notes || ''} ${record.client?.name || ''}`);
    if (!project && brandProjects.length && plan.projectHints?.length) {
      project = brandProjects.find(candidate => !usedProjectIds.has(candidate.id)) || brandProjects[0] || null;
    }

    if (project) {
      usedProjectIds.add(project.id);
    }

    const client = project?.client
      || findByHints(brandClients, plan.clientHints, record => `${record.name} ${record.notes || ''}`)
      || brandClients[index % brandClients.length]
      || clients[index % clients.length];

    if (!client) {
      throw new Error(`Could not resolve client for invoice plan ${index + 1}`);
    }

    const amounts = buildItems(plan.grossTotal, plan.items);
    const createdById = plan.brand === 'LUMINAVERA' ? luminaveraUser?.id || null : studioUser?.id || null;
    const notes = `${SEED_MARKER} | brand=${plan.brand} | status=${plan.status}`;

    const invoice = await prisma.invoice.create({
      data: {
        number: numberPool[index],
        date: new Date(plan.date),
        dueDate: plan.dueDate ? new Date(plan.dueDate) : null,
        clientId: client.id,
        projectId: project?.clientId === client.id ? project.id : null,
        type: 'INVOICE',
        status: plan.status,
        brand: plan.brand,
        currency: 'BGN',
        amountNet: amounts.amountNet,
        vatAmount: amounts.vatAmount,
        amountTotal: amounts.amountTotal,
        description: plan.description,
        notes,
        createdById,
        items: {
          create: amounts.items,
        },
      },
      include: {
        client: { select: { name: true, brand: true } },
        project: { select: { code: true, name: true } },
        items: { select: { id: true } },
      },
    });

    seededInvoices.push(invoice);
    console.log(`✓ ${invoice.number} | ${invoice.brand} | ${invoice.status} | ${invoice.client.name} | ${invoice.amountTotal} BGN${invoice.project ? ` | ${invoice.project.code}` : ''}`);
  }

  const summary = seededInvoices.reduce((acc, invoice) => {
    acc.total += 1;
    acc.byStatus[invoice.status] = (acc.byStatus[invoice.status] || 0) + 1;
    acc.byBrand[invoice.brand] = (acc.byBrand[invoice.brand] || 0) + 1;
    acc.totalAmount = round2(acc.totalAmount + Number(invoice.amountTotal));
    return acc;
  }, { total: 0, totalAmount: 0, byStatus: {}, byBrand: {} });

  console.log('\nSeed summary:');
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
