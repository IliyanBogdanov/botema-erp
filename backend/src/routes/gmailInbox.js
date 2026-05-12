const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

const getGmailClient = () => {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
};

function getHeader(headers, name) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractText(payload) {
  if (!payload) return '';
  const parts = payload.parts || [payload];
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf8').slice(0, 500);
    }
  }
  return '';
}

function getAttachments(payload) {
  const atts = [];
  const scan = (parts) => {
    for (const p of (parts || [])) {
      if (p.filename && p.filename.length > 0) atts.push(p.filename);
      if (p.parts) scan(p.parts);
    }
  };
  scan(payload?.parts || []);
  return atts;
}

// GET /api/gmail-inbox — fetch + sync latest 30 messages from Gmail
router.get('/', auth, async (req, res) => {
  try {
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      // Return stored messages if no Gmail connection
      const rows = await prisma.$queryRaw`
        SELECT * FROM gmail_messages ORDER BY "createdAt" DESC LIMIT 50
      `;
      return res.json(rows);
    }

    const gmail = getGmailClient();
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 30,
      q: 'in:inbox',
    });

    const messages = listRes.data.messages || [];

    for (const msg of messages) {
      // Check if already stored
      const existing = await prisma.$queryRaw`
        SELECT id FROM gmail_messages WHERE "messageId" = ${msg.id} LIMIT 1
      `;
      if (existing.length > 0) continue;

      // Fetch full message
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = full.data.payload?.headers || [];
      const subject = getHeader(headers, 'Subject') || '(без тема)';
      const from = getHeader(headers, 'From');
      const dateStr = getHeader(headers, 'Date');
      const date = dateStr ? new Date(dateStr) : new Date();
      const snippet = full.data.snippet || '';
      const bodyText = extractText(full.data.payload);
      const attachmentNames = getAttachments(full.data.payload);
      const hasAttachments = attachmentNames.length > 0;
      const threadId = full.data.threadId || null;

      await prisma.$executeRaw`
        INSERT INTO gmail_messages (
          id, "messageId", "threadId", subject, "from", snippet, date,
          "hasAttachments", "attachmentNames", "bodyText", status, "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text,
          ${msg.id}, ${threadId}, ${subject}, ${from}, ${snippet}, ${date},
          ${hasAttachments}, ${attachmentNames}, ${bodyText},
          'PENDING'::"GmailMessageStatus",
          now(), now()
        )
        ON CONFLICT ("messageId") DO NOTHING
      `;
    }

    const rows = await prisma.$queryRaw`
      SELECT * FROM gmail_messages ORDER BY date DESC NULLS LAST LIMIT 50
    `;
    res.json(rows);
  } catch (err) {
    console.error('Gmail inbox error:', err);
    // Fallback: return stored messages
    try {
      const rows = await prisma.$queryRaw`
        SELECT * FROM gmail_messages ORDER BY "createdAt" DESC LIMIT 50
      `;
      res.json(rows);
    } catch (e2) {
      res.status(500).json({ error: err.message });
    }
  }
});

// PATCH /api/gmail-inbox/:id — classify a message
router.patch('/:id', auth, async (req, res) => {
  try {
    const { status, classification, classifiedType, notes } = req.body;
    await prisma.$executeRaw`
      UPDATE gmail_messages
      SET
        status = COALESCE(${status}::"GmailMessageStatus", status),
        classification = COALESCE(${classification ?? null}, classification),
        "classifiedType" = COALESCE(${classifiedType ?? null}, "classifiedType"),
        notes = COALESCE(${notes ?? null}, notes),
        "reviewedAt" = now(),
        "reviewedById" = ${req.user.id},
        "updatedAt" = now()
      WHERE id = ${req.params.id}
    `;
    const rows = await prisma.$queryRaw`
      SELECT * FROM gmail_messages WHERE id = ${req.params.id} LIMIT 1
    `;
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail-inbox/auto-classify — auto-classify all PENDING messages
router.post('/auto-classify', auth, async (req, res) => {
  try {
    const pending = await prisma.$queryRaw`
      SELECT * FROM gmail_messages WHERE status = 'PENDING'::"GmailMessageStatus" ORDER BY date DESC
    `;

    const IGNORE_SENDERS = [
      'railway.app', 'openai.com', 'supabase.io', 'ozone.bg',
      'raben', 'speedy', 'allianz', 'freelancer.com',
    ];
    const IGNORE_SUBJECTS = [
      'build failed', 'security vulnerabilities', 'застрахователно', 'investment news',
      'new arrivals', 'reduced prices', 'spam', 'unsubscribe',
    ];

    const results = { ignored: 0, invoiceIn: 0, bankStatement: 0, offer: 0, delivery: 0, other: 0 };

    for (const msg of pending) {
      const fromLower = (msg.from || '').toLowerCase();
      const subjectLower = (msg.subject || '').toLowerCase();

      let newStatus = null;
      let classifiedType = null;

      // Determine classification
      const isIgnore =
        IGNORE_SENDERS.some(s => fromLower.includes(s)) ||
        IGNORE_SUBJECTS.some(s => subjectLower.includes(s));

      if (isIgnore) {
        newStatus = 'IGNORED';
        results.ignored++;
      } else if (
        subjectLower.includes('invoice number') ||
        subjectLower.includes('фактура м') ||
        subjectLower.includes('ф-ра м') ||
        subjectLower.includes('last dhl') ||
        subjectLower.includes('dhl фактура') ||
        fromLower.includes('lodes') ||
        fromLower.includes('dhl.com') ||
        fromLower.includes('polaris')
      ) {
        newStatus = 'CLASSIFIED';
        classifiedType = 'INVOICE_IN';
        results.invoiceIn++;
      } else if (
        subjectLower.includes('bank account statement') ||
        subjectLower.includes('банково извлечение') ||
        fromLower.includes('teximbank')
      ) {
        newStatus = 'CLASSIFIED';
        classifiedType = 'BANK_STATEMENT';
        results.bankStatement++;
      } else if (
        subjectLower.includes('оферта') ||
        subjectLower.includes('offer') && msg.hasAttachments
      ) {
        newStatus = 'CLASSIFIED';
        classifiedType = 'OFFER_OUT';
        results.offer++;
      } else if (
        subjectLower.includes('delivery note') ||
        subjectLower.includes('cmr') ||
        fromLower.includes('dachser') ||
        fromLower.includes('fercam')
      ) {
        newStatus = 'CLASSIFIED';
        classifiedType = 'DELIVERY_NOTE';
        results.delivery++;
      } else {
        // Leave as PENDING for manual review
        results.other++;
        continue;
      }

      await prisma.$executeRaw`
        UPDATE gmail_messages
        SET
          status = ${newStatus}::"GmailMessageStatus",
          "classifiedType" = ${classifiedType},
          "reviewedAt" = now(),
          "reviewedById" = ${req.user.id},
          "updatedAt" = now()
        WHERE id = ${msg.id}
      `;
    }

    res.json({ total: pending.length, results });
  } catch (err) {
    console.error('Auto-classify error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/gmail-inbox/stats — counts by status
router.get('/stats', auth, async (req, res) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT status, COUNT(*)::int AS count FROM gmail_messages GROUP BY status
    `;
    const stats = { PENDING: 0, CLASSIFIED: 0, IGNORED: 0 };
    for (const r of rows) stats[r.status] = r.count;
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
