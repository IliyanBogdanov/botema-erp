const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { auth } = require('../middleware/auth');
const prisma = require('../lib/prisma');

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const openRouter = process.env.OPENROUTER_API_KEY ? new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
}) : null;

// Build messages array (history arrives in Gemini-style {role, parts} shape from the FE)
function buildMessages(systemPrompt, history, message) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  for (const h of (history || [])) {
    const text = h?.parts?.[0]?.text || '';
    if (text) msgs.push({ role: h.role === 'model' ? 'assistant' : 'user', content: text });
  }
  msgs.push({ role: 'user', content: message });
  return msgs;
}

// Free-only chain: Groq llama-3.3-70b → OpenRouter gpt-oss-20b:free
async function callAI(systemPrompt, message, history) {
  if (groq) {
    try {
      const msgs = buildMessages(systemPrompt, history, message);
      const resp = await groq.chat.completions.create({ model: 'llama-3.3-70b-versatile', messages: msgs, max_tokens: 2048 });
      console.log('[AI] Groq llama-3.3-70b OK');
      return resp.choices[0].message.content;
    } catch (err) {
      console.warn('[AI] Groq failed:', err.message?.slice(0, 100));
    }
  } else {
    console.warn('[AI] Groq not configured (missing GROQ_API_KEY)');
  }

  if (openRouter) {
    try {
      const msgs = buildMessages(systemPrompt, history, message);
      const resp = await openRouter.chat.completions.create({ model: 'openai/gpt-oss-20b:free', messages: msgs, max_tokens: 2048 });
      console.log('[AI] OpenRouter gpt-oss-20b:free OK');
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
      paymentsUnmatchedCount,
      allInvoices,
      allCosts,
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
      prisma.payment.count({ where: { status: 'UNMATCHED' } }),
      // All-time invoices for per-year revenue breakdown (company active from 2020)
      prisma.invoice.findMany({
        where: { status: { not: 'CANCELLED' }, date: { gte: new Date('2020-01-01') } },
        select: { date: true, amountNet: true, currency: true },
      }),
      // All-time costs from BizDocument INVOICE_IN (authoritative source, from 2020)
      // Same statuses as the dashboard — NEEDS_REVIEW docs must not count as costs;
      // credit notes are negative and must reduce costs
      prisma.bizDocument.findMany({
        where: {
          docType: 'INVOICE_IN',
          status: { in: ['REVIEWED', 'IMPORTED', 'MATCHED'] },
          amountTotal: { not: null },
          docDate: { gte: new Date('2020-01-01') },
        },
        select: { docDate: true, amountTotal: true, amountNet: true, vatAmount: true, currency: true },
      }),
    ]);

    // Build per-year revenue breakdown
    const BGN_PER_EUR = 1.95583;
    const revenueByYear = {};
    for (const inv of allInvoices) {
      const yr = inv.date ? new Date(inv.date).getFullYear() : null;
      if (!yr) continue;
      const eur = inv.currency === 'BGN' ? Number(inv.amountNet || 0) / BGN_PER_EUR : Number(inv.amountNet || 0);
      revenueByYear[yr] = (revenueByYear[yr] || 0) + eur;
    }

    // Build per-year costs breakdown (EUR, net of VAT — same units as revenue)
    const { netCostAmount } = require('../lib/costs');
    const fx = require('../lib/fx');
    const costsByYear = {};
    for (const doc of allCosts) {
      const yr = doc.docDate ? new Date(doc.docDate).getFullYear() : null;
      if (!yr) continue;
      costsByYear[yr] = (costsByYear[yr] || 0) + fx.toEur(netCostAmount(doc), doc.currency);
    }

    const revenueTotal = revenueByYear[currentYear] || 0;
    const costsTotal = costsByYear[currentYear] || 0;
    const revenueTotalAllTime = Object.values(revenueByYear).reduce((s, v) => s + v, 0);
    const costsTotalAllTime = Object.values(costsByYear).reduce((s, v) => s + v, 0);

    const systemPrompt = `Ти си финансов AI асистент на Studio Botema ЕООД — бутик дизайн студио в Пазарджик, България.
Отговаряй САМО на БЪЛГАРСКИ. Бъди кратък, точен и практичен. Използвай данните от системата за точни отговори.

=== ФИНАНСОВО РЕЗЮМЕ (${now.toLocaleDateString('bg-BG')}) ===
- Приходи ${currentYear}: ${revenueTotal.toFixed(0)} EUR (нето, без ДДС)
- Разходи ${currentYear}: ${costsTotal.toFixed(0)} EUR (нето, без възстановим ДДС)
- Приходи ОТ НАЧАЛО (всички години): ${revenueTotalAllTime.toFixed(0)} EUR
- Разходи ОТ НАЧАЛО (всички години): ${costsTotalAllTime.toFixed(0)} EUR
- Активни проекти: ${projects.length}
- Клиенти: ${clients.length} (CRM) + ${counterparties.length} контрагента (банкови)
- Неплатени фактури: ${unpaidInvoices.length}
- Ненасочени банкови плащания: ${paymentsUnmatchedCount}

=== ПРИХОДИ ПО ГОДИНИ (EUR) ===
${Object.entries(revenueByYear).sort(([a],[b]) => Number(a)-Number(b)).map(([yr, eur]) => `- ${yr}: ${eur.toFixed(0)} EUR`).join('\n')}

=== РАЗХОДИ ПО ГОДИНИ (EUR, нето) ===
${Object.entries(costsByYear).sort(([a],[b]) => Number(a)-Number(b)).map(([yr, eur]) => `- ${yr}: ${eur.toFixed(0)} EUR`).join('\n')}

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

// POST /api/ai/extract — Extract data from PDF (free chain: Groq → OpenRouter)
router.post('/extract', auth, async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;
    const { parseDocumentWithAI } = require('../lib/aiParser');
    const parsed = await parseDocumentWithAI(filename || 'document.pdf', '', Buffer.from(pdfBase64, 'base64'));
    res.json({
      type: parsed.docType || parsed.type || 'INVOICE_IN',
      invoiceNo: parsed.invoiceNo || null,
      date: parsed.docDate || null,
      supplierName: parsed.supplierName || null,
      clientName: parsed.clientName || null,
      amount: parsed.amountNet ?? null,
      vatAmount: parsed.vatAmount ?? null,
      amountTotal: parsed.amountTotal ?? null,
      currency: parsed.currency || 'EUR',
      description: parsed.description || null,
      confidence: (Number(parsed.confidence) || 0) / 100,
    });
  } catch (err) {
    console.error('[AI extract]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
