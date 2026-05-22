const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BGN = 1.95583;
const toEur = d => d.currency === 'BGN' ? Number(d.amountTotal) / BGN : d.currency === 'USD' ? Number(d.amountTotal) * 0.92 : Number(d.amountTotal);

async function rejectDoc(id, reason) {
  await prisma.reconciliationLink.deleteMany({ where: { OR: [{ sourceDocId: id }, { targetDocId: id }] } });
  await prisma.bizDocument.update({ where: { id }, data: { status: 'REJECTED', notes: 'REJECTED: ' + reason } });
}

async function main() {
  let eurSaved = 0;

  // 1. 1408 EUR x3 INVOICE_IN from Purchase - keep "186" (cleanest invoice number), reject PC24914 and 83669
  const p1408 = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', amountTotal: { gte: 1405, lte: 1412 }, status: { notIn: ['REJECTED', 'ARCHIVED'] }, docDate: new Date('2026-02-01') },
    select: { id: true, docNumber: true, status: true, notes: true, amountTotal: true, currency: true }
  });
  console.log('1408 EUR INVOICE_IN docs:', p1408.map(d => d.docNumber));
  // Keep the one with docNumber '186' (the actual invoice number), reject the rest
  for (const doc of p1408) {
    if (doc.docNumber !== '186') {
      await rejectDoc(doc.id, 'duplicate Purchase entry for same invoice 186 (1408 EUR Feb 1 2026)');
      eurSaved += toEur(doc);
      console.log('Rejected 1408 EUR duplicate docNumber=' + doc.docNumber);
    }
  }

  // 2. Файнест 0000000410 Apr 14 INVOICE_IN misclassified (PDF = proforma)
  const fainestProforma = await prisma.bizDocument.findFirst({
    where: { docNumber: '0000000410', docType: 'INVOICE_IN', docDate: new Date('2026-04-14'), status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, notes: true, amountTotal: true, currency: true }
  });
  if (fainestProforma) {
    await prisma.bizDocument.update({ where: { id: fainestProforma.id }, data: { status: 'ARCHIVED', notes: fainestProforma.notes + ' | ARCHIVED: proforma (PDF name: Проформа), real invoice is 0000000500' } });
    eurSaved += toEur(fainestProforma);
    console.log('Archived Файнест proforma 0000000410 (' + Math.round(toEur(fainestProforma)) + ' EUR)');
  }

  // 3. FSPRO P66/04/2026 INVOICE_IN misclassified as proforma
  const fsproProforma = await prisma.bizDocument.findFirst({
    where: { docNumber: 'P66/04/2026', docType: 'INVOICE_IN', status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, notes: true, amountTotal: true, currency: true }
  });
  if (fsproProforma) {
    // Move reconciliation links to the real invoice 93/04/2026
    const realInvoice = await prisma.bizDocument.findFirst({ where: { docNumber: '93/04/2026', docType: 'INVOICE_IN', status: { notIn: ['REJECTED', 'ARCHIVED'] } }, select: { id: true } });
    if (realInvoice) {
      await prisma.reconciliationLink.updateMany({ where: { targetDocId: fsproProforma.id }, data: { targetDocId: realInvoice.id } });
      console.log('Moved FSPRO proforma recon links to invoice 93/04/2026');
    }
    await prisma.bizDocument.update({ where: { id: fsproProforma.id }, data: { status: 'ARCHIVED', notes: fsproProforma.notes + ' | ARCHIVED: proforma, real invoice is 93/04/2026' } });
    eurSaved += toEur(fsproProforma);
    console.log('Archived FSPRO P66/04/2026 proforma (' + Math.round(toEur(fsproProforma)) + ' EUR)');
  }

  // 4. Proforma [ПФ] 0000001093 - move 4 recon links to real invoice 2000011433, then archive
  const proforma1093 = await prisma.bizDocument.findFirst({ where: { docNumber: '0000001093', status: { notIn: ['REJECTED', 'ARCHIVED'] } }, select: { id: true, notes: true, amountTotal: true, currency: true } });
  const invoice2000011433 = await prisma.bizDocument.findFirst({ where: { docNumber: '2000011433', status: { notIn: ['REJECTED', 'ARCHIVED'] } }, select: { id: true } });
  if (proforma1093 && invoice2000011433) {
    const moved = await prisma.reconciliationLink.updateMany({ where: { targetDocId: proforma1093.id }, data: { targetDocId: invoice2000011433.id } });
    await prisma.bizDocument.update({ where: { id: invoice2000011433.id }, data: { status: 'MATCHED' } });
    await prisma.bizDocument.update({ where: { id: proforma1093.id }, data: { status: 'ARCHIVED', notes: proforma1093.notes + ' | ARCHIVED: proforma [ПФ], real invoice is 2000011433' } });
    eurSaved += toEur(proforma1093);
    console.log('Archived proforma [ПФ] 0000001093, moved ' + moved.count + ' recon links to 2000011433 (' + Math.round(toEur(proforma1093)) + ' EUR)');
  }

  // 5. Zieta 148 EUR pair - check if 83/ZIETA/2026 (MATCHED) is also a proforma dupe
  const zietaPair = await prisma.bizDocument.findMany({
    where: { docNumber: { in: ['83/ZIETA/2026', '29/EU/01/2026'] }, status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, docNumber: true, status: true, notes: true, amountTotal: true, currency: true }
  });
  console.log('\nZieta 148/1148 EUR remaining:', zietaPair.map(d => d.docNumber + ' ' + d.status + ' ' + Math.round(toEur(d))));

  // Final tally
  const docs26 = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { notIn: ['REJECTED', 'ARCHIVED'] }, amountTotal: { gt: 0 }, docDate: { gte: new Date('2026-01-01'), lte: new Date('2026-12-31') } },
    select: { amountTotal: true, currency: true }
  });
  const total26 = docs26.reduce((s, d) => s + toEur(d), 0);
  const docs25 = await prisma.bizDocument.findMany({
    where: { docType: 'INVOICE_IN', status: { notIn: ['REJECTED', 'ARCHIVED'] }, amountTotal: { gt: 0 }, docDate: { gte: new Date('2025-01-01'), lte: new Date('2025-12-31') } },
    select: { amountTotal: true, currency: true }
  });
  const total25 = docs25.reduce((s, d) => s + toEur(d), 0);

  console.log('\nThis round EUR saved: ~' + Math.round(eurSaved));
  console.log('FINAL 2025 TOTAL:', Math.round(total25), 'EUR /', docs25.length, 'docs');
  console.log('FINAL 2026 TOTAL:', Math.round(total26), 'EUR /', docs26.length, 'docs');
}

main().catch(console.error).finally(() => prisma.$disconnect());
