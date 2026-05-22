const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const BGN = 1.95583;
const toEur = d => d.currency === 'BGN' ? Number(d.amountTotal) / BGN : d.currency === 'USD' ? Number(d.amountTotal) * 0.92 : Number(d.amountTotal);
let totalRejected = 0;
let totalEurSaved = 0;

async function rejectDoc(id, reason) {
  await prisma.reconciliationLink.deleteMany({ where: { OR: [{ sourceDocId: id }, { targetDocId: id }] } });
  await prisma.bizDocument.update({ where: { id }, data: { status: 'REJECTED', notes: 'REJECTED: ' + reason } });
  totalRejected++;
}

async function main() {
  // 1. Omega Light 0010185847 - Purchase dupe of Drive version
  const omegaDups = await prisma.bizDocument.findMany({
    where: { docNumber: '0010185847', status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, status: true, notes: true, amountTotal: true, currency: true }
  });
  if (omegaDups.length > 1) {
    const toReject = omegaDups.find(d => d.status === 'MATCHED' && d.notes && d.notes.includes('Purchase'));
    if (toReject) {
      await rejectDoc(toReject.id, 'Purchase migration duplicate of Drive 0010185847');
      totalEurSaved += toEur(toReject);
      console.log('Rejected Omega Light 0010185847 Purchase dupe (' + Math.round(toEur(toReject)) + ' EUR)');
    }
  }

  // 2. DHL 3000214535
  const dhl1 = await prisma.bizDocument.findMany({
    where: { docNumber: '3000214535', status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, status: true, notes: true, amountTotal: true, currency: true }
  });
  if (dhl1.length > 1) {
    const toReject = dhl1.find(d => d.notes && d.notes.includes('Purchase'));
    if (toReject) {
      await rejectDoc(toReject.id, 'Purchase migration duplicate of Drive 3000214535');
      totalEurSaved += toEur(toReject);
      console.log('Rejected DHL 3000214535 Purchase dupe (' + Math.round(toEur(toReject)) + ' EUR)');
    }
  }

  // 3. DHL 3000216669
  const dhl2 = await prisma.bizDocument.findMany({
    where: { docNumber: '3000216669', status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, status: true, notes: true, amountTotal: true, currency: true }
  });
  if (dhl2.length > 1) {
    const toReject = dhl2.find(d => d.notes && d.notes.includes('Purchase')) || dhl2[1];
    await rejectDoc(toReject.id, 'duplicate DHL invoice 3000216669');
    totalEurSaved += toEur(toReject);
    console.log('Rejected DHL 3000216669 dupe (' + Math.round(toEur(toReject)) + ' EUR)');
  }

  // 4. Rent 700 EUR - reject Purchase dupes, keep Drive/REVIEWED versions
  for (const docNum of ['0000000354', '0000000363', '0000000347']) {
    const rentDups = await prisma.bizDocument.findMany({
      where: { docNumber: docNum, status: { notIn: ['REJECTED', 'ARCHIVED'] } },
      select: { id: true, status: true, notes: true, amountTotal: true, currency: true }
    });
    if (rentDups.length > 1) {
      const toReject = rentDups.find(d => d.notes && d.notes.includes('Purchase'));
      if (toReject) {
        await rejectDoc(toReject.id, 'Purchase migration duplicate of Drive rent invoice ' + docNum);
        totalEurSaved += toEur(toReject);
        console.log('Rejected rent Purchase dupe ' + docNum + ' (~' + Math.round(toEur(toReject)) + ' EUR)');
      }
    }
  }

  // 5. EBE8D25B monthly subscription - reject Purchase dupes
  for (const suffix of ['0016', '0017', '0018']) {
    const ebeDups = await prisma.bizDocument.findMany({
      where: { docNumber: { contains: suffix }, amountTotal: { gte: 17, lte: 19 }, status: { notIn: ['REJECTED', 'ARCHIVED'] } },
      select: { id: true, docNumber: true, status: true, notes: true, amountTotal: true, currency: true }
    });
    if (ebeDups.length > 1) {
      const toReject = ebeDups.find(d => d.notes && d.notes.includes('Purchase'));
      if (toReject) {
        await rejectDoc(toReject.id, 'Purchase migration duplicate of Drive EBE8D25B-' + suffix);
        totalEurSaved += toEur(toReject);
        console.log('Rejected EBE8D25B ' + suffix + ' Purchase dupe (~' + Math.round(toEur(toReject)) + ' EUR)');
      }
    }
  }

  // 6. DHL customs 9185092361 waybill pair
  const dhlWb1 = await prisma.bizDocument.findMany({
    where: { status: { notIn: ['REJECTED', 'ARCHIVED'] }, notes: { contains: '9185092361' }, amountTotal: { gte: 1700, lte: 1800 } },
    select: { id: true, docNumber: true, notes: true, amountTotal: true, currency: true }
  });
  console.log('DHL 9185092361 docs (' + dhlWb1.length + '):', dhlWb1.map(d => d.docNumber));
  if (dhlWb1.length > 1) {
    const toReject = dhlWb1.find(d => d.docNumber === '9185092361') || dhlWb1[1];
    await rejectDoc(toReject.id, 'duplicate customs payment same waybill 9185092361');
    totalEurSaved += toEur(toReject);
    console.log('Rejected DHL customs dupe 9185092361 (' + Math.round(toEur(toReject)) + ' EUR)');
  }

  // 7. DHL customs 9187470891 waybill pair
  const dhlWb2 = await prisma.bizDocument.findMany({
    where: { status: { notIn: ['REJECTED', 'ARCHIVED'] }, notes: { contains: '9187470891' }, amountTotal: { gte: 440, lte: 470 } },
    select: { id: true, docNumber: true, notes: true, amountTotal: true, currency: true }
  });
  console.log('DHL 9187470891 docs (' + dhlWb2.length + '):', dhlWb2.map(d => d.docNumber));
  if (dhlWb2.length > 1) {
    const toReject = dhlWb2.find(d => d.docNumber === '9187470891') || dhlWb2[1];
    await rejectDoc(toReject.id, 'duplicate customs payment same waybill 9187470891');
    totalEurSaved += toEur(toReject);
    console.log('Rejected DHL customs dupe 9187470891 (' + Math.round(toEur(toReject)) + ' EUR)');
  }

  // 8. Zieta proforma 83/ZIETA/2026
  const zietaPro = await prisma.bizDocument.findMany({
    where: { docNumber: '83/ZIETA/2026', status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, notes: true, amountTotal: true, currency: true }
  });
  for (const doc of zietaPro) {
    const notesLower = (doc.notes || '').toLowerCase();
    if (notesLower.includes('pro_forma') || notesLower.includes('proforma')) {
      await prisma.bizDocument.update({ where: { id: doc.id }, data: { status: 'ARCHIVED', notes: doc.notes + ' | ARCHIVED: proforma' } });
      totalEurSaved += toEur(doc);
      console.log('Archived Zieta proforma 83/ZIETA/2026 (' + Math.round(toEur(doc)) + ' EUR)');
    }
  }

  // 9. BO 002913 order confirmation email
  const bo002913 = await prisma.bizDocument.findFirst({
    where: { docNumber: 'BO 002913', status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, notes: true, amountTotal: true, currency: true }
  });
  if (bo002913) {
    await prisma.bizDocument.update({ where: { id: bo002913.id }, data: { status: 'ARCHIVED', notes: bo002913.notes + ' | ARCHIVED: order confirmation, invoice is 2228' } });
    totalEurSaved += toEur(bo002913);
    console.log('Archived BO 002913 (' + Math.round(toEur(bo002913)) + ' EUR)');
  }

  // 10. 002913 order PDF - reject, 2228 is the real invoice
  const doc002913 = await prisma.bizDocument.findFirst({
    where: { docNumber: '002913', status: { notIn: ['REJECTED', 'ARCHIVED'] } },
    select: { id: true, notes: true, amountTotal: true, currency: true }
  });
  if (doc002913) {
    await rejectDoc(doc002913.id, 'order PDF (Pokupka), real invoice is INV-2228');
    totalEurSaved += toEur(doc002913);
    console.log('Rejected 002913 order PDF (' + Math.round(toEur(doc002913)) + ' EUR)');
  }

  console.log('\nTotal rejected/archived: ' + totalRejected + ' | EUR saved: ~' + Math.round(totalEurSaved));
}

main().catch(console.error).finally(() => prisma.$disconnect());
