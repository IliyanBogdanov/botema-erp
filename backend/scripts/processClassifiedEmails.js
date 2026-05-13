// Process all CLASSIFIED Gmail messages → create BizDocument entries
// Uses Gemini for PDFs with Groq/OpenRouter fallback via pdf-parse text extraction
// Safe to re-run: skips messages that already have a BizDocument via notes field
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const pdfParse = require('pdf-parse');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getHeader(headers, name) {
  return (headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function getPdfParts(payload, parts = []) {
  if (!payload) return parts;
  const nodes = payload.parts || [payload];
  for (const p of nodes) {
    if (p.filename && p.body?.attachmentId) {
      const mime = (p.mimeType || '').toLowerCase();
      if (mime === 'application/pdf' || p.filename.toLowerCase().endsWith('.pdf')) {
        parts.push({ filename: p.filename, attachmentId: p.body.attachmentId });
      }
    }
    if (p.parts) getPdfParts(p, parts);
  }
  return parts;
}

async function downloadPdf(gmail, messageId, attachmentId) {
  const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
  const base64 = res.data.data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

const JSON_PROMPT = (docType, filename, subject, from) =>
`Extract data from this ${docType} document for Studio Botema (Bulgarian interior design company).
Return ONLY valid JSON, no markdown, no extra text:
{
  "docNumber": string or null,
  "docDate": "YYYY-MM-DD" or null,
  "supplierName": string or null,
  "supplierVat": string or null,
  "amountNet": number or null,
  "vatAmount": number or null,
  "amountTotal": number or null,
  "currency": "BGN" | "EUR" | "USD" | null,
  "notes": string or null
}
Filename: "${filename}"
Email subject: "${subject}"
From: "${from}"`;

async function extractWithGemini(pdfBuffer, filename, subject, from, docType) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const prompt = JSON_PROMPT(docType, filename, subject, from);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
      ]);
      const text = result.response.text().trim();
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON: ' + text.substring(0, 100));
      return JSON.parse(match[0]);
    } catch (err) {
      lastErr = err;
      if (err.message?.includes('503') || err.message?.includes('high demand')) {
        await sleep(5000);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// Fallback: parse PDF to text, then use Groq llama
async function extractWithGroq(pdfBuffer, filename, subject, from, docType) {
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text.substring(0, 3000);
  const prompt = JSON_PROMPT(docType, filename, subject, from) +
    `\n\nPDF TEXT CONTENT:\n${text}`;

  // Retry up to 4 times with backoff on rate limit
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 500,
      });
      const resp = completion.choices[0].message.content.trim();
      const match = resp.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON from Groq: ' + resp.substring(0, 100));
      return JSON.parse(match[0]);
    } catch (err) {
      if (err.message?.includes('429') && attempt < 3) {
        const wait = (attempt + 1) * 15000; // 15s, 30s, 45s
        console.log(`  ⏳ Groq rate limit, waiting ${wait/1000}s...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
}

// Main extraction: try Gemini first, fall back to Groq on quota/error
async function extractFromPdf(pdfBuffer, filename, subject, from, docType) {
  try {
    return await extractWithGemini(pdfBuffer, filename, subject, from, docType);
  } catch (geminiErr) {
    if (geminiErr.message?.includes('429') || geminiErr.message?.includes('quota') || geminiErr.message?.includes('RESOURCE_EXHAUSTED')) {
      console.log(`  ↩ Gemini quota, using Groq fallback`);
      return await extractWithGroq(pdfBuffer, filename, subject, from, docType);
    }
    throw geminiErr;
  }
}

function classifiedTypeToBizDocType(classifiedType) {
  const map = {
    'INVOICE_IN': 'INVOICE_IN',
    'INVOICE_OUT': 'INVOICE_OUT',
    'OFFER_OUT': 'OFFER_OUT',
    'DELIVERY_NOTE': 'DELIVERY_NOTE',
    'BANK_STATEMENT': 'BANK_STATEMENT',
    'CMR': 'CMR',
  };
  return map[classifiedType] || 'OTHER';
}

async function findOrCreateCounterparty(name, vatNumber) {
  if (!name) return null;
  const existing = await prisma.counterparty.findFirst({
    where: { name: { contains: name.slice(0, 20), mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.counterparty.create({
    data: { name: name.trim(), type: 'SUPPLIER', country: 'BG', currency: 'EUR', vat: vatNumber || null },
  });
  return created.id;
}

async function main() {
  const gmail = getGmailClient();

  // Get all classified messages
  const messages = await prisma.gmailMessage.findMany({
    where: { status: 'CLASSIFIED', classifiedType: { not: null } },
    orderBy: { date: 'desc' },
  });

  console.log(`Processing ${messages.length} classified Gmail messages...`);

  // Get already-processed message IDs - stubs (no docNumber) need re-processing
  const existing = await prisma.$queryRawUnsafe(`
    SELECT id, notes, "docNumber" FROM biz_documents WHERE notes LIKE '%gmail:%'
  `);

  // Map messageId → { bizDocId, isStub }
  const processedMap = new Map();
  for (const r of existing) {
    const idMatch = r.notes?.match(/gmail:([a-f0-9]+)/);
    if (idMatch) {
      processedMap.set(idMatch[1], { id: r.id, isStub: !r.docNumber });
    }
  }
  const alreadyComplete = [...processedMap.entries()].filter(([, v]) => !v.isStub).length;
  const stubs = [...processedMap.entries()].filter(([, v]) => v.isStub).length;
  console.log(`${alreadyComplete} complete, ${stubs} stubs to re-process, ${messages.length - processedMap.size} new`);

  let created = 0, updated = 0, stubbed = 0, skipped = 0, errors = 0;

  for (const msg of messages) {
    const existing = processedMap.get(msg.messageId);

    // Skip if already complete (has docNumber)
    if (existing && !existing.isStub) {
      skipped++;
      continue;
    }

    const bizDocType = classifiedTypeToBizDocType(msg.classifiedType);

    try {
      // Fetch full message to check attachments
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.messageId, format: 'full' });
      const headers = full.data.payload?.headers || [];
      const subject = getHeader(headers, 'Subject') || msg.subject || '';
      const from = getHeader(headers, 'From') || msg.from || '';

      const pdfParts = getPdfParts(full.data.payload);

      if (pdfParts.length > 0) {
        const pdfBuf = await downloadPdf(gmail, msg.messageId, pdfParts[0].attachmentId);
        await sleep(500);

        let extracted = {};
        let usedModel = 'none';
        try {
          extracted = await extractFromPdf(pdfBuf, pdfParts[0].filename, subject, from, msg.classifiedType);
          usedModel = extracted._model || 'ok';
          await sleep(1500); // Gemini rate limit
        } catch (extractErr) {
          console.log(`  ⚠ Extraction failed for ${msg.messageId}: ${extractErr.message.substring(0, 80)}`);
        }

        const counterpartyId = await findOrCreateCounterparty(
          extracted.supplierName || from.replace(/<.*>/, '').trim(),
          extracted.supplierVat
        );

        const safeDate = (val) => {
          if (!val) return null;
          const d = new Date(val);
          return isNaN(d.getTime()) ? null : d;
        };
        const safeFloat = (val) => {
          const f = parseFloat(val);
          return isNaN(f) ? null : f;
        };

        const docData = {
          docType: bizDocType,
          docNumber: extracted.docNumber || null,
          docDate: safeDate(extracted.docDate) || msg.date || null,
          currency: extracted.currency || 'EUR',
          amountNet: safeFloat(extracted.amountNet),
          vatAmount: safeFloat(extracted.vatAmount),
          amountTotal: safeFloat(extracted.amountTotal),
          status: 'NEW',
          confidence: extracted.docNumber ? 85 : 50,
          notes: `gmail:${msg.messageId} | ${subject} | PDF: ${pdfParts[0].filename}`,
          counterpartyId,
        };

        if (existing) {
          // Update stub with real data
          await prisma.bizDocument.update({ where: { id: existing.id }, data: docData });
          updated++;
          console.log(`  🔄 Updated ${bizDocType} #${extracted.docNumber || '?'} ${extracted.amountTotal || '?'} ${extracted.currency || ''} — ${subject.substring(0, 40)}`);
        } else {
          await prisma.bizDocument.create({ data: docData });
          created++;
          console.log(`  ✅ ${bizDocType} #${extracted.docNumber || '?'} ${extracted.amountTotal || '?'} ${extracted.currency || ''} — ${subject.substring(0, 40)}`);
        }

      } else if (!existing) {
        // No PDF — create stub from email metadata only if not already in DB
        const numMatch = subject.match(/\b(\d{6,})\b/);
        const docNumber = numMatch ? numMatch[1] : null;

        const counterpartyId = await findOrCreateCounterparty(
          from.replace(/<.*>/, '').replace(/[<>]/g, '').trim() || null
        );

        await prisma.bizDocument.create({
          data: {
            docType: bizDocType,
            docNumber,
            docDate: msg.date || null,
            currency: 'EUR',
            status: 'NEW',
            confidence: 30,
            notes: `gmail:${msg.messageId} | ${subject} | no-pdf`,
            counterpartyId,
          },
        });
        stubbed++;
        console.log(`  📋 Stub ${bizDocType} — ${subject.substring(0, 60)}`);
      } else {
        skipped++; // no-pdf stub already exists
      }

    } catch (err) {
      errors++;
      console.error(`  ❌ ${msg.messageId}: ${err.message.substring(0, 100)}`);
      await sleep(2000);
    }
  }

  console.log(`\nDone: created=${created}, updated=${updated}, stubbed=${stubbed}, skipped=${skipped}, errors=${errors}`);
  const total = await prisma.bizDocument.count();
  console.log(`Total BizDocuments in DB: ${total}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
