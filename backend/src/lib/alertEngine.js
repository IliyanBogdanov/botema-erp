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

function alertDedupeKey(alert) {
  return [
    alert.type,
    alert.title,
    alert.documentId || '',
    alert.invoiceId || '',
    alert.purchaseId || '',
    alert.projectId || '',
  ].join('\u001f');
}

async function resolveDuplicateActiveAlerts(prisma) {
  const alerts = await prisma.alert.findMany({
    where: { status: { in: ['ACTIVE', 'SNOOZED'] } },
    select: {
      id: true,
      type: true,
      title: true,
      status: true,
      documentId: true,
      invoiceId: true,
      purchaseId: true,
      projectId: true,
      detectedAt: true,
    },
    orderBy: { detectedAt: 'desc' },
  });

  const seen = new Set();
  const duplicateIds = [];
  for (const alert of alerts) {
    const key = alertDedupeKey(alert);
    if (seen.has(key)) {
      duplicateIds.push(alert.id);
    } else {
      seen.add(key);
    }
  }

  if (!duplicateIds.length) return 0;
  const result = await prisma.alert.updateMany({
    where: { id: { in: duplicateIds } },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
  return result.count;
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

  // One stable summary alert for pending documents — fixed title for dedup
  if (pendingDocs.length > 0) {
    const critical = pendingDocs.filter(d => Array.isArray(d.riskFlags) && d.riskFlags.includes('DUPLICATE_INVOICE'));
    const severity = critical.length > 0 ? 'CRITICAL' : 'WARNING';
    const byType = pendingDocs.reduce((acc, d) => { acc[d.type] = (acc[d.type] || 0) + 1; return acc; }, {});
    const typeStr = Object.entries(byType).map(([t, n]) => `${t}: ${n}`).join(', ');
    created.push(await ensureAlert(prisma, {
      type: 'DOCUMENT',
      severity,
      title: 'Чакащи документи за обработка',
      description: `${pendingDocs.length} документа чакат преглед: ${typeStr}. Отвори "Документи" за детайли.`,
      metadata: { count: pendingDocs.length, byType },
    }));
  }

  // Critical-only: duplicate invoice alerts per document
  for (const doc of pendingDocs) {
    const flags = Array.isArray(doc.riskFlags) ? doc.riskFlags : [];
    if (flags.includes('DUPLICATE_INVOICE')) {
      created.push(await ensureAlert(prisma, {
        type: 'DOCUMENT',
        severity: 'CRITICAL',
        title: `Възможен дубликат: ${doc.filename}`,
        description: 'Документът изглежда дублиран. Провери преди запис.',
        documentId: doc.id,
        metadata: { flags },
      }));
    }
    // Per-document MISSING_VAT alerts removed entirely (2026-07-10): most EU
    // supplier invoices legitimately carry no Bulgarian VAT (reverse charge),
    // so the alert was ~95% noise at scale. MISSING_VAT stays visible as a
    // riskFlag in the review UI; the pending-documents summary alert covers
    // the queue itself.
  }

  // Auto-resolve REVENUE alerts for invoices that are no longer PENDING
  const activeRevenueAlerts = await prisma.alert.findMany({
    where: { status: 'ACTIVE', type: 'REVENUE', invoiceId: { not: null } },
    select: { id: true, invoiceId: true },
  });
  if (activeRevenueAlerts.length > 0) {
    const resolvedIds = [];
    for (const a of activeRevenueAlerts) {
      const inv = await prisma.invoice.findUnique({ where: { id: a.invoiceId }, select: { status: true } });
      if (!inv || inv.status !== 'PENDING') resolvedIds.push(a.id);
    }
    if (resolvedIds.length > 0) {
      await prisma.alert.updateMany({ where: { id: { in: resolvedIds } }, data: { status: 'RESOLVED' } });
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

  const twoYearsAgo = new Date(`${currentYear - 2}-01-01T00:00:00.000Z`);
  const invoicesWithoutProject = await prisma.invoice.findMany({
    where: { projectId: null, status: { not: 'CANCELLED' }, date: { gte: twoYearsAgo } },
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

  // Project costs from BizDocument INVOICE_IN (authoritative, net) — same as projects.js
  const { AUTHORITATIVE_BIZ_DOC_STATUSES, netCostAmount } = require('./costs');
  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    include: {
      invoices: true,
      bizDocuments: {
        where: { docType: 'INVOICE_IN', status: { in: AUTHORITATIVE_BIZ_DOC_STATUSES } },
        select: { amountNet: true, vatAmount: true, amountTotal: true, currency: true },
      },
    },
  });
  for (const project of projects) {
    const revenue = project.invoices
      .filter(i => i.status !== 'CANCELLED')
      .reduce((s, i) => s + asBgn(i.amountNet, i.currency), 0);
    const costs = project.bizDocuments.reduce((s, d) => s + asBgn(netCostAmount(d), d.currency), 0);
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

  // Duplicate-invoice alerts from the legacy Purchase table were removed
  // (2026-07-09): Purchase is an archive, costs come from BizDocument where
  // duplicates are handled by the review queue — those alerts were noise.

  await resolveDuplicateActiveAlerts(prisma);
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

const encodeMimeWord = value => `=?UTF-8?B?${Buffer.from(String(value), 'utf8').toString('base64')}?=`;

async function getAuthenticatedMailbox(gmail) {
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.emailAddress || null;
}

function buildDigestHtml(alerts) {
  const SEV_COLOR = { CRITICAL: '#ff453a', WARNING: '#ff9f0a', INFO: '#0a84ff' };
  const SEV_BG    = { CRITICAL: '#ff453a22', WARNING: '#ff9f0a22', INFO: '#0a84ff22' };
  const date = new Date().toLocaleDateString('bg-BG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const critical = alerts.filter(a => a.severity === 'CRITICAL');
  const rest = alerts.filter(a => a.severity !== 'CRITICAL');

  const alertRow = (a) => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #27272a">
        <span style="display:inline-block;padding:2px 8px;font-size:10px;font-weight:700;letter-spacing:.08em;
          color:${SEV_COLOR[a.severity]||'#888'};background:${SEV_BG[a.severity]||'#88888822'};margin-bottom:6px">
          ${a.severity}
        </span>
        <div style="font-size:14px;color:#e5e5e5;font-weight:500;margin-bottom:4px">${a.title}</div>
        <div style="font-size:12px;color:#888">${a.description}</div>
      </td>
    </tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">

    <div style="margin-bottom:24px">
      <div style="font-size:10px;letter-spacing:.12em;color:#0a84ff;text-transform:uppercase;margin-bottom:4px">Studio Botema ERP</div>
      <h1 style="margin:0;font-size:22px;color:#e5e5e5;font-weight:600">Дневен дайджест</h1>
      <p style="margin:4px 0 0;font-size:12px;color:#555">${date}</p>
    </div>

    ${critical.length > 0 ? `
    <div style="background:#ff453a11;border:1px solid #ff453a44;border-left:4px solid #ff453a;padding:12px 16px;margin-bottom:20px">
      <span style="font-size:12px;font-weight:700;color:#ff453a;letter-spacing:.08em">${critical.length} КРИТИЧНИ СИГНАЛА ИЗИСКВАТ РЕАКЦИЯ</span>
    </div>` : ''}

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#18181b;border:1px solid #27272a;margin-bottom:24px">
      <tr><td style="padding:10px 16px;background:#27272a">
        <span style="font-size:10px;font-weight:700;letter-spacing:.1em;color:#888">АКТИВНИ СИГНАЛИ (${alerts.length})</span>
      </td></tr>
      ${[...critical, ...rest].map(alertRow).join('')}
    </table>

    <div style="text-align:center;padding:16px 0;border-top:1px solid #27272a">
      <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/alerts"
         style="display:inline-block;padding:10px 24px;background:#0a84ff;color:#fff;text-decoration:none;
                font-size:12px;font-weight:700;letter-spacing:.08em">
        ОТВОРИ ERP →
      </a>
    </div>

    <p style="text-align:center;font-size:11px;color:#444;margin-top:16px">
      Studio Botema ERP · Автоматичен дайджест · 08:30 ч.
    </p>
  </div>
</body></html>`;
}

async function sendDailyDigest(prisma) {
  const recipient = process.env.ALERT_EMAIL_TO || process.env.ADMIN_EMAIL || process.env.GMAIL_ALERT_TO;
  if (!recipient) return { skipped: true, reason: 'Missing ALERT_EMAIL_TO/ADMIN_EMAIL' };

  const gmail = getGmailClient();
  const sender = await getAuthenticatedMailbox(gmail);
  if (!process.env.ALLOW_SELF_DIGEST && sender && sender.toLowerCase() === String(recipient).toLowerCase()) {
    return { skipped: true, reason: 'Recipient matches authenticated Gmail mailbox', sender, recipient };
  }

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

  const html = buildDigestHtml(alerts);
  const boundary = `botema_${Date.now()}`;
  const subject = encodeMimeWord(`Studio Botema ERP - ${alerts.length} активни сигнала`);
  const mimeMsg = [
    `To: ${recipient}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    alerts.map(a => `[${a.severity}] ${a.title}\n${a.description}`).join('\n\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    html,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodeMail(mimeMsg) },
  });
  return { sent: true, count: alerts.length, recipient, sender };
}

function startAlertJobs(prisma) {
  // Daily email digests are opt-in now. Keep the route/manual trigger available,
  // but do not schedule the 08:30 job unless explicitly enabled.
  if (process.env.ENABLE_ALERT_DIGEST !== 'true') return;
  cron.schedule('30 8 * * *', () => {
    sendDailyDigest(prisma).catch(err => console.error('Alert digest error:', err));
  }, { timezone: process.env.TZ || 'Europe/Sofia' });
}

module.exports = { generateAlerts, sendDailyDigest, startAlertJobs, ensureAlert, resolveDuplicateActiveAlerts };
