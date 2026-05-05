const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const { auth } = require('../middleware/auth');
const { analyzeDocument, reviewDocument } = require('../lib/documentReview');
const { generateAlerts } = require('../lib/alertEngine');
const prisma = require('../lib/prisma');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const getGmailClient = () => {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
};

// POST /api/gmail/watch — Start watching Gmail inbox
router.post('/watch', auth, async (req, res) => {
  try {
    const gmail = getGmailClient();
    const { email } = req.body;
    const response = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        labelIds: ['INBOX'],
        topicName: `projects/${process.env.GOOGLE_PROJECT_ID}/topics/${process.env.PUBSUB_TOPIC}`,
      }
    });
    await prisma.gmailWatch.upsert({
      where: { email },
      update: { historyId: response.data.historyId, expiration: new Date(parseInt(response.data.expiration)), active: true },
      create: { email, historyId: response.data.historyId, expiration: new Date(parseInt(response.data.expiration)) }
    });
    res.json({ success: true, expiration: response.data.expiration });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/webhook — Google Pub/Sub push notification
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Always respond immediately
  try {
    const data = JSON.parse(Buffer.from(req.body.message.data, 'base64').toString());
    const { emailAddress, historyId } = data;
    await processNewEmails(emailAddress, historyId);
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

// GET /api/gmail/pending — Emails waiting for review
router.get('/pending', auth, async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' }
    });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gmail/process/:docId — Confirm and save document
router.post('/process/:docId', auth, async (req, res) => {
  try {
    const action = req.body.action === 'approve'
      ? req.body.documentAction || 'CREATE_PURCHASE'
      : 'REJECT';
    const result = await reviewDocument(prisma, req.params.docId, {
      ...req.body,
      action,
      invoiceData: req.body.invoiceData,
    }, req.user.id);
    await generateAlerts(prisma);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Internal: process new emails ────────────────────────────────────────────
async function processNewEmails(email, historyId) {
  try {
    const gmail = getGmailClient();
    const watch = await prisma.gmailWatch.findUnique({ where: { email } });
    if (!watch) return;

    const history = await gmail.users.history.list({
      userId: 'me', startHistoryId: watch.historyId,
      historyTypes: ['messageAdded'], labelId: 'INBOX'
    });

    if (!history.data.history) return;

    for (const h of history.data.history) {
      for (const msg of (h.messagesAdded || [])) {
        await processEmail(gmail, msg.message.id);
      }
    }
    await prisma.gmailWatch.update({ where: { email }, data: { historyId } });
  } catch (err) {
    console.error('processNewEmails error:', err);
  }
}

async function processEmail(gmail, messageId) {
  try {
    const message = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const headers = message.data.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const from = headers.find(h => h.name === 'From')?.value || '';

    // Check if it looks like an invoice
    const invoiceKeywords = ['фактура', 'invoice', 'проформа', 'proforma', 'доставка', 'delivery'];
    const isInvoice = invoiceKeywords.some(k => subject.toLowerCase().includes(k));
    if (!isInvoice) return;

    // Get PDF attachments
    const attachments = [];
    const getParts = (parts) => {
      for (const part of (parts || [])) {
        if (part.filename && part.mimeType === 'application/pdf') {
          attachments.push({ filename: part.filename, attachmentId: part.body.attachmentId });
        }
        if (part.parts) getParts(part.parts);
      }
    };
    getParts(message.data.payload.parts);

    for (const att of attachments) {
      const attachData = await gmail.users.messages.attachments.get({
        userId: 'me', messageId, id: att.attachmentId
      });
      const pdfBase64 = attachData.data.data.replace(/-/g, '+').replace(/_/g, '/');

      // Use Claude AI to extract invoice data
      const aiResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
            },
            {
              type: 'text',
              text: `Анализирай тази фактура/документ и върни JSON с полетата:
              {
                "type": "INVOICE_IN" | "INVOICE_OUT" | "PROFORMA" | "DELIVERY",
                "invoiceNo": "номер",
                "date": "YYYY-MM-DD",
                "supplierName": "...",
                "clientName": "...",
                "amount": 0.00,
                "currency": "EUR"|"BGN",
                "description": "кратко описание",
                "vatAmount": 0.00,
                "amountTotal": 0.00,
                "confidence": 0.00,
                "items": [{"description":"...", "qty":1, "unitPrice":0.00, "vatPct":20}]
              }
              Върни САМО валиден JSON без markdown.`
            }
          ]
        }]
      });

      let extractedData = {};
      try {
        extractedData = JSON.parse(aiResponse.content[0].text);
      } catch (e) {
        extractedData = { raw: aiResponse.content[0].text };
      }

      // Save to Drive
      const { google: googleDrive } = require('googleapis');
      const drive = googleDrive.drive({ version: 'v3', auth: gmail._options.auth });
      const driveFile = await drive.files.create({
        requestBody: { name: att.filename, parents: [process.env.DRIVE_INVOICES_FOLDER_ID] },
        media: { mimeType: 'application/pdf', body: Buffer.from(pdfBase64, 'base64') },
        fields: 'id, webViewLink'
      });

      const analysis = await analyzeDocument(prisma, extractedData);

      // Save document record
      await prisma.document.create({
        data: {
          driveFileId: driveFile.data.id,
          driveUrl: driveFile.data.webViewLink,
          filename: att.filename,
          type: extractedData.type || 'INVOICE_IN',
          status: 'PENDING',
          extractedData,
          confidence: analysis.confidence,
          suggestedAction: analysis.suggestedAction,
          duplicateOfId: analysis.duplicateOfId,
          riskFlags: analysis.riskFlags,
        }
      });
      await generateAlerts(prisma);
    }
  } catch (err) {
    console.error('processEmail error:', err);
  }
}

module.exports = router;
