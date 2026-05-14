/**
 * Gemini-powered script to process 105 unmatched payments:
 * - Capital injections → mark MATCHED with [capital-injection] note
 * - Payments with invoice numbers → create BizDoc (INVOICE_IN) and link
 * - Proforma payments → create BizDoc (PROFORMA_IN) and link
 * - Unknown → use Gemini to categorize and create appropriate record
 *
 * Run: node run-gemini-create-bizdocs.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const prisma = new PrismaClient();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const BATCH_SIZE = 10;
const DELAY_MS = 2000;

function log(msg) { console.log(new Date().toISOString().slice(11, 19), msg); }

async function askGemini(prompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      log(`Gemini attempt ${attempt} failed: ${err.message?.slice(0, 100)}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}

function parseGeminiJson(text) {
  const jsonMatch = text?.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    text?.match(/(\[[\s\S]*\])/);
  if (!jsonMatch) return [];
  try { return JSON.parse(jsonMatch[1]); } catch { return []; }
}

async function main() {
  log('=== GEMINI CREATE BIZDOCS FROM UNMATCHED PAYMENTS ===');

  const payments = await prisma.payment.findMany({
    where: { status: 'UNMATCHED', paymentType: { in: ['BANK_TRANSFER', 'COD'] } },
    select: { id: true, paymentDate: true, amount: true, currency: true, reference: true, notes: true },
    orderBy: { paymentDate: 'asc' },
  });
  log(`Payments to process: ${payments.length}`);

  // Load all counterparties for Gemini context
  const counterparties = await prisma.counterparty.findMany({
    select: { id: true, name: true, eik: true },
  });

  // IBAN → known counterparty mapping from existing matched payments
  const ibanCpMap = {};
  const matchedPayments = await prisma.payment.findMany({
    where: { status: 'MATCHED', counterpartyId: { not: null } },
    select: { notes: true, counterpartyId: true },
    take: 500,
  });
  matchedPayments.forEach(p => {
    const m = (p.notes || '').match(/IBAN:\s*(BG\w+)/i);
    if (m && p.counterpartyId) ibanCpMap[m[1]] = p.counterpartyId;
  });
  log(`IBAN→CP mappings from history: ${Object.keys(ibanCpMap).length}`);

  const cpList = counterparties.map(c => `${c.id}|${c.name}${c.eik ? '|EIK:' + c.eik : ''}`).join('\n');

  let created = 0, matched = 0, capitalInjections = 0, skipped = 0;

  // Process in batches
  for (let i = 0; i < payments.length; i += BATCH_SIZE) {
    const batch = payments.slice(i, i + BATCH_SIZE);

    const paymentList = batch.map(p => ({
      id: p.id,
      date: p.paymentDate?.toISOString().slice(0, 10),
      amount: Number(p.amount),
      currency: p.currency,
      reference: p.reference || '',
      notes: p.notes || '',
      ibanInNotes: (p.notes || '').match(/IBAN:\s*(BG\w+)/i)?.[1] || null,
    }));

    const prompt = `
Ти си финансов асистент за българска дизайн фирма "Студио Ботема". Имаш списък с непроверени банкови плащания. 
Трябва да ги класифицираш и да предложиш действия.

СПИСЪК С КОНТРАГЕНТИ В СИСТЕМАТА:
${cpList}

ПЛАЩАНИЯ ЗА ОБРАБОТКА (JSON):
${JSON.stringify(paymentList, null, 2)}

За всяко плащане върни JSON масив с обекти:
{
  "paymentId": "...",
  "action": "capital_injection" | "create_bizdoc" | "skip",
  "docType": "INVOICE_IN" | "PROFORMA_IN" | "CREDIT_NOTE" | "OTHER" | null,
  "docNumber": "извлечен номер на документ или null",
  "counterpartyId": "id от списъка с контрагенти или null",
  "counterpartyName": "ако не е в списъка - ново название или null",
  "description": "кратко описание",
  "confidence": 0.0-1.0,
  "reason": "обяснение"
}

Правила:
- "Доп. пар. вноска от едноличен собственик" или подобни вноски от собственика → action="capital_injection"
- "Грешно преведена сума" или обратни транзакции → action="skip"
- Плащания с "ФАКТУРА", "Фактура", "INVOICE" → action="create_bizdoc", docType="INVOICE_IN"
- Плащания с "ПРОФОРМА", "Proforma", "ПРОФ." → action="create_bizdoc", docType="PROFORMA_IN"
- "Аванс" за доставка без фактура → action="create_bizdoc", docType="PROFORMA_IN"
- "Застраховка" → action="create_bizdoc", docType="INVOICE_IN"
- "НАЛОЖЕН ПЛАТЕЖ" → action="skip" (COD collection, not expense)
- "Комисион" или консултантски услуги → action="create_bizdoc", docType="INVOICE_IN"
- Ако не можеш да определиш → action="skip"

Извличай docNumber само ако е ясно посочен (напр. "ФАКТУРА N 9000001897" → "9000001897").
За counterpartyId: търси по ключови думи от IBAN/notes в списъка с контрагенти.

Върни САМО JSON масив, без обяснения.`;

    log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: processing ${batch.length} payments...`);
    const response = await askGemini(prompt);
    if (!response) { skipped += batch.length; continue; }

    const results = parseGeminiJson(response);
    if (!results.length) { log('  No valid JSON from Gemini'); skipped += batch.length; continue; }

    for (const r of results) {
      const payment = batch.find(p => p.id === r.paymentId);
      if (!payment) continue;

      if (r.action === 'capital_injection') {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'MATCHED', notes: (payment.notes || '') + ' [auto:capital-injection]' },
        });
        capitalInjections++;
        log(`  ✓ Capital injection: ${Number(payment.amount)} ${payment.currency}`);
        continue;
      }

      if (r.action === 'skip') {
        skipped++;
        log(`  → Skip: ${(payment.notes || '').slice(0, 50)} | reason: ${r.reason?.slice(0, 50)}`);
        continue;
      }

      if (r.action === 'create_bizdoc') {
        // Resolve or create counterparty
        let counterpartyId = r.counterpartyId || null;

        // Try IBAN-based mapping first
        const ibanInNotes = (payment.notes || '').match(/IBAN:\s*(BG\w+)/i)?.[1];
        if (!counterpartyId && ibanInNotes && ibanCpMap[ibanInNotes]) {
          counterpartyId = ibanCpMap[ibanInNotes];
        }

        // Create new counterparty if name provided but no ID
        if (!counterpartyId && r.counterpartyName) {
          const existing = await prisma.counterparty.findFirst({
            where: { name: { contains: r.counterpartyName.slice(0, 20), mode: 'insensitive' } },
            select: { id: true },
          });
          if (existing) {
            counterpartyId = existing.id;
          } else {
            const newCp = await prisma.counterparty.create({
              data: { name: r.counterpartyName, type: 'SUPPLIER' },
              select: { id: true },
            });
            counterpartyId = newCp.id;
            log(`  + Created counterparty: ${r.counterpartyName}`);
          }
        }

        // Sanitize docType to valid enum values
        const validDocTypes = ['INVOICE_IN', 'PROFORMA_IN', 'CREDIT_NOTE', 'INVOICE_OUT', 'PROFORMA_OUT', 'OTHER'];
        const docType = validDocTypes.includes(r.docType) ? r.docType : 'INVOICE_IN';

        // Create BizDocument
        try {
          const bizDoc = await prisma.bizDocument.create({
            data: {
              docNumber: r.docNumber || null,
              docType,
              docDate: payment.paymentDate,
              amountTotal: payment.amount,
              currency: payment.currency,
              status: 'MATCHED',
              counterpartyId: counterpartyId || undefined,
              notes: `[auto-created from payment ${payment.id}] ${r.description || ''}`,
            },
            select: { id: true },
          });

          // Link payment to BizDoc
          await prisma.reconciliationLink.create({
            data: {
              paymentId: payment.id,
              targetDocId: bizDoc.id,
              linkType: 'PAYMENT_TO_INVOICE',
              confidence: r.confidence || 0.8,
              amountLinked: payment.amount,
              currency: payment.currency,
              notes: `[gemini-create] ${r.reason || ''}`,
            },
          });

          // Mark payment as MATCHED
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: 'MATCHED', counterpartyId: counterpartyId || undefined },
          });

          created++;
          log(`  ✓ Created BizDoc ${r.docType} #${r.docNumber || 'no-num'} → ${r.counterpartyName || counterpartyId || 'unknown'} (${Number(payment.amount)} ${payment.currency})`);
        } catch (err) {
          log(`  ✗ Error creating BizDoc: ${err.message?.slice(0, 80)}`);
          skipped++;
        }
        continue;
      }

      skipped++;
    }

    if (i + BATCH_SIZE < payments.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  log('=== DONE ===');
  log(`Created BizDocs: ${created}`);
  log(`Capital injections marked: ${capitalInjections}`);
  log(`Skipped: ${skipped}`);

  // Final stats
  const stats = await prisma.payment.groupBy({ by: ['status'], _count: true });
  stats.forEach(s => log(`  ${s.status}: ${s._count}`));

  await prisma.$disconnect();
}

main().catch(async err => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
