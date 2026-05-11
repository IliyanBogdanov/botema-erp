/**
 * One-shot reconciliation setup script.
 * Run: node run-recon-setup.js
 *
 * Steps:
 *  1. Migrate all Purchases → BizDocument INVOICE_IN
 *  2. Migrate all Invoices  → BizDocument INVOICE_OUT
 *  3. Fuzzy-link bank counterparties to supplier counterparties
 *  4. Run auto-match (Payment ↔ BizDocument)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const EUR_RATE = 1.95583;

// ── helpers ────────────────────────────────────────────────────────────────────
function log(msg) { console.log(new Date().toISOString().slice(11,19), msg); }

// ── Step 1 & 2: Purchases + Invoices → BizDocuments ──────────────────────────
async function migrateToBizDocs() {
  log('=== СТЪПКА 1: Purchases → BizDocuments ===');
  const cpCache = {};

  const findOrCreateCp = async (name, type, currency = 'EUR', country = 'BG') => {
    const key = `${type}:${(name || '').toLowerCase().trim()}`;
    if (cpCache[key]) return cpCache[key];
    let cp = await prisma.counterparty.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' }, type },
      select: { id: true },
    });
    if (!cp) {
      cp = await prisma.counterparty.create({
        data: { name: name.trim(), type, country: country || 'BG', currency: currency || 'EUR' },
        select: { id: true },
      });
      log(`  [NEW CP] ${type}: ${name}`);
    }
    cpCache[key] = cp;
    return cp;
  };

  // Purchases
  const purchases = await prisma.purchase.findMany({
    include: { supplier: { select: { name: true, currency: true, country: true } } },
    orderBy: { date: 'asc' },
  });
  log(`  Found ${purchases.length} purchases`);
  let pDone = 0, pSkip = 0;

  for (const p of purchases) {
    const exists = await prisma.bizDocument.findFirst({ where: { internalRef: p.id }, select: { id: true } });
    if (exists) { pSkip++; continue; }

    const supplierName = p.supplier?.name || 'Неизвестен доставчик';
    let counterpartyId = null;
    try {
      const cp = await findOrCreateCp(supplierName, 'SUPPLIER', p.supplier?.currency || 'EUR', p.supplier?.country || 'BG');
      counterpartyId = cp.id;
    } catch {}

    await prisma.bizDocument.create({
      data: {
        docType: 'INVOICE_IN',
        docNumber: p.invoiceNo || null,
        docDate: p.date,
        amountTotal: p.amount,
        currency: p.currency || 'EUR',
        vatType: 'STANDARD_BG',
        status: 'IMPORTED',
        counterpartyId,
        internalRef: p.id,
        externalRef: p.driveFileId || null,
        confidence: 90,
        notes: `Мигрирано от Purchase ${p.id}`,
      },
    });
    pDone++;
    if (pDone % 50 === 0) log(`  ... ${pDone} purchases done`);
  }
  log(`  Purchases: ${pDone} мигрирани, ${pSkip} вече съществуват`);

  // Invoices
  log('=== СТЪПКА 2: Invoices → BizDocuments ===');
  const invoices = await prisma.invoice.findMany({
    include: { client: { select: { name: true, eik: true } } },
    orderBy: { date: 'asc' },
  });
  log(`  Found ${invoices.length} invoices`);
  let iDone = 0, iSkip = 0;

  for (const inv of invoices) {
    const exists = await prisma.bizDocument.findFirst({ where: { internalRef: inv.id }, select: { id: true } });
    if (exists) { iSkip++; continue; }

    const clientName = inv.client?.name || 'Неизвестен клиент';
    let counterpartyId = null;
    try {
      const cp = await findOrCreateCp(clientName, 'CLIENT', inv.currency || 'BGN', 'BG');
      counterpartyId = cp.id;
    } catch {}

    await prisma.bizDocument.create({
      data: {
        docType: 'INVOICE_OUT',
        docNumber: inv.number,
        docDate: inv.date,
        dueDate: inv.dueDate || null,
        amountNet: inv.amountNet,
        vatAmount: inv.vatAmount,
        amountTotal: inv.amountTotal,
        currency: inv.currency || 'BGN',
        vatType: 'STANDARD_BG',
        status: 'IMPORTED',
        counterpartyId,
        internalRef: inv.id,
        confidence: 95,
        notes: `Мигрирано от Invoice ${inv.id}`,
      },
    });
    iDone++;
  }
  log(`  Invoices: ${iDone} мигрирани, ${iSkip} вече съществуват`);
  return { purchases: pDone, invoices: iDone };
}

// ── Step 3: Link bank counterparties to suppliers ─────────────────────────────
async function linkCounterparties() {
  log('=== СТЪПКА 3: Свързване на банкови контрагенти ===');

  const BANK_TO_SUPPLIER = [
    { patterns: ['лодес', 'lodes'],                              name: 'Lodes' },
    { patterns: ['алфалуче', 'alphaluce', 'алфа луче'],          name: 'Alphaluce' },
    { patterns: ['поларис', 'polaris'],                           name: 'Polaris' },
    { patterns: ['новалуче', 'novaluce'],                         name: 'Novaluce' },
    { patterns: ['ака лайтинг', 'aca lighting', 'ака'],          name: 'ACA Lighting' },
    { patterns: ['амбиентек', 'ambientec'],                       name: 'Ambientec' },
    { patterns: ['антракс', 'antrax'],                            name: 'Antrax' },
    { patterns: ['седап', 'atelier sedap', 'ателие седап'],       name: 'Atelier Sedap' },
    { patterns: ['братя брага', 'fratelli braga', 'braga'],      name: 'Fratelli Braga' },
    { patterns: ['формани', 'formani'],                           name: 'Formani' },
    { patterns: ['каримоку', 'karimoku'],                         name: 'Karimoku' },
    { patterns: ['kraab', 'краб'],                                name: 'Kraab' },
    { patterns: ['совет итали', 'sovet'],                         name: 'Sovet Italia' },
    { patterns: ['дхл', 'dhl express', 'dhl'],                   name: 'DHL' },
    { patterns: ['омега лайт', 'omega light', 'omega'],          name: 'Omega Light' },
    { patterns: ['спиди', 'speedy'],                              name: 'Speedy' },
    { patterns: ['зиета', 'zieta'],                               name: 'Zieta' },
    { patterns: ['макро', 'macro'],                               name: 'Macro' },
    { patterns: ['микроинвест', 'microinvest'],                   name: 'Microinvest' },
    { patterns: ['еконт', 'econt'],                               name: 'Econt' },
    { patterns: ['боналдо', 'bonaldo'],                           name: 'Bonaldo' },
    { patterns: ['top digital', 'топ диджитал'],                 name: 'Top Digital' },
    { patterns: ['фейсбук', 'facebook', 'meta'],                  name: 'Facebook/Meta Ads' },
    { patterns: ['гугъл', 'google ads', 'google'],               name: 'Google Ads' },
    { patterns: ['супърхостинг', 'superhosting'],                 name: 'Superhosting' },
    { patterns: ['нест студио', 'nest studio'],                   name: 'Nest Studio' },
    { patterns: ['ултралайт', 'ultralight', 'рашев', 'rashev'],  name: 'Rashev Ultralight' },
    { patterns: ['зира дизайн', 'zira design'],                  name: 'Zira Design' },
    { patterns: ['ват ', 'watt', 'ватт'],                         name: 'Watt' },
  ];

  function normalizeBankName(name) {
    return (name || '').toLowerCase()
      .replace(/["""]/g, '')
      .replace(/\bеоод\b|\bоод\b|\bад\b|\bет\b|\bдззд\b|\bgmbh\b|\bltd\b|\bllc\b|\bs\.a\b|\binc\b/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function matchSupplier(bankName) {
    const norm = normalizeBankName(bankName);
    for (const { patterns, name } of BANK_TO_SUPPLIER) {
      if (patterns.some(p => norm.includes(p))) return name;
    }
    return null;
  }

  const bankCPs = await prisma.counterparty.findMany({
    where: { type: 'OTHER' },
    select: { id: true, name: true },
  });
  log(`  Found ${bankCPs.length} bank (OTHER) counterparties`);

  const supplierCpCache = {};
  const findOrCreateSupplierCp = async (supplierName) => {
    if (supplierCpCache[supplierName]) return supplierCpCache[supplierName];
    let cp = await prisma.counterparty.findFirst({
      where: { name: { equals: supplierName, mode: 'insensitive' }, type: 'SUPPLIER' },
      select: { id: true },
    });
    if (!cp) {
      cp = await prisma.counterparty.create({
        data: { name: supplierName, type: 'SUPPLIER', country: 'BG', currency: 'EUR' },
        select: { id: true },
      });
      log(`  [NEW SUPPLIER CP] ${supplierName}`);
    }
    supplierCpCache[supplierName] = cp;
    return cp;
  };

  let linked = 0, noMatch = 0, paymentsUpdated = 0;

  for (const bankCp of bankCPs) {
    const supplierName = matchSupplier(bankCp.name);
    if (!supplierName) { noMatch++; continue; }

    const supplierCp = await findOrCreateSupplierCp(supplierName);
    log(`  MATCH: "${bankCp.name}" → "${supplierName}"`);
    linked++;

    const upd = await prisma.payment.updateMany({
      where: { counterpartyId: bankCp.id },
      data: { counterpartyId: supplierCp.id },
    });
    paymentsUpdated += upd.count;
  }
  log(`  Linked: ${linked}, No match: ${noMatch}, Payments updated: ${paymentsUpdated}`);
  return { linked, noMatch, paymentsUpdated };
}

// ── Step 4: Auto-match Payments ↔ BizDocuments ────────────────────────────────
async function autoMatch() {
  log('=== СТЪПКА 4: Авто-съпоставяне ===');

  const payments = await prisma.payment.findMany({
    where: { status: { in: ['UNMATCHED', 'PARTIAL'] } },
    include: { counterparty: { select: { id: true, name: true } } },
    orderBy: { paymentDate: 'desc' },
  });
  log(`  Processing ${payments.length} unmatched/partial payments`);

  const docs = await prisma.bizDocument.findMany({
    where: { status: { in: ['IMPORTED', 'NEW', 'NEEDS_REVIEW'] } },
    select: { id: true, docNumber: true, docDate: true, dueDate: true, amountTotal: true, currency: true, counterpartyId: true, status: true },
  });
  log(`  Available BizDocuments: ${docs.length}`);

  function amountsMatch(a, b, tolerance = 0.005) {
    if (!a || !b) return false;
    const diff = Math.abs(a - b);
    const avg = (Math.abs(a) + Math.abs(b)) / 2;
    return avg < 0.01 || diff / avg <= tolerance;
  }

  function extractInvoiceNumbers(text) {
    if (!text) return [];
    const matches = text.match(/\d{4,}/g) || [];
    return matches.filter(n => n.length >= 4);
  }

  let matched = 0, partial = 0, unmatched = 0;

  for (const payment of payments) {
    const windowStart = new Date(payment.paymentDate);
    windowStart.setDate(windowStart.getDate() - 45);
    const windowEnd = new Date(payment.paymentDate);
    windowEnd.setDate(windowEnd.getDate() + 5);

    let bestMatch = null;
    let confidence = 0;

    // Step 1: Invoice number in notes
    const invoiceNums = extractInvoiceNumbers(payment.notes || '');
    if (invoiceNums.length > 0) {
      const byNumber = docs.find(d =>
        d.docNumber && invoiceNums.some(n => d.docNumber.includes(n))
      );
      if (byNumber) { bestMatch = byNumber; confidence = 0.95; }
    }

    // Step 2: Counterparty + amount + date window
    if (!bestMatch && payment.counterpartyId) {
      const byCounterparty = docs.filter(d =>
        d.counterpartyId === payment.counterpartyId &&
        d.currency === payment.currency &&
        d.docDate >= windowStart && d.docDate <= windowEnd &&
        amountsMatch(Number(payment.amount), Number(d.amountTotal))
      );
      if (byCounterparty.length === 1) { bestMatch = byCounterparty[0]; confidence = 0.85; }
    }

    // Step 3: Exact amount + currency + date (unique)
    if (!bestMatch) {
      const byAmount = docs.filter(d =>
        d.status === 'IMPORTED' &&
        d.currency === payment.currency &&
        d.docDate >= windowStart && d.docDate <= windowEnd &&
        amountsMatch(Number(payment.amount), Number(d.amountTotal), 0.002)
      );
      if (byAmount.length === 1) { bestMatch = byAmount[0]; confidence = 0.6; }
    }

    if (bestMatch) {
      const newStatus = confidence >= 0.8 ? 'MATCHED' : 'PARTIAL';

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: newStatus },
      });

      // Check for existing link to avoid duplicates
      const existingLink = await prisma.reconciliationLink.findFirst({
        where: { paymentId: payment.id, targetDocId: bestMatch.id },
        select: { id: true },
      });
      if (!existingLink) {
        await prisma.reconciliationLink.create({
          data: {
            linkType: 'PAYMENT_TO_INVOICE',
            paymentId: payment.id,
            targetDocId: bestMatch.id,
            confidence: confidence,
          },
        });
      }

      if (newStatus === 'MATCHED') matched++;
      else partial++;
    } else {
      unmatched++;
    }
  }

  log(`  Matched: ${matched}, Partial: ${partial}, Unmatched: ${unmatched}`);
  return { matched, partial, unmatched, total: payments.length };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  log('███ BOTEMA RECONCILIATION SETUP ███');

  try {
    const migResult  = await migrateToBizDocs();
    const linkResult = await linkCounterparties();
    const matchResult = await autoMatch();

    log('');
    log('███ ГОТОВО ███');
    log(`  Мигрирани:  ${migResult.purchases} покупки + ${migResult.invoices} фактури`);
    log(`  Свързани CP: ${linkResult.linked}, Плащания обновени: ${linkResult.paymentsUpdated}`);
    log(`  Auto-match: ${matchResult.matched} MATCHED, ${matchResult.partial} PARTIAL, ${matchResult.unmatched} UNMATCHED`);
  } catch (err) {
    console.error('FATAL:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
