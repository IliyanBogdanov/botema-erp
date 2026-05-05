const cron = require('node-cron');
const { google } = require('googleapis');

const BGN_PER_EUR = 1.95583;

const toNumber = value => {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const asBgn = (amount, currency) => currency === 'EUR' ? toNumber(amount) * BGN_PER_EUR : toNumber(amount);

async function ensureAlert(prisma, data) {
  const existing = await prisma.alert.findFirst({
    where: {
      status: { in: ['ACTIVE', 'SNOOZED'] },
      type: data.type,
      title: data.title,
      documentId: data.documentId || null,
      invoiceId: data.invoiceId || null,
      purchaseId: data.purchaseId || null,
      projectId: data.projectId || null,
    },
  });
  if (existing) return existing;
  return prisma.alert.create({ data });
}

async function generateAlerts(prisma) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const startOfYear = new Date(`${currentYear}-01-01T00:00:00.000Z`);
  const created = [];

  const pendingDocs = await prisma.document.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  for (const doc of pendingDocs) {
    const flags = Array.isArray(doc.riskFlags) ? doc.riskFlags : [];
    const hasRawOnly = Boolean(doc.extractedData?.raw);
    created.push(await ensureAlert(prisma, {
      type: 'DOCUMENT',
      severity: flags.includes('DUPLICATE_INVOICE') || hasRawOnly ? 'CRITICAL' : 'WARNING',
      title: `Документ чака решение: ${doc.filename}`,
      description: flags.length
        ? `Документът има рискове: ${flags.join(', ')}. Потвърди действие преди запис.`
        : 'Документът е извлечен и чака да избереш как да бъде вкаран.',
      documentId: doc.id,
      metadata: { flags, suggestedAction: doc.suggestedAction },
    }));

    if (flags.includes('MISSING_VAT')) {
      created.push(await ensureAlert(prisma, {
        type: 'VAT',
        severity: 'WARNING',
        title: `Липсва ДДС в документ: ${doc.filename}`,
        description: 'Провери дали има право на данъчен кредит и попълни ДДС преди запис.',
        documentId: doc.id,
        metadata: { flags },
      }));
    }
  }

  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { dueDate: { lt: now } },
        { dueDate: null, date: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } },
      ],
    },
    include: { client: { select: { name: true } } },
  });

  for (const invoice of overdueInvoices) {
    created.push(await ensureAlert(prisma, {
      type: 'REVENUE',
      severity: 'CRITICAL',
      title: `Просрочена фактура ${invoice.number}`,
      description: `${invoice.client?.name || 'Клиент'} дължи ${toNumber(invoice.amountTotal).toFixed(2)} ${invoice.currency}.`,
      invoiceId: invoice.id,
    }));
  }

  const invoicesWithoutProject = await prisma.invoice.findMany({
    where: { projectId: null, status: { not: 'CANCELLED' }, date: { gte: startOfYear } },
    take: 25,
    include: { client: { select: { name: true } } },
  });
  for (const invoice of invoicesWithoutProject) {
    created.push(await ensureAlert(prisma, {
      type: 'DATA_QUALITY',
      severity: 'INFO',
      title: `Фактура без проект ${invoice.number}`,
      description: `${invoice.client?.name || 'Клиент'} няма свързан проект. Това може да изкриви маржа по проекти.`,
      invoiceId: invoice.id,
    }));
  }

  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    include: { invoices: true, purchases: true },
  });
  for (const project of projects) {
    const revenue = project.invoices
      .filter(i => i.status !== 'CANCELLED')
      .reduce((s, i) => s + asBgn(i.amountNet, i.currency), 0);
    const costs = project.purchases.reduce((s, p) => s + asBgn(p.amount, p.currency), 0);
    if (revenue > 0 && costs / revenue > 0.8) {
      created.push(await ensureAlert(prisma, {
        type: 'PROJECT',
        severity: 'WARNING',
        title: `Нисък марж по проект ${project.code}`,
        description: `Разходите са ${(costs / revenue * 100).toFixed(1)}% от приходите. Провери цени, доставки и липсващи приходи.`,
        projectId: project.id,
        metadata: { revenue, costs },
      }));
    }
  }

  const purchasesWithNumbers = await prisma.purchase.findMany({
    where: { invoiceNo: { not: null } },
    select: { supplierId: true, invoiceNo: true },
  });
  const duplicateMap = new Map();
  for (const purchase of purchasesWithNumbers) {
    const invoiceNo = String(purchase.invoiceNo || '').trim();
    if (!invoiceNo) continue;
    const key = `${purchase.supplierId}:${invoiceNo}`;
    duplicateMap.set(key, { supplierId: purchase.supplierId, invoiceNo, count: (duplicateMap.get(key)?.count || 0) + 1 });
  }
  for (const duplicate of [...duplicateMap.values()].filter(d => d.count > 1)) {
    created.push(await ensureAlert(prisma, {
      type: 'VAT',
      severity: 'CRITICAL',
      title: `Дублирана входяща фактура ${duplicate.invoiceNo}`,
      description: 'Има повече от един запис със същия доставчик и номер. Провери преди ДДС отчет.',
      metadata: duplicate,
    }));
  }

  return created.filter(Boolean);
}

function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

const encodeMail = value => Buffer.from(value)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

async function sendDailyDigest(prisma) {
  const recipient = process.env.ALERT_EMAIL_TO || process.env.ADMIN_EMAIL || process.env.GMAIL_ALERT_TO;
  if (!recipient) return { skipped: true, reason: 'Missing ALERT_EMAIL_TO/ADMIN_EMAIL' };

  await generateAlerts(prisma);
  const alerts = await prisma.alert.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
    },
    orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
    take: 30,
  });
  if (!alerts.length) return { skipped: true, reason: 'No active alerts' };

  const lines = [
    `To: ${recipient}`,
    'Subject: Studio Botema ERP - дневни сигнали',
    'Content-Type: text/plain; charset=utf-8',
    '',
    `Активни сигнали: ${alerts.length}`,
    '',
    ...alerts.map(a => `[${a.severity}] ${a.title}\n${a.description}\n`),
  ];

  const gmail = getGmailClient();
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodeMail(lines.join('\r\n')) },
  });
  return { sent: true, count: alerts.length };
}

function startAlertJobs(prisma) {
  if (process.env.ENABLE_ALERT_DIGEST === 'false') return;
  cron.schedule('30 8 * * *', () => {
    sendDailyDigest(prisma).catch(err => console.error('Alert digest error:', err));
  }, { timezone: process.env.TZ || 'Europe/Sofia' });
}

module.exports = { generateAlerts, sendDailyDigest, startAlertJobs, ensureAlert };
