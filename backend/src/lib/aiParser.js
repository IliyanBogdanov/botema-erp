/**
 * Document parser — AI-powered with smart heuristic fallback
 * Handles Bulgarian folder names, extracts supplier/date/invoice from filename+folder
 * AI chain (free-only): Groq llama-3.3-70b → OpenRouter gpt-oss-20b:free → heuristic
 */
const { google } = require('googleapis');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const { createLogger } = require('./logger');
const { isMineruEnabled, runMineru } = require('./mineru');

const log = createLogger('aiParser');

const getAuth = () => {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
};

const groq = process.env.GROQ_API_KEY ? new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
}) : null;

const openrouter = process.env.OPENROUTER_API_KEY ? new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
}) : null;

const openai = process.env.OPENAI_API_KEY ? new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Bulgarian month names → month number
const BG_MONTHS = {
  'януари': '01', 'февруари': '02', 'март': '03', 'април': '04',
  'май': '05', 'юни': '06', 'юли': '07', 'август': '08',
  'септември': '09', 'октомври': '10', 'ноември': '11', 'декември': '12',
};

// Supplier keyword map — both English and Bulgarian transliterations
const SUPPLIER_KEYWORDS = [
  { keys: ['lodes', 'лодес'], id: 'sup-lodes' },
  {
    keys: ['alphaluce', 'алфалуче', 'alphace',
      'митническа декларация', 'customs declaration',
      'митница', 'china import', 'chinese'], id: 'sup-alpha'
  },
  { keys: ['polaris', 'поларис'], id: 'sup-pol' },
  { keys: ['novaluce', 'новалуче'], id: 'sup-nov' },
  { keys: ['aca lighting', 'aca', 'ака'], id: 'sup-aca' },
  { keys: ['ambientec', 'амбиентек'], id: 'sup-amb' },
  { keys: ['antrax', 'антракс'], id: 'sup-ant' },
  { keys: ['sedap', 'ателие седап', 'atelier sedap'], id: 'sup-sed' },
  { keys: ['braga', 'брага', 'fratelli braga'], id: 'sup-bra' },
  { keys: ['formani', 'формани'], id: 'sup-form' },
  { keys: ['karimoku', 'каримоку'], id: 'sup-kari' },
  { keys: ['kraab', 'краб', 'кра аб'], id: 'sup-kra' },
  { keys: ['sovet', 'совет итали'], id: 'sup-sov' },
  { keys: ['dhl'], id: 'sup-dhl' },
  { keys: ['omega light', 'омега лайт', 'omega'], id: 'sup-omega' },
  { keys: ['speedy', 'спиди'], id: 'sup-speedy' },
  { keys: ['zieta', 'зиета'], id: 'sup-zieta' },
  { keys: ['macro', 'макро'], id: 'sup-macro' },
  { keys: ['chatgpt', 'чатгпт', 'чат гпт', 'openai'], id: 'sup-openai' },
  { keys: ['microinvest', 'микроинвест'], id: 'sup-micro' },
  { keys: ['зира дизайн', 'zira design'], id: 'sup-zira' },
  { keys: ['sunfoods', 'сънфуудс', 'сън фудс'], id: 'sup-sunf' },
  { keys: ['ambicio', 'амбицио'], id: 'sup-ambic' },
  { keys: ['alfa light', 'алфа лайт'], id: 'sup-alfal' },
  { keys: ['ват ', 'watt ', 'ватт'], id: 'sup-watt' },
  { keys: ['румен романов', 'rumen romanov'], id: 'sup-rrom' },
  { keys: ['наем', 'rent', 'шоурум', 'showroom'], id: 'sup-rent' },
  { keys: ['счетоводн', 'accounting', 'accountancy'], id: 'sup-acct' },
  // 2024/2025 suppliers
  { keys: ['bonaldo', 'боналдо'], id: 'sup-bonaldo' },
  { keys: ['топ диджитал', 'top digital', 'топдиджитал'], id: 'sup-topdig' },
  { keys: ['facebook', 'фейсбук', 'meta ads', 'meta/fac'], id: 'sup-fb' },
  { keys: ['google ads', 'гугъл', 'google платеж'], id: 'sup-google' },
  { keys: ['superhosting', 'супърхостинг'], id: 'sup-sh' },
  { keys: ['nest studio', 'нест студио', 'nest '], id: 'sup-nest' },
  { keys: ['rashev', 'рашев', 'ultralight'], id: 'sup-rashev' },
  { keys: ['econt', 'еконт'], id: 'sup-econt' },
  { keys: ['exenza', 'ексенза'], id: 'sup-exenza' },
  { keys: ['fercam', 'феркам'], id: 'sup-fercam' },
  { keys: ['siltem', 'силтем'], id: 'sup-siltem' },
  { keys: ['tridonic', 'тридоник'], id: 'sup-tridonic' },
  { keys: ['sielte', 'сиелте'], id: 'sup-sielte' },
];

// Folders that indicate OUTGOING documents — skip these
const OUTGOING_KEYWORDS = [
  'изходящи фактури', 'изходящи', 'outgoing',
  'оферти', 'оферта',   // outgoing offers
  'проформа', 'проформи', // proformas are mixed — could be in or out
];

function isOutgoingFolder(folder) {
  const lower = folder.toLowerCase();
  return OUTGOING_KEYWORDS.some(kw => lower.includes(kw));
}

function guessSupplierFromPath(folder, filename) {
  const text = (folder + '/' + filename).toLowerCase();
  for (const { keys, id } of SUPPLIER_KEYWORDS) {
    for (const key of keys) {
      if (text.includes(key)) return id;
    }
  }
  return null;
}

function guessFolderType(folder) {
  const lower = folder.toLowerCase();
  if (lower.includes('purchase') || lower.includes('входящи')) return 'PURCHASE';
  if (lower.includes('import')) return 'IMPORT';
  if (lower.includes('delivery') || lower.includes('доставки')) return 'DELIVERY';
  if (lower.includes('outgoing') || lower.includes('изходящи')) return 'INVOICE_OUT';
  if (lower.includes('offer') || lower.includes('оферт')) return 'OFFER';
  if (lower.includes('protocol') || lower.includes('протокол')) return 'PROTOCOL';
  // Bulgarian incoming invoice patterns
  if (lower.includes('фактур') || lower.includes('поръчка')) return 'PURCHASE';
  return 'OTHER';
}

function extractDateFromPath(folder, filename) {
  const text = (folder + ' ' + filename).toLowerCase();

  // ISO date in filename: 2026-04-15
  const isoMatch = text.match(/\b(20\d{2})[_\-. /](\d{1,2})[_\-. /](\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // Date in filename: 15.04.2026 or 03.04.2026
  const dmyMatch = text.match(/\b(\d{1,2})[._](\d{1,2})[._](20\d{2})\b/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  // Bulgarian month name in folder path
  const year = (folder.match(/\b(20\d{2})\b/) || [])[1] || new Date().getFullYear().toString();
  for (const [bg, mm] of Object.entries(BG_MONTHS)) {
    if (text.includes(bg)) return `${year}-${mm}-01`;
  }

  // Fallback: just year
  return `${year}-01-01`;
}

function extractInvoiceNo(filename) {
  const name = filename.replace(/\.[^.]+$/, '');

  // Pattern: Invoice-2604608 or Invoice-2604608-Lodes or Фактура №12345
  const invMatch = name.match(/(?:invoice|фактура|faktura|inv|no|nr|№)[_\-\s#.]+([A-Z0-9]{3,})/i);
  if (invMatch) return invMatch[1];

  // Pattern: alphanumeric like AP202602090005 or INV-2024-001
  const alphaMatch = name.match(/\b([A-Z]{1,4}[-_]?\d{4,})\b/i);
  if (alphaMatch) return alphaMatch[1];

  // Pattern: pure number sequences — lowered from 6 to 4 digits to catch Bulgarian short invoice numbers
  const numMatch = name.match(/\b(\d{4,})\b/);
  if (numMatch) return numMatch[1];

  return null;
}

function parseFromFilename(filename, folder) {
  log.warn('Using filename heuristic (no AI available)', { filename, folder });
  const docDate = extractDateFromPath(folder, filename);
  const invoiceNo = extractInvoiceNo(filename);
  const name = filename.replace(/\.[^.]+$/, '');
  const docType = guessFolderType(folder) === 'INVOICE_OUT' ? 'INVOICE_OUT'
    : guessFolderType(folder) === 'DELIVERY' ? 'DELIVERY_NOTE'
      : guessFolderType(folder) === 'OFFER' ? 'OFFER'
        : 'INVOICE_IN';

  // Guess currency from supplier/folder — Bulgarian suppliers use BGN, international use EUR
  const text = (folder + '/' + filename).toLowerCase();
  const bgSuppliers = ['поларис', 'polaris', 'omegalight', 'omega light', 'омега', 'watt', 'ватт', 'буливест', 'bulinvest', 'силтем', 'siltem', 'econt', 'еконт'];
  const currency = bgSuppliers.some(s => text.includes(s)) ? 'BGN' : 'EUR';

  return {
    docType,
    invoiceNo,
    docDate,
    currency,
    amountNet: null,
    vatAmount: null,
    amountTotal: null,
    description: name,
    supplierName: null,
    confidence: 15, // heuristic confidence
  };
}

async function downloadDriveFile(fileId) {
  const drive = google.drive({ version: 'v3', auth: getAuth() });
  const chunks = [];

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    res.data.on('data', chunk => chunks.push(chunk));
    res.data.on('end', () => resolve(Buffer.concat(chunks)));
    res.data.on('error', reject);
  });
}

async function parseDocumentWithGroq(filename, folder, pdfBuffer) {
  if (!groq) throw new Error('GROQ_API_KEY is not configured');

  log.info('Trying Groq llama-3.3-70b', { filename });
  const t0 = Date.now();

  const folderType = guessFolderType(folder);
  const pdfData = await pdfParse(pdfBuffer);
  const text = pdfData.text.substring(0, 6000); // keep within token limit

  const prompt = `You are an expert accountant parsing business documents for Studio Botema (VAT BG204971854) and Luminavera — Bulgarian interior design companies importing from Italy, Netherlands, Poland, Austria, Germany, and local Bulgarian suppliers.

File: "${filename}"
Folder: "${folder}"
Document type hint: ${folderType}

CRITICAL RULES:
1. amountTotal = FINAL TOTAL DUE. Look for: "Total", "Totale", "Gesamtbetrag", "ОБЩО", "Amount due", "Da pagare"
   - European format: "1.234,56" = 1234.56. US format: "1,234.56" = 1234.56
   - NEVER return 0 if numeric values exist — pick the largest plausible total
2. currency: € or EUR→EUR, лв. or BGN→BGN. Italian/Dutch/Polish/German suppliers→EUR. Bulgarian suppliers→BGN
3. invoiceNo: look for "Фактура №", "Invoice No.", "Fattura n.", "Rechnung Nr."
4. docDate: "Date:", "Дата:", "Data:", "Datum:" → YYYY-MM-DD
5. supplierName: the SELLER (not Studio Botema/Luminavera)
6. confidence: 90-100 if all 4 (invoiceNo,docDate,amountTotal,currency) found; 60-89 if 3; 30-59 if 2; 0-29 if <2

Document text:
${text}

Return ONLY valid JSON (no markdown):
{
  "docType": "INVOICE_IN" | "INVOICE_OUT" | "PROFORMA" | "DELIVERY_NOTE" | "OFFER" | "OTHER",
  "invoiceNo": string | null,
  "docDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": "EUR" | "BGN" | "USD" | null,
  "amountNet": number | null,
  "vatAmount": number | null,
  "amountTotal": number | null,
  "description": string | null,
  "supplierName": string | null,
  "supplierVat": string | null,
  "confidence": number
}`;

  const chat = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });

  const content = chat.choices[0].message.content.trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in Groq response: ' + content.substring(0, 200));
  const result = JSON.parse(jsonMatch[0]);
  log.info('Groq parse success', { filename, docType: result.docType, confidence: result.confidence, ms: Date.now() - t0 });
  return result;
}

async function parseDocumentWithOpenRouter(filename, folder, pdfBuffer) {
  if (!openrouter) throw new Error('OPENROUTER_API_KEY is not configured');

  log.info('Trying OpenRouter gpt-oss-20b', { filename });
  const t0 = Date.now();
  const folderType = guessFolderType(folder);
  const pdfData = await pdfParse(pdfBuffer);
  const text = pdfData.text.substring(0, 6000);

  const prompt = `You are an expert accountant parsing business documents for Studio Botema (VAT BG204971854) and Luminavera — Bulgarian interior design companies importing from Italy, Netherlands, Poland, Austria, Germany, and local Bulgarian suppliers.

File: "${filename}"
Folder: "${folder}"
Document type hint: ${folderType}

CRITICAL RULES:
1. amountTotal = FINAL TOTAL DUE. Look for: "Total", "Totale", "Gesamtbetrag", "ОБЩО", "Amount due", "Da pagare"
   - European format: "1.234,56" = 1234.56. US format: "1,234.56" = 1234.56
   - NEVER return 0 if numeric values exist — pick the largest plausible total
2. currency: € or EUR→EUR, лв. or BGN→BGN. Italian/Dutch/Polish/German suppliers→EUR. Bulgarian suppliers→BGN
3. invoiceNo: look for "Фактура №", "Invoice No.", "Fattura n.", "Rechnung Nr."
4. docDate: "Date:", "Дата:", "Data:", "Datum:" → YYYY-MM-DD
5. supplierName: the SELLER (not Studio Botema/Luminavera)
6. confidence: 90-100 if all 4 (invoiceNo,docDate,amountTotal,currency) found; 60-89 if 3; 30-59 if 2; 0-29 if <2

Document text:
${text}

Return ONLY valid JSON (no markdown):
{
  "docType": "INVOICE_IN" | "INVOICE_OUT" | "PROFORMA" | "DELIVERY_NOTE" | "OFFER" | "OTHER",
  "invoiceNo": string | null,
  "docDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": "EUR" | "BGN" | "USD" | null,
  "amountNet": number | null,
  "vatAmount": number | null,
  "amountTotal": number | null,
  "description": string | null,
  "supplierName": string | null,
  "supplierVat": string | null,
  "confidence": number
}`;

  const chat2 = await openrouter.chat.completions.create({
    model: 'openai/gpt-oss-20b:free',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });

  const content2 = chat2.choices[0].message.content.trim();
  const jsonMatch2 = content2.match(/\{[\s\S]*\}/);
  if (!jsonMatch2) throw new Error('No JSON in OpenRouter response: ' + content2.substring(0, 200));
  const result2 = JSON.parse(jsonMatch2[0]);
  log.info('OpenRouter parse success', { filename, docType: result2.docType, confidence: result2.confidence, ms: Date.now() - t0 });
  return result2;
}

async function parseDocumentWithOpenAI(filename, folder, pdfBuffer) {
  if (!openai) throw new Error('OPENAI_API_KEY is not configured');

  log.info('Trying OpenAI gpt-4o-mini', { filename });
  const t0 = Date.now();
  const folderType = guessFolderType(folder);
  const pdfData = await pdfParse(pdfBuffer);
  const text = pdfData.text.substring(0, 12000);

  const prompt = `You are an expert accountant parsing business documents for Studio Botema (VAT BG204971854) and Luminavera — Bulgarian interior design companies importing from Italy, Netherlands, Poland, Austria, Germany, and local Bulgarian suppliers.

File: "${filename}"
Folder: "${folder}"
Document type hint: ${folderType}

CRITICAL RULES:
1. amountTotal = FINAL TOTAL DUE. Look for: "Total", "Totale", "Gesamtbetrag", "ОБЩО", "Amount due", "Da pagare"
   - European format: "1.234,56" = 1234.56. US format: "1,234.56" = 1234.56
   - NEVER return 0 if numeric values exist — pick the largest plausible total
2. currency: € or EUR→EUR, лв. or BGN→BGN. Italian/Dutch/Polish/German suppliers→EUR. Bulgarian suppliers→BGN
3. invoiceNo: look for "Фактура №", "Invoice No.", "Fattura n.", "Rechnung Nr."
4. docDate: "Date:", "Дата:", "Data:", "Datum:" → YYYY-MM-DD
5. supplierName: the SELLER (not Studio Botema/Luminavera)
6. confidence: 90-100 if all 4 (invoiceNo,docDate,amountTotal,currency) found; 60-89 if 3; 30-59 if 2; 0-29 if <2

Document text:
${text}

Return ONLY valid JSON (no markdown):
{
  "docType": "INVOICE_IN" | "INVOICE_OUT" | "PROFORMA" | "DELIVERY_NOTE" | "OFFER" | "OTHER",
  "invoiceNo": string | null,
  "docDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": "EUR" | "BGN" | "USD" | null,
  "amountNet": number | null,
  "vatAmount": number | null,
  "amountTotal": number | null,
  "description": string | null,
  "supplierName": string | null,
  "supplierVat": string | null,
  "confidence": number
}`;

  const chat = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });

  const content = chat.choices[0].message.content.trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in OpenAI response: ' + content.substring(0, 200));
  const resultOai = JSON.parse(jsonMatch[0]);
  log.info('OpenAI parse success', { filename, docType: resultOai.docType, confidence: resultOai.confidence, ms: Date.now() - t0 });
  return resultOai;
}

function inferMimeType(filename, fallback = 'application/pdf') {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
}

function parseJsonFromAIText(text, label = 'AI') {
  const cleaned = String(text || '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON in ${label} response: ` + cleaned.substring(0, 200));
  return JSON.parse(jsonMatch[0]);
}

function parseEuropeanNumber(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma > dot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (dot > comma) {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const text = String(raw);
  let m = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function inferCurrencyFromText(text, fallback = null) {
  if (/\bEUR\b|€/i.test(text)) return 'EUR';
  if (/\bBGN\b|лв\.?|лева/i.test(text)) return 'BGN';
  if (/\bUSD\b|\$/i.test(text)) return 'USD';
  if (/\bGBP\b|£/i.test(text)) return 'GBP';
  return fallback;
}

function inferDocTypeFromText(text, folder) {
  const lower = `${folder || ''}\n${text || ''}`.toLowerCase();
  if (/proforma|проформа/.test(lower)) return 'PROFORMA';
  if (/offer|оферта/.test(lower)) return 'OFFER';
  if (/delivery note|стокова|delivery|packing list|товарителница/.test(lower)) return 'DELIVERY_NOTE';
  if (/изходящи|invoice-\d+-for-operation-sale|студио ботема еоод\s+фактура/i.test(lower)) return 'INVOICE_OUT';
  if (/invoice|фактура|fattura|rechnung/.test(lower)) return 'INVOICE_IN';
  return 'OTHER';
}

function extractLikelyTotal(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const labelled = [];
  const all = [];
  const amountRe = /(?:€|\bEUR\b|\bBGN\b|\bUSD\b|лв\.?)?\s*(-?\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{2,4})|-?\d+(?:[,.]\d{2,4}))(?:\s*(?:€|\bEUR\b|\bBGN\b|\bUSD\b|лв\.?))?/gi;

  for (const line of lines) {
    const isTotalLine = /total|totale|gesamt|общо|сума|amount due|due|grand total|за плащане/i.test(line);
    let match;
    while ((match = amountRe.exec(line))) {
      const value = parseEuropeanNumber(match[1]);
      if (value == null || value <= 0) continue;
      all.push(value);
      if (isTotalLine) labelled.push(value);
    }
  }

  const pool = labelled.length ? labelled : all;
  if (!pool.length) return null;
  return Math.max(...pool);
}

function parseStructuredFromMineruText(filename, folder, text) {
  const body = String(text || '');
  const docType = inferDocTypeFromText(body, folder);
  const currency = inferCurrencyFromText(body, parseFromFilename(filename, folder).currency);
  const amountTotal = extractLikelyTotal(body);
  const invoiceNo = (
    body.match(/(?:invoice|фактура|faktura|fattura|rechnung|no\.?|№|number|номер)\s*[:#№-]?\s*([A-ZА-Я0-9][A-ZА-Я0-9./_-]{2,})/i)?.[1]
    || extractInvoiceNo(filename)
    || null
  );
  const docDate = normalizeDate(
    body.match(/(?:date|дата|data|datum|invoice date)\s*[:.-]?\s*(\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/i)?.[1]
    || body.match(/\b(\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\b/)?.[1]
  );

  const found = [invoiceNo, docDate, amountTotal, currency].filter(Boolean).length;
  return {
    docType,
    invoiceNo,
    docDate,
    dueDate: null,
    currency,
    amountNet: null,
    vatAmount: null,
    amountTotal,
    description: filename,
    supplierName: null,
    supplierVat: null,
    confidence: found >= 4 ? 80 : found === 3 ? 65 : found === 2 ? 45 : 20,
    extractionProvider: 'mineru+heuristic',
  };
}

async function extractJsonFromTextPrompt(prompt, label = 'text extraction') {
  const providers = [];

  if (groq && process.env.DISABLE_GROQ_EXTRACTION !== 'true') {
    providers.push({
      name: 'groq',
      run: async () => {
        const chat = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        });
        return chat.choices[0].message.content;
      },
    });
  }

  if (openrouter && process.env.DISABLE_OPENROUTER_EXTRACTION !== 'true') {
    providers.push({
      name: 'openrouter',
      run: async () => {
        const chat = await openrouter.chat.completions.create({
          model: 'openai/gpt-oss-20b:free',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        });
        return chat.choices[0].message.content;
      },
    });
  }

  // OpenAI (paid) intentionally excluded — free providers only.

  let lastErr;
  for (const provider of providers) {
    try {
      const text = await provider.run();
      const parsed = parseJsonFromAIText(text, `${label}/${provider.name}`);
      return { parsed, provider: provider.name };
    } catch (err) {
      lastErr = err;
      console.warn(`[${label}] ${provider.name} failed: ${err.message?.slice(0, 160)}`);
    }
  }
  throw lastErr || new Error(`No configured provider for ${label}`);
}

async function parseDocumentWithAI(filename, folder, pdfBuffer) {
  const folderType = guessFolderType(folder);
  const mimeType = inferMimeType(filename);
  const t0 = Date.now();
  const mineruOnly = process.env.MINERU_ONLY === 'true';

  log.info('Starting document parse', { filename, folder, mimeType, folderType });

  const prompt = `You are an expert accountant parsing business documents for Studio Botema (VAT BG204971854) and Luminavera — Bulgarian interior design companies that import lighting and furniture from Italy, Netherlands, Poland, Austria, Germany, and local Bulgarian suppliers.

File: "${filename}"
Folder: "${folder}"
Document type hint: ${folderType}

CRITICAL EXTRACTION RULES:
1. amountTotal = the FINAL TOTAL DUE (largest amount at the bottom). Look for: "Total", "Totale", "Gesamtbetrag", "ОБЩО", "Общо за плащане", "Amount due", "Da pagare"
   - European number format: "1.234,56" means 1234.56 (period=thousands separator, comma=decimal)
   - US/UK format: "1,234.56" means 1234.56
   - NEVER return 0 if numeric values are visible in the document — pick the largest plausible total
2. currency: look for €, EUR, лв., BGN, $, USD symbols
   - Italian/Dutch/Polish/German suppliers → EUR
   - Bulgarian suppliers (Polaris, Omega Light, Siltem, Bulinvest, Econt) → BGN
3. invoiceNo: look for "Фактура №", "Invoice No.", "Invoice #", "Fattura n.", "Rechnung Nr.", document number in the header
4. docDate: look for "Date:", "Дата:", "Data:", "Datum:", "Invoice date:" → format as YYYY-MM-DD
5. supplierName: the company ISSUING this document (the seller). It is NOT Studio Botema or Luminavera.
   Known suppliers: Lodes, Polaris, Exenza Studio, Formani, Zieta, Omega Light, DHL, Fercam, Tridonic, Sielte, Bulinvest, Microinvest, Siltem, ACA Lighting, Novaluce, Bonaldo, Macro
6. confidence scoring:
   - 90-100: all 4 key fields clearly found (invoiceNo, docDate, amountTotal, currency)
   - 60-89: 3 of the 4 key fields found
   - 30-59: 2 of the 4 key fields found
   - 0-29: fewer than 2 fields found, or document is not a financial document

Return ONLY valid JSON (no markdown, no explanation):
{
  "docType": "INVOICE_IN" | "INVOICE_OUT" | "PROFORMA" | "DELIVERY_NOTE" | "OFFER" | "OTHER",
  "invoiceNo": string | null,
  "docDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": "EUR" | "BGN" | "USD" | null,
  "amountNet": number | null,
  "vatAmount": number | null,
  "amountTotal": number | null,
  "description": string | null,
  "supplierName": string | null,
  "supplierVat": string | null,
  "confidence": number
}`;

  if (isMineruEnabled()) {
    try {
      const mineru = await runMineru({ filename, buffer: pdfBuffer });
      if (mineru.text) {
        const withMineruMeta = (parsed) => ({
          ...parsed,
          mineru: {
            durationMs: mineru.durationMs,
            digest: mineru.digest,
            files: mineru.files,
          },
        });

        try {
          const { parsed, provider } = await extractJsonFromTextPrompt(`${prompt}

MinerU extracted document content:
${mineru.text.substring(0, 24000)}

Return ONLY the structured JSON requested above.`, 'MinerU');
          return withMineruMeta({
            ...parsed,
            extractionProvider: `mineru+${provider}`,
          });
        } catch (err) {
          if (!String(err.message || '').includes('No configured provider')) {
            console.warn(`[MinerU] AI extraction failed for ${filename}: ${err.message?.slice(0, 200)}`);
          }
          const parsed = parseStructuredFromMineruText(filename, folder, mineru.text);
          if (mineruOnly || parsed.amountTotal || parsed.invoiceNo || parsed.docDate) {
            return withMineruMeta(parsed);
          }
        }
      }
    } catch (err) {
      console.warn(`[MinerU] ${filename}: ${err.message?.slice(0, 300)}`);
      if (mineruOnly) throw err;
    }
  }

  if (mineruOnly) {
    throw new Error('MINERU_ONLY is enabled, but MinerU did not produce parseable text');
  }

  // Free-only chain: Groq → OpenRouter (:free) → filename heuristic.
  // (Gemini and the paid OpenAI fallback were removed 2026-07-09.)
  const parsers = mimeType === 'application/pdf' ? [parseDocumentWithGroq, parseDocumentWithOpenRouter] : [];

  if (parsers.length === 0) {
    log.warn('No AI parsers available for non-PDF, using heuristic', { filename, mimeType });
    return parseFromFilename(filename, folder);
  }

  let lastErr = null;
  for (const parser of parsers) {
    try {
      const result = await parser(filename, folder, pdfBuffer);
      log.info('AI parse success', { filename, parser: parser.name, docType: result.docType, confidence: result.confidence, totalMs: Date.now() - t0 });
      return result;
    } catch (err) {
      if (err.message?.includes('not configured')) {
        log.debug(`Skipping ${parser.name} — not configured`, { filename });
        continue;
      }
      log.warn(`${parser.name} failed`, { filename, error: err.message });
      lastErr = err;
    }
  }

  log.error('All AI parsers failed — falling back to filename heuristic', { filename, folder, error: lastErr?.message });
  return parseFromFilename(filename, folder);
}

module.exports = {
  downloadDriveFile,
  parseDocumentWithAI,
  parseDocumentWithGroq,
  parseDocumentWithOpenRouter,
  extractJsonFromTextPrompt,
  parseFromFilename,
  inferMimeType,
  guessSupplierFromPath,
  guessFolderType,
  isOutgoingFolder,
};
