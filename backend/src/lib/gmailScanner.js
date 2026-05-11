/**
 * Gmail Scanner — auto-processes emails with PDF attachments.
 * Classifies each PDF as: bank statement, invoice/proforma, offer, or other.
 * Bank statements → Payment records (normalized layer).
 * Invoices/proformas → Document records → user review flow.
 */

const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdfParse = require('pdf-parse');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function getGoogleAuth() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
}

async function callGeminiWithPdf(prompt, pdfBuffer) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
  ]);
  const text = result.response.text().trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON from Gemini: ' + text.substring(0, 200));
  return JSON.parse(match[0]);
}

async function classifyPdf(pdfBuffer, filename, emailSubject, fromEmail) {
  const prompt = `You are classifying a business document for Studio Botema, a Bulgarian interior design company.

Filename: "${filename}"
Email subject: "${emailSubject}"
From: "${fromEmail}"

Classify this document and return ONLY valid JSON, no markdown:
{
  "docType": "INVOICE_IN" | "INVOICE_OUT" | "PROFORMA" | "BANK_STATEMENT" | "OFFER" | "DELIVERY_NOTE" | "OTHER",
  "confidence": number (0-100),
  "supplierOrBankName": string or null,
  "invoiceNo": string or null,
  "docDate": "YYYY-MM-DD" or null,
  "amountTotal": number or null,
  "currency": "BGN" | "EUR" | "USD" | null,
  "isBankStatement": boolean
}

BANK_STATEMENT: if from a bank, contains transaction table, has IBAN/account info.
INVOICE_IN: incoming purchase invoice from a supplier.
INVOICE_OUT: outgoing invoice to a client.
PROFORMA: proforma invoice (advance payment request).
OFFER: price offer/quotation.`;

  return callGeminiWithPdf(prompt, pdfBuffer);
}

async function extractBankStatement(pdfBuffer, filename) {
  const prompt = `Extract ALL transactions from this bank statement PDF for Studio Botema.
Return ONLY valid JSON, no markdown:
{
  "accountHolder": string,
  "iban": string or null,
  "currency": "BGN" | "EUR" | "USD",
  "periodFrom": "YYYY-MM-DD" or null,
  "periodTo": "YYYY-MM-DD" or null,
  "openingBalance": number or null,
  "closingBalance": number or null,
  "bankName": string or null,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "valueDate": "YYYY-MM-DD" or null,
      "description": string,
      "reference": string or null,
      "counterparty": string or null,
      "counterpartyIban": string or null,
      "debit": number,
      "credit": number,
      "balance": number or null
    }
  ]
}

Return every transaction row. debit = money going out (we paid), credit = money coming in (we received).`;

  return callGeminiWithPdf(prompt, pdfBuffer);
}

async function extractInvoiceData(pdfBuffer, filename, folder) {
  const { parseDocumentWithAI } = require('./aiParser');
  return parseDocumentWithAI(filename, folder || '', pdfBuffer);
}

async function uploadToDrive(auth, filename, pdfBuffer) {
  const folderId = process.env.DRIVE_INVOICES_FOLDER_ID;
  if (!folderId) throw new Error('DRIVE_INVOICES_FOLDER_ID not configured');

  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: 'application/pdf', body: require('stream').Readable.from(pdfBuffer) },
    fields: 'id,webViewLink',
  });
  return { driveFileId: res.data.id, driveUrl: res.data.webViewLink };
}

async function downloadGmailAttachment(gmail, messageId, attachmentId) {
  const res = await gmail.users.messages.attachments.get({
    userId: 'me', messageId, id: attachmentId,
  });
  const base64 = res.data.data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

function getAttachmentParts(payload, parts = []) {
  if (!payload) return parts;
  const nodes = payload.parts || [payload];
  for (const p of nodes) {
    if (p.filename && p.filename.length > 0 && p.body?.attachmentId) {
      const mime = (p.mimeType || '').toLowerCase();
      if (mime === 'application/pdf' || p.filename.toLowerCase().endsWith('.pdf')) {
        parts.push({ filename: p.filename, attachmentId: p.body.attachmentId });
      }
    }
    if (p.parts) getAttachmentParts(p, parts);
  }
  return parts;
}

function getHeader(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function importBankStatementTransactions(prisma, extracted, gmailMessageId) {
  const { transactions = [], currency, iban, bankName, periodFrom, periodTo } = extracted;
  let imported = 0;
  let skipped = 0;

  for (const tx of transactions) {
    if (!tx.date) continue;
    const amount = tx.debit > 0 ? tx.debit : tx.credit;
    if (!amount || amount <= 0) continue;

    const txDate = new Date(tx.date);
    if (isNaN(txDate.getTime())) continue;

    const isOutgoing = tx.debit > 0;
    const ref = tx.reference || tx.description?.substring(0, 100) || '';

    const exists = await prisma.payment.findFirst({
      where: {
        paymentDate: txDate,
        amount: { gte: amount - 0.01, lte: amount + 0.01 },
        currency: currency || 'BGN',
        reference: ref || undefined,
      },
      select: { id: true },
    });

    if (exists) { skipped++; continue; }

    let counterpartyId = null;
    if (tx.counterparty) {
      const nm = tx.counterparty.trim().toUpperCase();
      const existing = await prisma.counterparty.findFirst({
        where: { name: { equals: nm, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        counterpartyId = existing.id;
      } else if (nm) {
        const created = await prisma.counterparty.create({
          data: {
            name: tx.counterparty.trim(),
            type: 'OTHER',
            country: 'BG',
            currency: currency || 'BGN',
            notes: tx.counterpartyIban ? `IBAN: ${tx.counterpartyIban}` : undefined,
          },
        });
        counterpartyId = created.id;
      }
    }

    await prisma.payment.create({
      data: {
        paymentDate: txDate,
        amount,
        currency: currency || 'BGN',
        paymentType: 'BANK_TRANSFER',
        reference: ref.substring(0, 255) || null,
        bankAccount: iban || null,
        status: 'UNMATCHED',
        counterpartyId,
        notes: `Gmail import: ${gmailMessageId}${bankName ? ` | ${bankName}` : ''}`,
      },
    });
    imported++;
  }

  return { imported, skipped };
}

async function processMessage(prisma, gmail, auth, msg, job) {
  const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
  const headers = full.data.payload?.headers || [];
  const subject = getHeader(headers, 'Subject') || '(без тема)';
  const from = getHeader(headers, 'From') || '';
  const dateStr = getHeader(headers, 'Date');
  const msgDate = dateStr ? new Date(dateStr) : new Date();
  const threadId = full.data.threadId || null;

  const attachments = getAttachmentParts(full.data.payload);
  if (attachments.length === 0) return;

  // Store/update gmail_messages record
  await prisma.gmailMessage.upsert({
    where: { messageId: msg.id },
    update: { updatedAt: new Date() },
    create: {
      messageId: msg.id,
      threadId,
      subject,
      from,
      snippet: full.data.snippet || '',
      date: msgDate,
      hasAttachments: true,
      attachmentNames: attachments.map(a => a.filename),
      bodyText: '',
      status: 'PENDING',
    },
  });

  for (const att of attachments) {
    job.log.push(`  PDF: ${att.filename}`);
    try {
      const pdfBuffer = await downloadGmailAttachment(gmail, msg.id, att.attachmentId);

      // Classify with Gemini
      const classification = await classifyPdf(pdfBuffer, att.filename, subject, from);
      job.log.push(`  → ${classification.docType} (conf: ${classification.confidence})`);

      if (classification.isBankStatement || classification.docType === 'BANK_STATEMENT') {
        // Extract transactions
        const extracted = await extractBankStatement(pdfBuffer, att.filename);
        const { imported, skipped } = await importBankStatementTransactions(prisma, extracted, msg.id);
        job.log.push(`  → Bank statement: ${imported} new transactions, ${skipped} duplicates`);
        job.bankTx += imported;

        // Create a BizDocument record for the statement itself
        await prisma.bizDocument.create({
          data: {
            docType: 'BANK_STATEMENT',
            docNumber: `${extracted.periodFrom || 'unknown'}`,
            docDate: extracted.periodFrom ? new Date(extracted.periodFrom) : null,
            currency: extracted.currency || 'BGN',
            amountTotal: extracted.closingBalance || null,
            status: 'REVIEWED',
            confidence: classification.confidence || 80,
            notes: `Gmail: ${subject} | Transactions: ${extracted.transactions?.length || 0}`,
          },
        });

      } else if (['INVOICE_IN', 'INVOICE_OUT', 'PROFORMA', 'OFFER', 'DELIVERY_NOTE'].includes(classification.docType)) {
        // Check for existing document by looking at current documents
        const { analyzeDocument } = require('./documentReview');

        // Upload PDF to Drive
        let driveFileId, driveUrl;
        try {
          const uploaded = await uploadToDrive(auth, att.filename, pdfBuffer);
          driveFileId = uploaded.driveFileId;
          driveUrl = uploaded.driveUrl;
        } catch (driveErr) {
          job.log.push(`  ⚠ Drive upload failed: ${driveErr.message}`);
          // Continue without Drive - create Document with gmail ref
          driveFileId = `gmail:${msg.id}:${att.filename}`;
          driveUrl = '';
        }

        // Check for duplicate
        const existingByDrive = driveFileId.startsWith('gmail:') ? null :
          await prisma.document.findUnique({ where: { driveFileId }, select: { id: true } });
        if (existingByDrive) {
          job.log.push(`  → Duplicate (already in Drive), skipping`);
          job.skipped++;
          continue;
        }

        // Full AI extraction
        const parsed = await extractInvoiceData(pdfBuffer, att.filename, '');
        const analysis = await analyzeDocument(prisma, { ...classification, ...parsed });

        const docType = classification.docType === 'INVOICE_OUT' ? 'INVOICE_OUT'
          : classification.docType === 'PROFORMA' ? 'PROFORMA'
          : classification.docType === 'OFFER' ? 'OTHER'
          : classification.docType === 'DELIVERY_NOTE' ? 'DELIVERY'
          : 'INVOICE_IN';

        await prisma.document.create({
          data: {
            driveFileId,
            driveUrl: driveUrl || '',
            filename: att.filename,
            type: docType,
            status: 'PENDING',
            extractedData: { ...classification, ...parsed, gmailMessageId: msg.id, gmailSubject: subject, from },
            confidence: parsed.confidence || classification.confidence || 50,
            suggestedAction: analysis.suggestedAction || 'CREATE_PURCHASE',
            riskFlags: analysis.riskFlags || [],
          },
        });

        job.log.push(`  → Document created: ${parsed.invoiceNo || '?'} ${parsed.amountTotal || '?'} ${parsed.currency || ''}`);
        job.documents++;
      } else {
        job.log.push(`  → Skipped (type: ${classification.docType})`);
        job.skipped++;
      }
    } catch (err) {
      job.log.push(`  ✗ Error: ${err.message}`);
      job.errors++;
    }
    if (job.log.length > 500) job.log.shift();
    // Rate limit: 1 req/7s for Gemini (classification + extraction = 2 calls)
    await new Promise(r => setTimeout(r, 4000));
  }
}

async function scanGmail(prisma, job) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('GOOGLE_REFRESH_TOKEN not configured');
  }

  const auth = getGoogleAuth();
  const gmail = google.gmail({ version: 'v1', auth });

  // Find all emails with PDF attachments not yet processed
  const alreadyProcessed = await prisma.gmailMessage.findMany({
    where: { hasAttachments: true },
    select: { messageId: true },
  });
  const processedIds = new Set(alreadyProcessed.map(m => m.messageId));

  // Search for emails with attachments
  const searches = [
    'has:attachment filename:pdf (фактура OR invoice OR проформа OR proforma OR доставка OR delivery)',
    'has:attachment filename:pdf (statement OR извлечение OR банкова OR bank)',
    'has:attachment filename:pdf (offer OR оферта)',
  ];

  const allMessageIds = new Set();

  for (const query of searches) {
    let pageToken;
    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken,
      });
      for (const m of (res.data.messages || [])) allMessageIds.add(m.id);
      pageToken = res.data.nextPageToken;
    } while (pageToken && allMessageIds.size < 500);
  }

  const toProcess = [...allMessageIds].filter(id => !processedIds.has(id));
  job.total = toProcess.length;
  job.log.push(`Found ${allMessageIds.size} emails total, ${toProcess.length} new to process`);

  for (const msgId of toProcess) {
    try {
      job.log.push(`Processing: ${msgId}`);
      await processMessage(prisma, gmail, auth, { id: msgId }, job);
      job.done++;
    } catch (err) {
      job.errors++;
      job.log.push(`✗ Message ${msgId}: ${err.message}`);
    }
  }
}

module.exports = { scanGmail };
