require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { parseBankStatementBuffer, buildBankPaymentKey } = require('../src/lib/bankStatementParser');
const { getLastIssuedOutgoingInvoiceNo } = require('../src/lib/outgoingInvoicePolicy');

const prisma = new PrismaClient();
const BANK_DIRS = [
  path.resolve(__dirname, '../../bank statements and docs'),
  path.resolve(__dirname, '../../bank statements'),
];

function existingBankDirs() {
  return BANK_DIRS.filter(dir => fs.existsSync(dir));
}

async function table(sql) {
  const rows = await prisma.$queryRawUnsafe(sql);
  console.table(rows);
  return rows;
}

function localBankRows() {
  const rows = [];
  for (const dir of existingBankDirs()) {
    for (const filename of fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.csv')).sort()) {
      const { meta, rows: parsedRows } = parseBankStatementBuffer(fs.readFileSync(path.join(dir, filename)));
      for (const row of parsedRows) {
        rows.push({ filename, key: buildBankPaymentKey(row, meta.iban), row, meta });
      }
    }
  }
  return rows;
}

async function main() {
  const lastIssuedOutgoing = getLastIssuedOutgoingInvoiceNo();
  console.log('=== FINANCIAL DATA AUDIT ===');
  console.log(`Confirmed last issued outgoing invoice: ${lastIssuedOutgoing}`);

  console.log('\nCOUNTS');
  await table(`
    SELECT 'payments' t, COUNT(*)::int c FROM payments
    UNION ALL SELECT 'biz_documents', COUNT(*)::int FROM biz_documents
    UNION ALL SELECT 'source_files', COUNT(*)::int FROM source_files
    UNION ALL SELECT 'documents', COUNT(*)::int FROM documents
    UNION ALL SELECT 'invoices', COUNT(*)::int FROM invoices
    UNION ALL SELECT 'purchases', COUNT(*)::int FROM purchases
    UNION ALL SELECT 'counterparties', COUNT(*)::int FROM counterparties
    UNION ALL SELECT 'reconciliation_links', COUNT(*)::int FROM reconciliation_links
    UNION ALL SELECT 'coverage', COUNT(*)::int FROM coverage
  `);

  console.log('\nPAYMENTS BY YEAR/STATUS/CURRENCY');
  await table(`
    SELECT EXTRACT(YEAR FROM "paymentDate")::int yr, status, currency,
      COUNT(*)::int cnt, ROUND(SUM(amount)::numeric, 2)::text amount
    FROM payments
    GROUP BY 1,2,3
    ORDER BY 1,2,3
  `);

  console.log('\nDUPLICATE PAYMENT ROWS');
  await table(`
    SELECT reference, "paymentDate"::date AS date, amount::text, currency, "bankAccount", COUNT(*)::int cnt
    FROM payments
    WHERE reference IS NOT NULL
    GROUP BY reference, "paymentDate", amount, currency, "bankAccount"
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, date DESC, reference
    LIMIT 30
  `);

  console.log('\nDUPLICATE BIZDOCUMENT KEYS');
  await table(`
    SELECT "docType", "docNumber", currency,
      ROUND(COALESCE("amountTotal", 0)::numeric, 2)::text amount,
      COALESCE("counterpartyId", '') counterparty,
      COUNT(*)::int cnt
    FROM biz_documents
    WHERE "docNumber" IS NOT NULL
    GROUP BY 1,2,3,4,5
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC
    LIMIT 30
  `);

  console.log('\nDATA QUALITY FLAGS');
  await table(`
    SELECT 'invoice_bizdocs_without_number' metric, COUNT(*)::int cnt
      FROM biz_documents WHERE "docType" IN ('INVOICE_IN','INVOICE_OUT') AND "docNumber" IS NULL
    UNION ALL SELECT 'invoice_bizdocs_without_amount', COUNT(*)::int
      FROM biz_documents WHERE "docType" IN ('INVOICE_IN','INVOICE_OUT') AND "amountTotal" IS NULL
    UNION ALL SELECT 'zero_amount_invoice_bizdocs', COUNT(*)::int
      FROM biz_documents WHERE "docType" IN ('INVOICE_IN','INVOICE_OUT') AND COALESCE("amountTotal", 0) = 0
    UNION ALL SELECT 'unresolved_incomplete_invoice_bizdocs', COUNT(*)::int
      FROM biz_documents
      WHERE "docType" IN ('INVOICE_IN','INVOICE_OUT')
        AND status NOT IN ('MATCHED','ARCHIVED','REJECTED')
        AND ("docNumber" IS NULL OR "amountTotal" IS NULL)
    UNION ALL SELECT 'payments_gt100_without_counterparty', COUNT(*)::int
      FROM payments WHERE "counterpartyId" IS NULL AND amount > 100
    UNION ALL SELECT 'source_files_unprocessed', COUNT(*)::int
      FROM source_files WHERE "processedAt" IS NULL
    UNION ALL SELECT 'low_confidence_documents', COUNT(*)::int
      FROM documents WHERE confidence IS NULL OR confidence <= 20
    UNION ALL SELECT 'active_invoice_rows_beyond_last_issued', COUNT(*)::int
      FROM invoices
      WHERE status <> 'CANCELLED'
        AND number ~ '^0*[0-9]+$'
        AND NULLIF(regexp_replace(number, '^0+', ''), '')::int > ${lastIssuedOutgoing}
    UNION ALL SELECT 'active_outgoing_bizdocs_beyond_last_issued', COUNT(*)::int
      FROM biz_documents
      WHERE "docType" = 'INVOICE_OUT'
        AND status <> 'REJECTED'
        AND "docNumber" ~ '^0*[0-9]+$'
        AND NULLIF(regexp_replace("docNumber", '^0+', ''), '')::int > ${lastIssuedOutgoing}
    UNION ALL SELECT 'quarantined_invoice_rows_beyond_last_issued', COUNT(*)::int
      FROM invoices
      WHERE status = 'CANCELLED'
        AND number ~ '^0*[0-9]+$'
        AND NULLIF(regexp_replace(number, '^0+', ''), '')::int > ${lastIssuedOutgoing}
    UNION ALL SELECT 'rejected_outgoing_bizdocs_beyond_last_issued', COUNT(*)::int
      FROM biz_documents
      WHERE "docType" = 'INVOICE_OUT'
        AND status = 'REJECTED'
        AND "docNumber" ~ '^0*[0-9]+$'
        AND NULLIF(regexp_replace("docNumber", '^0+', ''), '')::int > ${lastIssuedOutgoing}
  `);

  console.log('\nCOVERAGE');
  await table(`
    SELECT source, year, path, status, "itemsFound", "itemsDone",
      CASE WHEN "itemsFound" > 0 THEN ROUND(("itemsDone"::numeric / "itemsFound") * 100, 1)::text ELSE '0' END pct
    FROM coverage
    ORDER BY source, year, path
  `);

  const localRows = localBankRows();
  const localKeys = new Set(localRows.map(r => r.key));
  const dbPayments = await prisma.payment.findMany({
    select: { paymentDate: true, reference: true, amount: true, currency: true, bankAccount: true, notes: true },
  });
  const dbKeys = new Set();
  for (const p of dbPayments) {
    const hasDirection = /\[(IN|OUT)\]/.test(p.notes || '');
    const base = { date: p.paymentDate, reference: p.reference, amount: p.amount, currency: p.currency };
    if (hasDirection) dbKeys.add(buildBankPaymentKey({ ...base, isOutgoing: /\[OUT\]/.test(p.notes || '') }, p.bankAccount));
    else {
      dbKeys.add(buildBankPaymentKey({ ...base, isOutgoing: false }, p.bankAccount));
      dbKeys.add(buildBankPaymentKey({ ...base, isOutgoing: true }, p.bankAccount));
    }
  }
  const missingLocal = localRows.filter(r => !dbKeys.has(r.key));
  console.log('\nLOCAL BANK FILE COVERAGE');
  console.table([{
    localRows: localRows.length,
    uniqueLocalKeys: localKeys.size,
    dbPayments: dbPayments.length,
    localRowsMissingInDb: missingLocal.length,
  }]);
  if (missingLocal.length) {
    console.table(missingLocal.slice(0, 20).map(r => ({
      file: r.filename,
      date: r.row.date.toISOString().slice(0, 10),
      reference: r.row.reference,
      amount: r.row.amount,
      currency: r.row.currency,
      direction: r.row.isOutgoing ? 'OUT' : 'IN',
    })));
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
