require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const RULES = [
  { re: /SUPERHOSTING\.BG/i, name: 'SuperHosting.BG', type: 'SUPPLIER', subtype: 'HOSTING' },
  { re: /GOOGLE\s*\*?ADS|GOOGLE\.COM/i, name: 'Google Ads', type: 'SUPPLIER', subtype: 'ADVERTISING' },
  { re: /FACEBK|FB\.ME\/ADS|FACEBOOK/i, name: 'Meta / Facebook Ads', type: 'SUPPLIER', subtype: 'ADVERTISING' },
  { re: /TD NAP|НАП/i, name: 'НАП', type: 'OTHER', subtype: 'TAX_AUTHORITY' },
  { re: /MICROINVEST/i, name: 'Microinvest', type: 'SUPPLIER', subtype: 'SOFTWARE' },
  { re: /ECONT/i, name: 'Econt', type: 'COURIER', subtype: 'COURIER' },
  { re: /LAPTOP\.BG/i, name: 'Laptop.bg', type: 'SUPPLIER', subtype: 'EQUIPMENT' },
  { re: /PAZARUVAJ\.COM/i, name: 'Pazaruvaj.com', type: 'SUPPLIER', subtype: 'MARKETPLACE' },
  { re: /ТЕКСИМ БАНК|TEXIM/i, name: 'Texim Bank', type: 'BANK', subtype: 'BANK' },
  { re: /Вирт\.?\s*ПОС|VIRT\.?\s*POS/i, name: 'Virtual POS Studio Botema', type: 'BANK', subtype: 'PAYMENT_PROCESSOR' },
];

async function upsertCounterparty(rule) {
  const existing = await prisma.counterparty.findFirst({
    where: { name: { equals: rule.name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;
  if (!APPLY) return null;
  const created = await prisma.counterparty.create({
    data: {
      name: rule.name,
      type: rule.type,
      subtype: rule.subtype,
      country: 'BG',
      currency: 'BGN',
      notes: 'auto-created from bank payment description normalization',
    },
    select: { id: true },
  });
  return created.id;
}

async function main() {
  console.log(`=== NORMALIZE PAYMENT COUNTERPARTIES${APPLY ? ' (APPLY)' : ' (DRY RUN)'} ===`);
  const payments = await prisma.payment.findMany({
    where: { counterpartyId: null },
    select: { id: true, notes: true, reference: true },
  });

  const matches = [];
  for (const payment of payments) {
    const haystack = `${payment.notes || ''} ${payment.reference || ''}`;
    const rule = RULES.find(r => r.re.test(haystack));
    if (!rule) continue;
    matches.push({ payment, rule });
  }

  const counts = {};
  for (const match of matches) counts[match.rule.name] = (counts[match.rule.name] || 0) + 1;
  console.table(Object.entries(counts).map(([counterparty, count]) => ({ counterparty, count })));

  if (!APPLY) {
    console.log({ matchedPayments: matches.length });
    return;
  }

  for (const match of matches) {
    const counterpartyId = await upsertCounterparty(match.rule);
    await prisma.payment.update({
      where: { id: match.payment.id },
      data: { counterpartyId },
    });
  }

  console.log({ updatedPayments: matches.length });
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
