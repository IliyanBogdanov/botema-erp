const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { auth } = require('../middleware/auth');
const prisma = require('../lib/prisma');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openRouter = process.env.OPENROUTER_API_KEY ? new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
}) : null;

// Build messages array for non-Gemini providers
function buildMessages(systemPrompt, geminiHistory, message) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  for (const h of (geminiHistory || [])) {
    const text = h?.parts?.[0]?.text || '';
    if (text) msgs.push({ role: h.role === 'model' ? 'assistant' : 'user', content: text });
  }
  msgs.push({ role: 'user', content: message });
  return msgs;
}

// Try Gemini first, fallback to Groq, then OpenRouter
async function callAI(systemPrompt, message, geminiHistory) {
  // 1. Try Gemini 2.5 Flash (with one retry on 503)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction: systemPrompt });
      const chat = model.startChat({ history: geminiHistory || [] });
      const result = await chat.sendMessage(message);
      const text = result.response.text();
      console.log(`[AI] Gemini 2.5-flash OK (attempt ${attempt})`);
      return text;
    } catch (err) {
      const is503 = err.message?.includes('503') || err.message?.includes('high demand');
      console.warn(`[AI] gemini-2.5-flash attempt ${attempt} failed: ${err.message?.slice(0, 100)}`);
      if (attempt === 1 && is503) {
        await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
        continue;
      }
      break;
    }
  }

  // 2. Fallback: Groq llama-3.3-70b
  if (groq) {
    try {
      const msgs = buildMessages(systemPrompt, geminiHistory, message);
      const resp = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: msgs, max_tokens: 2048 });
      console.log('[AI] Groq llama-3.3-70b OK');
      return resp.choices[0].message.content;
    } catch (err) {
      console.warn('[AI] Groq failed:', err.message?.slice(0, 100));
    }
  } else {
    console.warn('[AI] Groq not configured (missing GROQ_API_KEY)');
  }

  // 3. Fallback: OpenRouter
  if (openRouter) {
    try {
      const msgs = buildMessages(systemPrompt, geminiHistory, message);
      const resp = await openRouter.chat.completions.create({ model: 'openai/gpt-4.1-mini', messages: msgs, max_tokens: 2048 });
      console.log('[AI] OpenRouter gpt-4.1-mini OK');
      return resp.choices[0].message.content;
    } catch (err) {
      console.warn('[AI] OpenRouter failed:', err.message?.slice(0, 100));
    }
  } else {
    console.warn('[AI] OpenRouter not configured (missing OPENROUTER_API_KEY)');
  }

  throw new Error('Всички AI доставчици са недостъпни. Моля, опитайте след минута.');
}

// POST /api/ai/chat
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    const currentYear = new Date().getFullYear();
    const now = new Date();

    // Fetch rich context from DB in parallel
    const [
      clients,
      counterparties,
      projects,
      recentInvoices,
      unpaidInvoices,
      recentBizDocs,
      recentPayments,
      recentOffers,
      inventory,
      revenueAgg,
      costsAgg,
      paymentsUnmatchedCount,
    ] = await Promise.all([
      prisma.client.findMany({ select: { id: true, name: true, eik: true, email: true } }),
      prisma.counterparty.findMany({
        select: { id: true, name: true, type: true, eik: true },
        orderBy: { name: 'asc' },
      }),
      prisma.project.findMany({
        where: { status: { in: ['ACTIVE', 'ON_HOLD'] } },
        select: { code: true, name: true, status: true, year: true, notes: true, client: { select: { name: true } } },
      }),
      prisma.invoice.findMany({
        orderBy: { date: 'desc' }, take: 20,
        select: { number: true, date: true, amountNet: true, vatAmount: true, currency: true, status: true, description: true, client: { select: { name: true } } },
      }),
      prisma.invoice.findMany({
        where: { status: { in: ['PENDING', 'OVERDUE'] } },
        select: { number: true, date: true, dueDate: true, amountNet: true, currency: true, status: true, client: { select: { name: true } } },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.bizDocument.findMany({
        orderBy: { docDate: 'desc' }, take: 30,
        select: { docType: true, docNumber: true, docDate: true, amountTotal: true, currency: true, notes: true, counterparty: { select: { name: true, type: true } } },
      }),
      prisma.payment.findMany({
        orderBy: { paymentDate: 'desc' }, take: 20,
        select: { paymentDate: true, amount: true, currency: true, paymentType: true, reference: true, bankAccount: true, status: true },
      }),
      prisma.bizDocument.findMany({
        where: { docType: 'OFFER_OUT' },
        orderBy: { docDate: 'desc' }, take: 20,
        select: { docNumber: true, externalRef: true, docDate: true, amountTotal: true, currency: true, notes: true, counterparty: { select: { name: true } } },
      }),
      prisma.inventoryItem.findMany({
        select: { code: true, name: true, category: true, qtyIn: true, qtyOut: true, location: true },
      }),
      prisma.invoice.aggregate({
        where: { date: { gte: new Date(`${currentYear}-01-01`) }, status: { not: 'CANCELLED' } },
        _sum: { amountNet: true },
      }),
      prisma.purchase.aggregate({
        where: { date: { gte: new Date(`${currentYear}-01-01`) } },
        _sum: { amount: true },
      }),
      prisma.payment.count({ where: { status: 'UNMATCHED' } }),
    ]);

    const revenueTotal = Number(revenueAgg._sum.amountNet || 0);
    const costsTotal = Number(costsAgg._sum.amount || 0);

    const systemPrompt = `Ти си финансов AI асистент на Studio Botema ЕООД — бутик дизайн студио в Пазарджик, България.
Отговаряй САМО на БЪЛГАРСКИ. Бъди кратък, точен и практичен. Използвай данните от системата за точни отговори.

=== ФИНАНСОВО РЕЗЮМЕ (${now.toLocaleDateString('bg-BG')}) ===
- Приходи ${currentYear}: ${revenueTotal.toFixed(2)} EUR
- Разходи ${currentYear}: ${costsTotal.toFixed(2)} BGN
- Активни проекти: ${projects.length}
- Клиенти: ${clients.length} (CRM) + ${counterparties.length} контрагента (банкови)
- Неплатени фактури: ${unpaidInvoices.length}
- Ненасочени банкови плащания: ${paymentsUnmatchedCount}

=== АКТИВНИ ПРОЕКТИ ===
${JSON.stringify(projects.map(p => ({ kod: p.code, proekt: p.name, klient: p.client?.name, status: p.status, godina: p.year, belezhki: p.notes })), null, 2)}

=== НЕПЛАТЕНИ ФАКТУРИ ===
${JSON.stringify(unpaidInvoices.map(i => ({ nomer: i.number, data: i.date?.toISOString?.()?.slice(0,10), padej: i.dueDate?.toISOString?.()?.slice(0,10), suma: Number(i.amountNet), valuta: i.currency, klient: i.client?.name, status: i.status })), null, 2)}

=== ПОСЛЕДНИ 20 ФАКТУРИ ===
${JSON.stringify(recentInvoices.map(i => ({ nomer: i.number, data: i.date?.toISOString?.()?.slice(0,10), neto: Number(i.amountNet), dds: Number(i.vatAmount||0), valuta: i.currency, klient: i.client?.name, status: i.status, opisanie: i.description })), null, 2)}

=== ПОСЛЕДНИ 30 ДОКУМЕНТА ===
${JSON.stringify(recentBizDocs.map(d => ({ tip: d.docType, nomer: d.docNumber, data: d.docDate?.toISOString?.()?.slice(0,10), suma: Number(d.amountTotal||0), valuta: d.currency, kontragent: d.counterparty?.name, belezhki: d.notes })), null, 2)}

=== ПОСЛЕДНИ 20 ПЛАЩАНИЯ ===
${JSON.stringify(recentPayments.map(p => ({ data: p.paymentDate?.toISOString?.()?.slice(0,10), suma: Number(p.amount), valuta: p.currency, tip: p.paymentType, referencia: p.reference, status: p.status })), null, 2)}

=== ПОСЛЕДНИ ОФЕРТИ ===
${JSON.stringify(recentOffers.map(o => ({ nomer: o.externalRef || o.docNumber, data: o.docDate?.toISOString?.()?.slice(0,10), suma: Number(o.amountTotal||0), valuta: o.currency, klient: o.counterparty?.name, belezhki: o.notes })), null, 2)}

=== СКЛАД ===
${JSON.stringify(inventory.map(i => ({ kod: i.code, naim: i.name, kat: i.category, nalichnost: Number(i.qtyIn)-Number(i.qtyOut), lok: i.location })), null, 2)}

=== ВСИЧКИ КОНТРАГЕНТИ ===
${JSON.stringify(counterparties.map(c => ({ ime: c.name, tip: c.type, eik: c.eik })), null, 2)}

Можеш да: анализираш финансови данни, правиш справки и сравнения, изчисляваш маржове и рентабилност по проект, генерираш текст за оферти/писма, предлагаш бизнес анализи, намираш неплатени задължения, обясняваш транзакции.`;

    // Convert history to Gemini format (role: 'user' | 'model')
    const geminiHistory = history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    const reply = await callAI(systemPrompt, message, geminiHistory);
    res.json({ reply });
  } catch (err) {
    console.error('[AI chat]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/extract — Extract data from PDF using Gemini
router.post('/extract', auth, async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent([
      {
        text: `Извлечи данните от този документ и върни САМО валиден JSON без markdown:
{
  "type": "INVOICE_IN",
  "invoiceNo": "...",
  "date": "YYYY-MM-DD",
  "supplierName": "...",
  "clientName": "...",
  "amount": 0.00,
  "vatAmount": 0.00,
  "amountTotal": 0.00,
  "currency": "EUR",
  "description": "...",
  "confidence": 0.95,
  "items": [{"description":"...","qty":1,"unitPrice":0.00,"vatPct":20}]
}`,
      },
      { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
    ]);
    const text = result.response.text().trim();
    const match = text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(match ? match[0] : text);
    res.json(data);
  } catch (err) {
    console.error('[AI extract]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
