const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const Anthropic = require('@anthropic-ai/sdk');
const { auth } = require('../middleware/auth');

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
            "items": [{"description":"...","qty":1,"unitPrice":0.00}]
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
