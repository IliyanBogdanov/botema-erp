/**
 * Bank statement CSV parser for Texim Bank (and similar BG banks).
 * Format: CP1251 encoding, semicolon-delimited, 5 metadata header rows,
 * then column header row, then data rows.
 *
 * Columns: Дата;Вальор;Референция;Основание;Наредител/Получател;
 *          Сметка (IBAN);ЕГН/БУЛСТАТ;Баланс преди;Дебит;Кредит;Баланс
 */

const iconv = require('iconv-lite');

/**
 * Parse a BG number string like "8 478,37" or "1.395,80" to float.
 */
function parseBGNumber(str) {
  if (!str || str.trim() === '') return 0;
  // Remove spaces, replace comma with dot, remove thousand dots
  const cleaned = str.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/**
 * Parse a BG date string "DD.MM.YYYY" to Date object.
 */
function parseBGDate(str) {
  if (!str || str.trim() === '') return null;
  const [day, month, year] = str.trim().split('.');
  if (!day || !month || !year) return null;
  return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00.000Z`);
}

/**
 * Detect if a reference is a fee/commission row.
 * Fee rows have a timestamp appended: "TEXNSCT7-0000107441.10 09:46:57"
 */
function isFeeRow(reference) {
  return /\d{2}:\d{2}:\d{2}$/.test(reference.trim());
}

/**
 * Detect if a reference is a POS/card transaction.
 */
function isCardTransaction(reference) {
  return /^(VIOCVI|VIOSDI|POS)/i.test(reference.trim());
}

/**
 * Parse the account metadata from header rows (first 4 lines).
 * Line 0 format: "Сметка";"BG80TEXI95451008505000 EUR"
 * Returns: { iban, currency }
 */
function parseAccountHeader(lines) {
  // First line after splitting: "Сметка";"BG80TEXI95451008505000 EUR"
  const accountLine = lines[0] || '';
  const parts = accountLine.split(';').map(p => p.replace(/"/g, '').trim());
  const accountField = parts[1] || '';

  // Extract IBAN (starts with BG and is 22 chars, or just extract before space)
  const ibanMatch = accountField.match(/BG\w+/);
  const iban = ibanMatch ? ibanMatch[0] : null;

  let currency = 'BGN';
  if (accountField.includes('EUR')) currency = 'EUR';
  else if (accountField.includes('USD')) currency = 'USD';
  else if (accountField.includes('BGN')) currency = 'BGN';

  return { iban, currency };
}

/**
 * Parse a raw CSV buffer (CP1251) into an array of normalized payment objects.
 *
 * @param {Buffer} buffer - Raw file buffer
 * @returns {{ meta: { iban, currency }, rows: ParsedRow[] }}
 */
function parseBankStatementBuffer(buffer) {
  const text = iconv.decode(buffer, 'win1251');
  // Bank CSVs use \r as line separator (not \r\n or \n)
  const rawLines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);

  // First 4-5 lines are metadata (account, date range, etc.)
  // Find the header row (contains "Дата" or "Date")
  let headerIdx = rawLines.findIndex(l => /"?Дата"?/.test(l) || /"?Date"?/i.test(l));
  if (headerIdx === -1) headerIdx = 4; // fallback

  const metaLines = rawLines.slice(0, headerIdx);
  const dataLines = rawLines.slice(headerIdx + 1); // skip header row

  const { iban, currency } = parseAccountHeader(metaLines);

  const rows = [];

  for (const line of dataLines) {
    if (!line || line.length < 5) continue;

    // Split by ; but respect quoted fields
    const fields = line.split(';').map(f => f.replace(/^"|"$/g, '').trim());

    if (fields.length < 8) continue;

    const [
      dateStr,
      valueDateStr,
      reference,
      description,
      counterpartyName,
      counterpartyIban,
      counterpartyBulstat,
      balanceBefore,
      debit,
      credit,
      balance,
    ] = fields;

    const date = parseBGDate(dateStr);
    if (!date) continue; // skip non-data rows

    const debitAmt = parseBGNumber(debit);
    const creditAmt = parseBGNumber(credit);

    // Determine payment type
    let paymentType = 'BANK_TRANSFER';
    if (isFeeRow(reference)) {
      paymentType = 'OTHER'; // fee/commission
    } else if (isCardTransaction(reference)) {
      paymentType = 'CARD';
    }

    // Direction: debit = outgoing (we paid), credit = incoming (we received)
    const amount = debitAmt > 0 ? -debitAmt : creditAmt; // negative = outgoing
    const absAmount = Math.max(debitAmt, creditAmt);

    rows.push({
      date,
      valueDate: parseBGDate(valueDateStr) || date,
      reference: reference.trim(),
      description: description.trim(),
      counterpartyName: counterpartyName.trim() || null,
      counterpartyIban: counterpartyIban.trim() || null,
      counterpartyBulstat: counterpartyBulstat.trim() || null,
      balanceBefore: parseBGNumber(balanceBefore),
      debit: debitAmt,
      credit: creditAmt,
      balance: parseBGNumber(balance),
      amount: absAmount,
      isOutgoing: debitAmt > 0,
      paymentType,
      isFee: paymentType === 'OTHER',
      currency,
      bankAccountIban: iban,
    });
  }

  return { meta: { iban, currency }, rows };
}

module.exports = { parseBankStatementBuffer, parseBGNumber, parseBGDate };
