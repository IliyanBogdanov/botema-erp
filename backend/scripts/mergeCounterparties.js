/**
 * Merge duplicate Counterparty records.
 * For each pair of duplicates (by name similarity), keeps the richer one
 * and re-links all foreign keys to it.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalize(name) {
  return name.toLowerCase()
    .replace(/\s+(еоод|оод|ад|ет| ltd|llc|s\.r\.l\.|inc)\b/gi, '')
    .replace(/[.,\-"'—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const common = [...wa].filter(w => wb.has(w)).length;
  const total = new Set([...wa, ...wb]).size;
  return total > 0 ? common / total : 0;
}

async function countRefs(id) {
  const [payments, bizDocs, orders1, orders2, deliveries, missing] = await Promise.all([
    prisma.payment.count({ where: { counterpartyId: id } }),
    prisma.bizDocument.count({ where: { counterpartyId: id } }),
    prisma.order.count({ where: { clientId: id } }),
    prisma.order.count({ where: { supplierId: id } }),
    prisma.delivery.count({ where: { counterpartyId: id } }),
    prisma.missingDocument.count({ where: { counterpartyId: id } }),
  ]);
  return payments + bizDocs + orders1 + orders2 + deliveries + missing;
}

async function mergeInto(keepId, removeId) {
  // Re-link all foreign keys from removeId → keepId
  await prisma.payment.updateMany({ where: { counterpartyId: removeId }, data: { counterpartyId: keepId } });
  await prisma.bizDocument.updateMany({ where: { counterpartyId: removeId }, data: { counterpartyId: keepId } });
  await prisma.order.updateMany({ where: { clientId: removeId }, data: { clientId: keepId } });
  await prisma.order.updateMany({ where: { supplierId: removeId }, data: { supplierId: keepId } });
  await prisma.delivery.updateMany({ where: { counterpartyId: removeId }, data: { counterpartyId: keepId } });
  await prisma.missingDocument.updateMany({ where: { counterpartyId: removeId }, data: { counterpartyId: keepId } });
  await prisma.contact.updateMany({ where: { counterpartyId: removeId }, data: { counterpartyId: keepId } });
  // Delete the duplicate
  await prisma.counterparty.delete({ where: { id: removeId } });
}

async function main() {
  const allCps = await prisma.counterparty.findMany({ select: { id: true, name: true, eik: true, type: true } });
  console.log(`Starting with ${allCps.length} counterparties`);

  // Build deduplicated merge groups (union-find style)
  const processed = new Set();
  const mergeMap = {}; // removeId → keepId

  for (let i = 0; i < allCps.length; i++) {
    if (processed.has(allCps[i].id)) continue;
    for (let j = i + 1; j < allCps.length; j++) {
      if (processed.has(allCps[j].id)) continue;
      const sim = similarity(allCps[i].name, allCps[j].name);
      if (sim >= 0.88) {
        // Determine which to keep: prefer eik, then longer name, then more refs
        let keepIdx = i, removeIdx = j;
        if (!allCps[i].eik && allCps[j].eik) { keepIdx = j; removeIdx = i; }
        else if (allCps[i].name.length < allCps[j].name.length && !allCps[i].eik) { keepIdx = j; removeIdx = i; }

        const keepId = allCps[keepIdx].id;
        const removeId = allCps[removeIdx].id;
        mergeMap[removeId] = keepId;
        processed.add(removeId);
        console.log(`  MERGE [${sim.toFixed(2)}] "${allCps[removeIdx].name}" → "${allCps[keepIdx].name}"`);
      }
    }
  }

  console.log(`\nWill merge ${Object.keys(mergeMap).length} duplicates`);

  // Execute merges
  let merged = 0;
  for (const [removeId, keepId] of Object.entries(mergeMap)) {
    // Make sure keepId is valid (hasn't itself been merged away)
    const resolvedKeepId = mergeMap[keepId] || keepId;
    try {
      await mergeInto(resolvedKeepId, removeId);
      merged++;
    } catch (err) {
      console.error(`  ERROR merging ${removeId} → ${resolvedKeepId}: ${err.message}`);
    }
  }

  const remaining = await prisma.counterparty.count();
  console.log(`\nDone: merged ${merged}, remaining counterparties: ${remaining}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
