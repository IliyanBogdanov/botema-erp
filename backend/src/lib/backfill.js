/**
 * Gmail + Drive backfill service
 * Scans historical emails/Drive folders and records them as SourceFiles + EmailThreads
 */
const { google } = require('googleapis');
const prisma = require('./prisma');

const getAuth = () => {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
};

const getGmail = () => google.gmail({ version: 'v1', auth: getAuth() });
const getDrive = () => google.drive({ version: 'v3', auth: getAuth() });

// Keywords that indicate a business document email
const BUSINESS_KEYWORDS = [
  'фактура', 'invoice', 'проформа', 'proforma', 'доставка', 'delivery',
  'оферта', 'offer', 'поръчка', 'order', 'плащане', 'payment',
  'авизо', 'кредитно', 'дебитно', 'credit note', 'debit note',
  'митница', 'customs', 'товарителница', 'cmr', 'транспорт',
  'dhl', 'speedy', 'econt', 'fedex', 'ups',
  'lodes', 'alphaluce', 'novaluce', 'силтем', 'polaris', 'omega',
];

const SKIP_KEYWORDS = [
  'unsubscribe', 'newsletter', 'promotion', 'discount', 'sale', 'offer expires',
  'абонамент', 'промоция', 'бюлетин',
];

function isBusinessEmail(subject, from) {
  const text = (subject + ' ' + from).toLowerCase();
  if (SKIP_KEYWORDS.some(k => text.includes(k))) return false;
  return BUSINESS_KEYWORDS.some(k => text.includes(k));
}

// ── GMAIL BACKFILL ────────────────────────────────────────────────────────────

/**
 * Scan Gmail for a given year, record threads + attachments as SourceFiles
 * @param {number} year
 * @param {Function} onProgress - callback(done, total, msg)
 */
async function gmailBackfill(year, onProgress = () => {}) {
  const gmail = getGmail();

  // Update coverage record
  await prisma.coverage.upsert({
    where: { source_path_year: { source: 'GMAIL', path: `Gmail/${year}`, year } },
    update: { status: 'IN_PROGRESS' },
    create: { source: 'GMAIL', path: `Gmail/${year}`, year, status: 'IN_PROGRESS' },
  });

  const afterDate = `${year}/01/01`;
  const beforeDate = `${year + 1}/01/01`;
  const query = `after:${afterDate} before:${beforeDate} has:attachment`;

  let pageToken = null;
  let totalFound = 0;
  let totalDone = 0;
  const processed = [];
  const skipped = [];

  do {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 100,
      pageToken: pageToken || undefined,
    });

    const messages = listRes.data.messages || [];
    totalFound += messages.length;

    for (const msg of messages) {
      try {
        const result = await processGmailMessage(gmail, msg.id, year);
        if (result.saved) { processed.push(result); totalDone++; }
        else skipped.push(result.reason);
        onProgress(totalDone, totalFound, result.subject || msg.id);
      } catch (e) {
        skipped.push(`${msg.id}: ${e.message}`);
      }
    }

    pageToken = listRes.data.nextPageToken;
  } while (pageToken);

  // Update coverage
  await prisma.coverage.updateMany({
    where: { source: 'GMAIL', path: `Gmail/${year}`, year },
    data: {
      status: 'DONE',
      itemsFound: totalFound,
      itemsDone: totalDone,
      lastRunAt: new Date(),
      notes: `${skipped.length} skipped (not business / already exists)`,
    },
  });

  return { totalFound, totalDone, skipped: skipped.length, processed };
}

async function processGmailMessage(gmail, messageId, year) {
  // Check if already processed
  const existing = await prisma.sourceFile.findUnique({ where: { gmailMsgId: messageId } });
  if (existing) return { saved: false, reason: 'already_exists', subject: messageId };

  const message = await gmail.users.messages.get({
    userId: 'me', id: messageId, format: 'metadata',
    metadataHeaders: ['Subject', 'From', 'Date', 'Message-ID'],
  });

  const headers = message.data.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const dateStr = headers.find(h => h.name === 'Date')?.value || '';
  const threadId = message.data.threadId;
  const receivedAt = dateStr ? new Date(dateStr) : null;

  if (!isBusinessEmail(subject, from)) {
    return { saved: false, reason: 'not_business', subject };
  }

  // Upsert EmailThread
  await prisma.emailThread.upsert({
    where: { threadId },
    update: { lastMessageAt: receivedAt, messageCount: { increment: 1 }, hasAttachments: true },
    create: {
      threadId,
      subject: subject.substring(0, 500),
      fromEmail: from.substring(0, 255),
      lastMessageAt: receivedAt,
      hasAttachments: true,
    },
  });

  // Get full message for attachments
  const fullMsg = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const attachments = extractAttachments(fullMsg.data.payload);

  let savedCount = 0;
  for (const att of attachments) {
    if (!isBusinessAttachment(att.filename)) continue;

    const sfExisting = await prisma.sourceFile.findFirst({
      where: { gmailThread: threadId, filename: att.filename },
    });
    if (sfExisting) continue;

    await prisma.sourceFile.create({
      data: {
        type: 'GMAIL',
        gmailMsgId: `${messageId}-${att.attachmentId}`.substring(0, 191),
        gmailThread: threadId,
        filename: att.filename,
        mimeType: att.mimeType,
        subject: subject.substring(0, 500),
        fromEmail: from.substring(0, 255),
        receivedAt,
        folder: `Gmail/${year}`,
      },
    });
    savedCount++;
  }

  // If no attachments matched, still record the thread message
  if (savedCount === 0 && attachments.length === 0) {
    await prisma.sourceFile.create({
      data: {
        type: 'GMAIL',
        gmailMsgId: messageId,
        gmailThread: threadId,
        filename: `email-${messageId}.eml`,
        subject: subject.substring(0, 500),
        fromEmail: from.substring(0, 255),
        receivedAt,
        folder: `Gmail/${year}`,
        notes: 'No attachments — email thread recorded for reference',
      },
    });
    savedCount = 1;
  }

  return { saved: savedCount > 0, subject, from, attachments: attachments.length };
}

function extractAttachments(payload, result = []) {
  if (!payload) return result;
  if (payload.filename && payload.body?.attachmentId) {
    result.push({
      filename: payload.filename,
      mimeType: payload.mimeType,
      attachmentId: payload.body.attachmentId,
    });
  }
  for (const part of (payload.parts || [])) extractAttachments(part, result);
  return result;
}

const ATTACHMENT_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.zip', '.xml', '.csv', '.png', '.jpg'];
function isBusinessAttachment(filename) {
  const lower = filename.toLowerCase();
  return ATTACHMENT_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// ── DRIVE BACKFILL ────────────────────────────────────────────────────────────

/**
 * Scan a Drive folder (recursively) and record files as SourceFiles
 * @param {string} folderId
 * @param {string} folderPath  human-readable path
 * @param {number} year
 * @param {Function} onProgress
 */
async function driveBackfill(folderId, folderPath, year, onProgress = () => {}) {
  const drive = getDrive();

  await prisma.coverage.upsert({
    where: { source_path_year: { source: 'DRIVE', path: folderPath, year } },
    update: { status: 'IN_PROGRESS' },
    create: { source: 'DRIVE', path: folderPath, year, status: 'IN_PROGRESS' },
  });

  let totalFound = 0;
  let totalDone = 0;

  await scanDriveFolder(drive, folderId, folderPath, year, (found, done, name) => {
    totalFound = found;
    totalDone = done;
    onProgress(done, found, name);
  });

  await prisma.coverage.updateMany({
    where: { source: 'DRIVE', path: folderPath, year },
    data: { status: 'DONE', itemsFound: totalFound, itemsDone: totalDone, lastRunAt: new Date() },
  });

  return { totalFound, totalDone };
}

async function scanDriveFolder(drive, folderId, currentPath, year, onProgress, counters = { found: 0, done: 0 }) {
  let pageToken = null;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, webViewLink, createdTime, modifiedTime)',
      pageSize: 100,
      pageToken: pageToken || undefined,
    });

    for (const file of (res.data.files || [])) {
      counters.found++;

      if (file.mimeType === 'application/vnd.google-apps.folder') {
        // Recurse into subfolder
        await scanDriveFolder(drive, file.id, `${currentPath}/${file.name}`, year, onProgress, counters);
        continue;
      }

      if (!isBusinessAttachment(file.name)) continue;

      const existing = await prisma.sourceFile.findUnique({ where: { driveFileId: file.id } });
      if (existing) continue;

      await prisma.sourceFile.create({
        data: {
          type: 'DRIVE',
          driveFileId: file.id,
          driveUrl: file.webViewLink,
          filename: file.name,
          mimeType: file.mimeType,
          folder: currentPath,
          receivedAt: file.createdTime ? new Date(file.createdTime) : null,
        },
      });
      counters.done++;
      onProgress(counters.found, counters.done, file.name);
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);
}

// ── INVENTORY XLSX IMPORT ─────────────────────────────────────────────────────

/**
 * Parse Наличности xlsx exported as JSON rows (from frontend)
 * Expected columns: code, name, supplier, qtyIn, unit, unitPrice, notes
 */
async function importInventoryFromRows(rows, projectId = null) {
  const results = { created: 0, errors: [] };

  // Find or create a generic supplier for unknown suppliers
  let defaultSupplier = await prisma.supplier.findFirst({ where: { name: 'Неизвестен доставчик' } });
  if (!defaultSupplier) {
    defaultSupplier = await prisma.supplier.create({
      data: { id: 'sup-unknown', name: 'Неизвестен доставчик', country: 'BG', currency: 'BGN' },
    });
  }

  for (const row of rows) {
    try {
      if (!row.code || !row.name) continue;

      // Try to match supplier by name
      let supplier = await prisma.supplier.findFirst({
        where: { name: { contains: row.supplier || '', mode: 'insensitive' } },
      });
      if (!supplier) supplier = defaultSupplier;

      await prisma.inventoryItem.upsert({
        where: { id: `xlsx-inv-${row.code}` },
        update: {
          qtyIn: parseFloat(row.qtyIn) || 0,
          notes: row.notes || null,
        },
        create: {
          id: `xlsx-inv-${row.code}`,
          supplierId: supplier.id,
          projectId: projectId || null,
          code: String(row.code),
          name: String(row.name),
          category: guessCategory(row.name),
          qtyIn: parseFloat(row.qtyIn) || 0,
          qtyOut: 0,
          location: row.location || null,
          notes: row.notes || 'Наличности 01.02.2026',
        },
      });
      results.created++;
    } catch (e) {
      results.errors.push(`${row.code}: ${e.message}`);
    }
  }

  return results;
}

function guessCategory(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('лед') || lower.includes('led') || lower.includes('лента')) return 'ELECTRICAL';
  if (lower.includes('захранване') || lower.includes('driver') || lower.includes('dimmer')) return 'ELECTRICAL';
  if (lower.includes('лампа') || lower.includes('lamp') || lower.includes('осветител') ||
      lower.includes('spot') || lower.includes('спот') || lower.includes('lustr')) return 'LIGHTING';
  if (lower.includes('огледало') || lower.includes('mirror')) return 'MIRROR';
  if (lower.includes('мебел') || lower.includes('стол') || lower.includes('маса')) return 'FURNITURE';
  if (lower.includes('мостра') || lower.includes('sample')) return 'SAMPLE';
  return 'OTHER';
}

module.exports = { gmailBackfill, driveBackfill, importInventoryFromRows };
