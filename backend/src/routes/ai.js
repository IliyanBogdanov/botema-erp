const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { auth } = require('../middleware/auth');
const prisma = require('../lib/prisma');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        where: { status: { in: ['ACTIVE', 'IN_PROGRESS'] } },
        include: { client: { select: { name: true } } },
        select: { code: true, name: true, status: true, client: true, budget: true, createdAt: true },
      }),
      prisma.invoice.findMany({
        orderBy: { date: 'desc' }, take: 20,
        include: { client: { select: { name: true } } },
        select: { number: true, date: true, amountNet: true, amountVat: true, currency: true, status: true, client: true, description: true },
      }),
      prisma.invoice.findMany({
        where: { status: { in: ['SENT', 'OVERDUE'] } },
        include: { client: { select: { name: true } } },
        select: { number: true, date: true, dueDate: true, amountNet: true, currency: true, status: true, client: true },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.bizDocument.findMany({
        orderBy: { docDate: 'desc' }, take: 30,
        include: { counterparty: { select: { name: true, type: true } } },
        select: { docType: true, docNumber: true, docDate: true, totalAmount: true, currency: true, counterparty: true, description: true },
      }),
      prisma.payment.findMany({
        orderBy: { paymentDate: 'desc' }, take: 20,
        select: { paymentDate: true, amount: true, currency: true, type: true, reference: true, counterpartyName: true, matchStatus: true },
      }),
      prisma.bizDocument.findMany({
        where: { docType: 'OFFER_OUT' },
        orderBy: { docDate: 'desc' }, take: 20,
        include: { counterparty: { select: { name: true } } },
        select: { docNumber: true, docDate: true, totalAmount: true, currency: true, counterparty: true, description: true },
      }),
      prisma.inventoryItem.findMany({ include: { supplier: { select: { name: true } } } }),
      prisma.invoice.aggregate({
        where: { date: { gte: new Date(`${currentYear}-01-01`) }, status: { not: 'CANCELLED' } },
        _sum: { amountNet: true },
      }),
      prisma.purchase.aggregate({
        where: { date: { gte: new Date(`${currentYear}-01-01`) } },
        _sum: { amount: true },
      }),
      prisma.payment.count({ where: { matchStatus: 'UNMATCHED' } }),
    ]);

    const revenueEur = Number(revenueAgg._sum.amountNet || 0);
    const costsTotal = Number(costsAgg._sum.amount || 0);
    const profit = revenueEur - costsTotal;

    const systemPrompt = `Ти си финансов AI асистент на Studio Botema ЕООД — бутик дизайн студио в Пазарджик, България.
Отговаряй САМО на БЪЛГАРСКИ. Бъди кратък, точен и практичен. Използвай данните от системата за точни отговори.

━━ ФИНАНСОВО РЕЗЮМЕ (${now.toLocaleDateString('bg-BG')}) ━━
• Приходи ${currentYear}: ${revenueEur.toFixed(2)} EUR
• Разходи ${currentYear}: ${costsTotal.toFixed(2)} BGN
• Активни проекти: ${projects.length}
• Клиенти в системата: ${clients.length} (CRM) + ${counterparties.length} контрагента (банкови)
• Неплатени фактури: ${unpaidInvoices.length}
• Ненасочени банкови транзакции: ${paymentsUnmatchedCount}

━━ АКТИВНИ ПРОЕКТИ ━━
${JSON.stringify(projects.map(p => ({ код: p.code, проект: p.name, клиент: p.client?.name, статус: p.status, бюджет: p.budget })), null, 2)}

━━ НЕПЛАТЕНИ ФАКТУРИ ━━
${JSON.stringify(unpaidInvoices.map(i => ({ №: i.number, дата: i.date?.toISOString?.()?.slice(0,10), падеж: i.dueDate?.toISOString?.()?.slice(0,10), сума: Number(i.amountNet), валута: i.currency, клиент: i.client?.name, статус: i.status })), null, 2)}

━━ ПОСЛЕДНИ 20 ФАКТУРИ ━━
${JSON.stringify(recentInvoices.map(i => ({ №: i.number, дата: i.date?.toISOString?.()?.slice(0,10), нето: Number(i.amountNet), ддс: Number(i.amountVat||0), валута: i.currency, клиент: i.client?.name, статус: i.status, описание: i.description })), null, 2)}

━━ ПОСЛЕДНИ 30 ДОКУМЕНТА (BizDocs) ━━
${JSON.stringify(recentBizDocs.map(d => ({ тип: d.docType, №: d.docNumber, дата: d.docDate?.toISOString?.()?.slice(0,10), сума: Number(d.totalAmount||0), валута: d.currency, контрагент: d.counterparty?.name, описание: d.description })), null, 2)}

━━ ПОСЛЕДНИ 20 БАНКОВИ ТРАНЗАКЦИИ ━━
${JSON.stringify(recentPayments.map(p => ({ дата: p.paymentDate?.toISOString?.()?.slice(0,10), сума: Number(p.amount), валута: p.currency, тип: p.type, контрагент: p.counterpartyName, референция: p.reference, статус: p.matchStatus })), null, 2)}

━━ ПОСЛЕДНИ ОФЕРТИ ━━
${JSON.stringify(recentOffers.map(o => ({ №: o.docNumber, дата: o.docDate?.toISOString?.()?.slice(0,10), сума: Number(o.totalAmount||0), валута: o.currency, клиент: o.counterparty?.name, описание: o.description })), null, 2)}

━━ СКЛАД ━━
${JSON.stringify(inventory.map(i => ({ код: i.code, наименование: i.name, категория: i.category, наличност: Number(i.qtyIn)-Number(i.qtyOut), локация: i.location })), null, 2)}

━━ ВСИЧКИ КОНТРАГЕНТИ ━━
${JSON.stringify(counterparties.map(c => ({ име: c.name, тип: c.type, еик: c.eik })), null, 2)}

Можеш да: анализираш финансови данни, правиш справки и сравнения, изчисляваш маржове и рентабилност по проект, генерираш текст за оферти/писма, предлагаш бизнес анализи, намираш неплатени задължения, обясняваш транзакции.`;

    // Convert history to Gemini format (role: 'user' | 'model')
    const geminiHistory = history.map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }));

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: systemPrompt,
    });

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    const reply = result.response.text();

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
  "type": "INVOICE_IN"|"INVOICE_OUT"|"PROFORMA"|"DELIVERY",
  "invoiceNo": "...",
  "date": "YYYY-MM-DD",
  "supplierName": "...",
  "clientName": "...",
  "amount": 0.00,
  "vatAmount": 0.00,
  "amountTotal": 0.00,
  "currency": "EUR"|"BGN",
  "description": "...",
  "confidence": 0.00,
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

// POST /api/ai/chat
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    // Fetch current context from DB
    const [clients, projects, recentInvoices, inventory] = await Promise.all([
      prisma.client.findMany({ select: { id: true, name: true, eik: true } }),
      prisma.project.findMany({ where: { status: 'ACTIVE' }, include: { client: { select: { name: true } } } }),
      prisma.invoice.findMany({
        orderBy: { date: 'desc' }, take: 30,
        include: { client: { select: { name: true } } },
        select: { number: true, date: true, amountNet: true, currency: true, status: true, client: true, description: true }
      }),
      prisma.inventoryItem.findMany({ include: { supplier: { select: { name: true } } } }),
    ]);

    const currentYear = new Date().getFullYear();
    const [revenueAgg, costsAgg] = await Promise.all([
      prisma.invoice.aggregate({ where: { date: { gte: new Date(`${currentYear}-01-01`) }, status: { not: 'CANCELLED' } }, _sum: { amountNet: true } }),
      prisma.purchase.aggregate({ where: { date: { gte: new Date(`${currentYear}-01-01`) } }, _sum: { amount: true } }),
    ]);

    const systemPrompt = `Ти си финансов AI асистент на Studio Botema ЕООД — бутик дизайн студио в Пазарджик, България. Отговаряй САМО на БЪЛГАРСКИ. Бъди кратък, точен и практичен.

ТЕКУЩИ ДАННИ (${new Date().toLocaleDateString('bg-BG')}):
- Приходи ${currentYear}: ${Number(revenueAgg._sum.amountNet || 0).toFixed(0)} BGN
- Разходи ${currentYear}: ${Number(costsAgg._sum.amount || 0).toFixed(0)} BGN  
- Активни проекти: ${projects.length}
- Клиенти: ${clients.length}

АКТИВНИ ПРОЕКТИ: ${JSON.stringify(projects.map(p => ({ code: p.code, name: p.name, client: p.client?.name })))}

ПОСЛЕДНИ ФАКТУРИ: ${JSON.stringify(recentInvoices.map(i => ({ no: i.number, date: i.date, amount: Number(i.amountNet), currency: i.currency, client: i.client?.name, status: i.status })))}

СКЛАД: ${JSON.stringify(inventory.map(i => ({ code: i.code, name: i.name, available: Number(i.qtyIn) - Number(i.qtyOut), location: i.location })))}

Можеш да: анализираш данни, правиш справки, изчисляваш маржове, генерираш текст за оферти/фактури, даваш бизнес съвети.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message }
      ]
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/extract — Extract data from PDF
router.post('/extract', auth, async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: `Извлечи данните от този документ и върни JSON:
          {
            "type": "INVOICE_IN"|"INVOICE_OUT"|"PROFORMA"|"DELIVERY",
            "invoiceNo": "...",
            "date": "YYYY-MM-DD",
            "supplierName": "...",
            "clientName": "...",
            "amount": 0.00,
            "vatAmount": 0.00,
            "amountTotal": 0.00,
            "currency": "EUR"|"BGN",
            "description": "...",
            "confidence": 0.00,
            "items": [{"description":"...","qty":1,"unitPrice":0.00,"vatPct":20}]
          }
          Само JSON, без markdown.` }
        ]
      }]
    });
    const data = JSON.parse(response.content[0].text);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
