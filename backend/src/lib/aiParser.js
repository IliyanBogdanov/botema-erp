/**
 * Document parser — AI-powered with smart heuristic fallback
 * Handles Bulgarian folder names, extracts supplier/date/invoice from filename+folder
 * AI chain: Gemini 2.5 Flash → Groq llama-3.3-70b → OpenRouter (free) → heuristic
 */
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');

const getAuth = () => {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return oauth2;
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
  { keys: ['lodes', 'лодес'],                              id: 'sup-lodes' },
  { keys: ['alphaluce', 'алфалуче', 'alphace',
           'митническа декларация', 'customs declaration',
           'митница', 'china import', 'chinese'],      id: 'sup-alpha' },
  { keys: ['polaris', 'поларис'],                          id: 'sup-pol'   },
  { keys: ['novaluce', 'новалуче'],                        id: 'sup-nov'   },
  { keys: ['aca lighting', 'aca', 'ака'],                  id: 'sup-aca'   },
  { keys: ['ambientec', 'амбиентек'],                      id: 'sup-amb'   },
  { keys: ['antrax', 'антракс'],                           id: 'sup-ant'   },
  { keys: ['sedap', 'ателие седап', 'atelier sedap'],      id: 'sup-sed'   },
  { keys: ['braga', 'брага', 'fratelli braga'],            id: 'sup-bra'   },
  { keys: ['formani', 'формани'],                          id: 'sup-form'  },
  { keys: ['karimoku', 'каримоку'],                        id: 'sup-kari'  },
  { keys: ['kraab', 'краб', 'кра аб'],                     id: 'sup-kra'   },
  { keys: ['sovet', 'совет итали'],                        id: 'sup-sov'   },
  { keys: ['dhl'],                                         id: 'sup-dhl'   },
  { keys: ['omega light', 'омега лайт', 'omega'],          id: 'sup-omega' },
  { keys: ['speedy', 'спиди'],                             id: 'sup-speedy'},
  { keys: ['zieta', 'зиета'],                              id: 'sup-zieta' },
  { keys: ['macro', 'макро'],                              id: 'sup-macro' },
  { keys: ['chatgpt', 'чатгпт', 'чат гпт', 'openai'],     id: 'sup-openai'},
  { keys: ['microinvest', 'микроинвест'],                  id: 'sup-micro' },
  { keys: ['зира дизайн', 'zira design'],                  id: 'sup-zira'  },
  { keys: ['sunfoods', 'сънфуудс', 'сън фудс'],            id: 'sup-sunf'  },
  { keys: ['ambicio', 'амбицио'],                          id: 'sup-ambic' },
  { keys: ['alfa light', 'алфа лайт'],                     id: 'sup-alfal' },
  { keys: ['ват ', 'watt ', 'ватт'],                       id: 'sup-watt'  },
  { keys: ['румен романов', 'rumen romanov'],               id: 'sup-rrom'  },
  { keys: ['наем', 'rent', 'шоурум', 'showroom'],          id: 'sup-rent'  },
  { keys: ['счетоводн', 'accounting', 'accountancy'],      id: 'sup-acct'  },
  // 2024/2025 suppliers
  { keys: ['bonaldo', 'боналдо'],                          id: 'sup-bonaldo' },
  { keys: ['топ диджитал', 'top digital', 'топдиджитал'],  id: 'sup-topdig'  },
  { keys: ['facebook', 'фейсбук', 'meta ads', 'meta/fac'], id: 'sup-fb'      },
  { keys: ['google ads', 'гугъл', 'google платеж'],        id: 'sup-google'  },
  { keys: ['superhosting', 'супърхостинг'],                id: 'sup-sh'      },
  { keys: ['nest studio', 'нест студио', 'nest '],         id: 'sup-nest'    },
  { keys: ['rashev', 'рашев', 'ultralight'],               id: 'sup-rashev'  },
  { keys: ['econt', 'еконт'],                              id: 'sup-econt'   },
  { keys: ['exenza', 'ексенза'],                           id: 'sup-exenza'  },
  { keys: ['fercam', 'феркам'],                            id: 'sup-fercam'  },
  { keys: ['siltem', 'силтем'],                            id: 'sup-siltem'  },
  { keys: ['tridonic', 'тридоник'],                        id: 'sup-tridonic'},
  { keys: ['sielte', 'сиелте'],                            id: 'sup-sielte'  },
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
  const isoMatch = text.match(/\b(202\d)[_\-. /](\d{1,2})[_\-. /](\d{1,2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}`;
  }

  // Date in filename: 15.04.2026 or 03.04.2026
  const dmyMatch = text.match(/\b(\d{1,2})[._](\d{1,2})[._](202\d)\b/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`;
  }

  // Bulgarian month name in folder path
  const year = (folder.match(/\b(202\d)\b/) || [])[1] || new Date().getFullYear().toString();
  for (const [bg, mm] of Object.entries(BG_MONTHS)) {
    if (text.includes(bg)) return `${year}-${mm}-01`;
  }

  // Fallback: just year
  return `${year}-01-01`;
}

function extractInvoiceNo(filename) {
  const name = filename.replace(/\.[^.]+$/, '');

  // Pattern: Invoice-2604608 or Invoice-2604608-Lodes
  const invMatch = name.match(/(?:invoice|фактура|faktura|inv)[_\-\s#]+(\d{4,})/i);
  if (invMatch) return invMatch[1];

  // Pattern: pure long number sequences like 2604608
  const numMatch = name.match(/\b(\d{6,})\b/);
  if (numMatch) return numMatch[1];

  // Pattern: alphanumeric like AP202602090005
  const alphaMatch = name.match(/\b([A-Z]{1,4}\d{8,})\b/);
  if (alphaMatch) return alphaMatch[1];

  return null;
}

function parseFromFilename(filename, folder) {
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
  return JSON.parse(jsonMatch[0]);
}

async function parseDocumentWithOpenRouter(filename, folder, pdfBuffer) {
  if (!openrouter) throw new Error('OPENROUTER_API_KEY is not configured');
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

  const chat = await openrouter.chat.completions.create({
    model: 'openai/gpt-oss-20b:free',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  });

  const content = chat.choices[0].message.content.trim();
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in OpenRouter response: ' + content.substring(0, 200));
  return JSON.parse(jsonMatch[0]);
}

async function parseDocumentWithOpenAI(filename, folder, pdfBuffer) {
  if (!openai) throw new Error('OPENAI_API_KEY is not configured');

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
  return JSON.parse(jsonMatch[0]);
}

async function parseDocumentWithAI(filename, folder, pdfBuffer) {
  const folderType = guessFolderType(folder);

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

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const tryGemini = async (retries = 2) => {
    try {
      const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType: 'application/pdf', data: pdfBuffer.toString('base64') } },
      ]);
      const text = result.response.text().trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in AI response: ' + text.substring(0, 200));
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      const isRateLimit = err.status === 429 || msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('rate limit') || msg.includes('quota');
      if (isRateLimit && retries > 0) {
        await new Promise(r => setTimeout(r, 65000));
        return tryGemini(retries - 1);
      }
      throw err;
    }
  };

  try {
    return await tryGemini();
  } catch (err) {
    const fallbackParsers = [
      parseDocumentWithGroq,
      parseDocumentWithOpenRouter,
      parseDocumentWithOpenAI,
    ];

    for (const parser of fallbackParsers) {
      try {
        return await parser(filename, folder, pdfBuffer);
      } catch (fallbackErr) {
        if (fallbackErr.message?.includes('not configured')) continue;
        err = fallbackErr;
      }
    }

    throw err;
  }
}

module.exports = {
  downloadDriveFile,
  parseDocumentWithAI,
  parseDocumentWithGroq,
  parseDocumentWithOpenRouter,
  parseDocumentWithOpenAI,
  parseFromFilename,
  guessSupplierFromPath,
  guessFolderType,
  isOutgoingFolder,
};
