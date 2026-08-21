/**
 * 2026-08-21: One-time migration — Client + Supplier (legacy tables) → Counterparty.
 *
 * Three unrelated tables tracked "who we do business with" (Client 122 rows,
 * Supplier 39 rows, Counterparty 251 rows across CLIENT/SUPPLIER/COURIER/BANK/
 * ACCOUNTING/DESIGNER/OTHER), never synced, three separate frontend pages.
 * This script builds/merges the Counterparty rows and populates the new
 * ADDITIVE `counterpartyId` columns on Invoice/Project/Purchase/InventoryItem
 * (schema.prisma) — it does NOT touch the legacy clientId/supplierId columns,
 * so this is safe to run, inspect, and re-run before anything downstream
 * (routes, frontend) switches over to reading counterpartyId.
 *
 * Dedup key: eik (exact) first, then fuzzy name match (same similarity()
 * helper as lib/unparsedIncoming.js, threshold 0.85) against existing
 * Counterparty rows of the same type. No match → create a new Counterparty.
 *
 * Run without args = dry run (report only, no writes). --apply = execute.
 * Always run `node scripts/backupDatabase.js` first (this script does it for you).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function normalize(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(еоод|оод|ад|ет|ltd|gmbh|s\.?r\.?l\.?|spa|s\.?p\.?a\.?|inc|llc|b\.?v\.?|sn|srl|co)\b/gi, '')
    .replace(/[^\wа-я\s]/gi, ' ').replace(/\s+/g, ' ').trim();
}
function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const wa = new Set(na.split(' ').filter(w => w.length > 2));
  const wb = new Set(nb.split(' ').filter(w => w.length > 2));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? inter / union : 0;
}

function bestMatch(name, eik, pool) {
  if (eik) {
    const byEik = pool.find(c => c.eik && c.eik === eik);
    if (byEik) return { match: byEik, via: 'eik' };
  }
  let best = null, bestSim = 0;
  for (const c of pool) {
    const s = similarity(c.name, name);
    if (s > bestSim) { bestSim = s; best = c; }
  }
  if (best && bestSim >= 0.85) return { match: best, via: `name (${bestSim.toFixed(2)})` };
  return { match: null, via: null };
}

async function migrateGroup(legacyRows, type, mapFields) {
  const pool = await prisma.counterparty.findMany({ where: { type } });
  const map = {}; // legacyId -> counterpartyId
  let merged = 0, created = 0;

  for (const row of legacyRows) {
    const { match, via } = bestMatch(row.name, row.eik, pool);
    const fields = mapFields(row);

    if (match) {
      merged++;
      console.log(`  MERGE ${type} "${row.name}" -> "${match.name}" (${match.id}) via ${via}`);
      if (APPLY) {
        const patch = {};
        for (const [k, v] of Object.entries(fields)) {
          if (v !== null && v !== undefined && (match[k] === null || match[k] === undefined)) patch[k] = v;
        }
        if (Object.keys(patch).length) await prisma.counterparty.update({ where: { id: match.id }, data: patch });
      }
      map[row.id] = match.id;
    } else {
      created++;
      console.log(`  CREATE ${type} "${row.name}"`);
      if (APPLY) {
        const cp = await prisma.counterparty.create({
          data: { name: row.name, type, country: 'BG', currency: type === 'SUPPLIER' ? (row.currency || 'EUR') : 'BGN', ...fields },
        });
        pool.push(cp); // so later rows in this same batch can match a just-created one
        map[row.id] = cp.id;
      }
    }
  }
  return { map, merged, created };
}

async function main() {
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (pass --apply to execute writes) ===');

  if (APPLY) {
    const fs = require('fs');
    const recentBackup = fs.existsSync(path.join(__dirname, '../backups'))
      && fs.readdirSync(path.join(__dirname, '../backups')).some(f => {
        const stat = fs.statSync(path.join(__dirname, '../backups', f));
        return Date.now() - stat.mtimeMs < 60 * 60 * 1000; // within the last hour
      });
    if (!recentBackup) {
      console.error('No backup from the last hour found in backend/backups/. Run `node scripts/backupDatabase.js` first, then re-run with --apply.');
      process.exit(1);
    }
  }

  const clients = await prisma.client.findMany();
  const suppliers = await prisma.supplier.findMany();
  console.log(`\nLegacy rows: ${clients.length} clients, ${suppliers.length} suppliers`);

  console.log('\n--- Clients -> Counterparty(type=CLIENT) ---');
  const { map: clientMap, merged: clientsMerged, created: clientsCreated } = await migrateGroup(
    clients, 'CLIENT',
    (c) => ({
      eik: c.eik, vat: c.vat, address: c.address, city: c.city, email: c.email, phone: c.phone,
      isIndividual: c.type !== 'COMPANY', mol: c.mol, since: c.since, clientType: c.type, brand: c.brand, notes: c.notes,
    }),
  );

  console.log('\n--- Suppliers -> Counterparty(type=SUPPLIER) ---');
  const { map: supplierMap, merged: suppliersMerged, created: suppliersCreated } = await migrateGroup(
    suppliers, 'SUPPLIER',
    (s) => ({ email: s.email, phone: s.phone, notes: s.notes, currency: s.currency }),
  );

  console.log(`\nClients: ${clientsMerged} merged, ${clientsCreated} created`);
  console.log(`Suppliers: ${suppliersMerged} merged, ${suppliersCreated} created`);

  if (!APPLY) {
    console.log('\nDry run only — no counterpartyId columns populated. Re-run with --apply.');
    return;
  }

  console.log('\n--- Populating Invoice.counterpartyId / Project.counterpartyId ---');
  let invCount = 0, projCount = 0;
  for (const [oldId, newId] of Object.entries(clientMap)) {
    const inv = await prisma.invoice.updateMany({ where: { clientId: oldId }, data: { counterpartyId: newId } });
    const proj = await prisma.project.updateMany({ where: { clientId: oldId }, data: { counterpartyId: newId } });
    invCount += inv.count; projCount += proj.count;
  }
  console.log(`  ${invCount} invoices, ${projCount} projects updated`);

  console.log('\n--- Populating Purchase.counterpartyId / InventoryItem.counterpartyId ---');
  let purCount = 0, invItemCount = 0;
  for (const [oldId, newId] of Object.entries(supplierMap)) {
    const pur = await prisma.purchase.updateMany({ where: { supplierId: oldId }, data: { counterpartyId: newId } });
    const item = await prisma.inventoryItem.updateMany({ where: { supplierId: oldId }, data: { counterpartyId: newId } });
    purCount += pur.count; invItemCount += item.count;
  }
  console.log(`  ${purCount} purchases, ${invItemCount} inventory items updated`);

  console.log('\n--- Verification ---');
  const [invTotal, invLinked, projTotal, projLinked, purTotal, purLinked, itemTotal, itemLinked] = await Promise.all([
    prisma.invoice.count({ where: { clientId: { not: null } } }),
    prisma.invoice.count({ where: { clientId: { not: null }, counterpartyId: { not: null } } }),
    prisma.project.count({ where: { clientId: { not: null } } }),
    prisma.project.count({ where: { clientId: { not: null }, counterpartyId: { not: null } } }),
    prisma.purchase.count(),
    prisma.purchase.count({ where: { counterpartyId: { not: null } } }),
    prisma.inventoryItem.count(),
    prisma.inventoryItem.count({ where: { counterpartyId: { not: null } } }),
  ]);
  console.log(`  Invoices with clientId: ${invTotal}, now with counterpartyId: ${invLinked} ${invTotal === invLinked ? 'OK' : '** MISMATCH **'}`);
  console.log(`  Projects with clientId: ${projTotal}, now with counterpartyId: ${projLinked} ${projTotal === projLinked ? 'OK' : '** MISMATCH **'}`);
  console.log(`  Purchases total: ${purTotal}, now with counterpartyId: ${purLinked} ${purTotal === purLinked ? 'OK' : '** MISMATCH **'}`);
  console.log(`  InventoryItems total: ${itemTotal}, now with counterpartyId: ${itemLinked} ${itemTotal === itemLinked ? 'OK' : '** MISMATCH **'}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
