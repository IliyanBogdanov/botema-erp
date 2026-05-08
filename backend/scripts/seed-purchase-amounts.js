require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/lib/prisma');

const BGN_PER_EUR = 1.95583;

const SUPPLIER_PATTERNS = [
  { match: /lodes/i, currency: 'EUR', min: 2000, max: 15000, step: 50 },
  { match: /alphaluce/i, currency: 'EUR', min: 1500, max: 8000, step: 50 },
  { match: /polaris/i, currency: 'BGN', min: 500, max: 3000, step: 10 },
  { match: /aca\s*lighting|\baca\b/i, currency: 'EUR', min: 500, max: 3000, step: 25 },
  { match: /dhl|speedy/i, currency: 'EUR', min: 50, max: 300, step: 5 },
  { match: /formani/i, currency: 'EUR', min: 1000, max: 5000, step: 25 },
  { match: /bonaldo/i, currency: 'EUR', min: 2500, max: 12000, step: 50 },
  { match: /karimoku/i, currency: 'EUR', min: 4000, max: 18000, step: 100 },
  { match: /atelier\s*sedap|sedap/i, currency: 'EUR', min: 800, max: 4000, step: 25 },
  { match: /braga|fratelli\s*braga/i, currency: 'EUR', min: 800, max: 4500, step: 25 },
  { match: /antrax/i, currency: 'EUR', min: 1200, max: 6000, step: 25 },
  { match: /zieta/i, currency: 'EUR', min: 1500, max: 7000, step: 25 },
  { match: /sovet/i, currency: 'EUR', min: 2000, max: 10000, step: 50 },
  { match: /top\s*digital|топ\s*диджитал/i, currency: 'BGN', min: 150, max: 1200, step: 10 },
  { match: /ватт|watt/i, currency: 'BGN', min: 100, max: 1200, step: 10 },
  { match: /sunfoods|сънфуудс/i, currency: 'BGN', min: 80, max: 600, step: 10 },
];

const DEFAULT_RULE = { currency: 'EUR', min: 250, max: 2500, step: 25 };

function hashString(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function chooseRule(supplierName, currentCurrency) {
  return SUPPLIER_PATTERNS.find(rule => rule.match.test(supplierName || ''))
    || { ...DEFAULT_RULE, currency: currentCurrency || DEFAULT_RULE.currency };
}

function convertRange(rule, targetCurrency) {
  if (!targetCurrency || targetCurrency === rule.currency) return rule;

  if (rule.currency === 'EUR' && targetCurrency === 'BGN') {
    return {
      ...rule,
      currency: 'BGN',
      min: Math.round(rule.min * BGN_PER_EUR),
      max: Math.round(rule.max * BGN_PER_EUR),
      step: Math.max(5, Math.round(rule.step * BGN_PER_EUR)),
    };
  }

  if (rule.currency === 'BGN' && targetCurrency === 'EUR') {
    return {
      ...rule,
      currency: 'EUR',
      min: Number((rule.min / BGN_PER_EUR).toFixed(2)),
      max: Number((rule.max / BGN_PER_EUR).toFixed(2)),
      step: Number((rule.step / BGN_PER_EUR).toFixed(2)),
    };
  }

  return { ...rule, currency: targetCurrency };
}

function buildAmount(key, rule) {
  const range = Math.max(rule.max - rule.min, rule.step);
  const steps = Math.max(1, Math.round(range / rule.step));
  const offset = hashString(key) % (steps + 1);
  return Number((rule.min + (offset * rule.step)).toFixed(2));
}

async function main() {
  const purchases = await prisma.purchase.findMany({
    where: { amount: 0 },
    include: { supplier: true },
    orderBy: [{ year: 'asc' }, { date: 'asc' }],
  });

  console.log(`Found ${purchases.length} purchases still at 0 to seed`);

  let updated = 0;
  for (const purchase of purchases) {
    const supplierName = purchase.supplier?.name || 'Unknown supplier';
    const baseRule = chooseRule(supplierName, purchase.currency);
    const rule = convertRange(baseRule, purchase.currency || baseRule.currency);
    const amount = buildAmount(`${purchase.id}:${supplierName}:${purchase.year}`, rule);

    await prisma.purchase.update({
      where: { id: purchase.id },
      data: {
        amount,
        currency: rule.currency || purchase.currency,
        description: purchase.description || `Estimated ${supplierName} purchase`,
      },
    });

    updated += 1;
    console.log(`✓ ${supplierName}: ${amount.toFixed(2)} ${rule.currency || purchase.currency}${purchase.driveFileId ? ' (AI fallback)' : ''}`);
  }

  const totalsByCurrency = await prisma.purchase.groupBy({
    by: ['currency'],
    _sum: { amount: true },
    _count: { id: true },
  });

  console.log(`\nUpdated ${updated} purchases`);
  console.log('Totals by currency:', JSON.stringify(totalsByCurrency));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
