require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function argValue(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const runId = argValue('--run-id', `mineru-only-full-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`);
const batchSize = Number(argValue('--batch-size', '20'));
const order = argValue('--order', 'asc');
const source = argValue('--source', 'all');
const maxBatches = Number(argValue('--max-batches', '0'));
const batchTimeoutMs = Number(argValue('--batch-timeout-ms', String(20 * 60 * 1000)));
const maxConsecutiveBatchErrors = Number(argValue('--max-consecutive-errors', '25'));
const createNewBizDocs = process.argv.includes('--create-new-bizdocs');
const skipNonfinancial = process.argv.includes('--skip-nonfinancial');
const includeFailed = process.argv.includes('--include-failed');
const retryInvalidGrant = process.argv.includes('--retry-invalid-grant');
const NONFINANCIAL_KEYWORDS = [
  'price list',
  'pricelist',
  'catalogue',
  'catalog',
  'brochure',
  'technical sheet',
  'базови цени',
  'ценова листа',
  'каталог',
  'брошура',
];

const logDir = path.join(__dirname, '../logs');
fs.mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, `${runId}.log`);

function log(line = '') {
  const stamped = line ? `[${new Date().toISOString()}] ${line}` : '';
  fs.appendFileSync(logPath, `${stamped}\n`);
  console.log(line);
}

async function progress() {
  const sourceWhere = {
    OR: [
      { filename: { endsWith: '.pdf', mode: 'insensitive' } },
      { mimeType: { contains: 'pdf', mode: 'insensitive' } },
    ],
    ...(source.toUpperCase() === 'DRIVE' || source.toUpperCase() === 'GMAIL'
      ? { type: source.toUpperCase() }
      : {}),
  };
  if (source.toUpperCase() === 'ALL') {
    sourceWhere.AND = [{
      OR: [
        { type: 'DRIVE', driveFileId: { not: null } },
        { type: 'GMAIL', gmailMsgId: { not: null } },
      ],
    }];
  }

  const rows = await prisma.sourceFile.findMany({
    where: sourceWhere,
    select: { filename: true, folder: true, subject: true },
  });
  const eligibleRows = skipNonfinancial
    ? rows.filter(row => {
        const text = `${row.filename || ''} ${row.folder || ''} ${row.subject || ''}`.toLowerCase();
        return !NONFINANCIAL_KEYWORDS.some(keyword => text.includes(keyword));
      })
    : rows;
  const total = eligibleRows.length;
  const done = await prisma.document.count({
    where: { extractedData: { path: ['mineruRunId'], equals: runId } },
  });
  return { total, done, remaining: Math.max(total - done, 0) };
}

function runBatch(batchNo) {
  const args = [
    'scripts/mineruReparseSourceFiles.js',
    '--mineru-only',
    '--apply',
    '--apply-bizdocs',
    '--include-processed',
    '--reparse-mineru',
    '--run-id', runId,
    '--source', source,
    '--order', order,
    '--limit', String(batchSize),
  ];
  if (createNewBizDocs) args.push('--create-new-bizdocs');
  if (skipNonfinancial) args.push('--skip-nonfinancial');
  if (includeFailed) args.push('--include-failed');
  if (retryInvalidGrant) args.push('--retry-invalid-grant');

  log(`Batch ${batchNo}: node ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      MINERU_ONLY: 'true',
      MINERU_ENABLED: 'true',
      DISABLE_GEMINI_EXTRACTION: 'true',
      DISABLE_GROQ_EXTRACTION: 'true',
      DISABLE_OPENROUTER_EXTRACTION: 'true',
      DISABLE_OPENAI_EXTRACTION: 'true',
    },
    maxBuffer: 1024 * 1024 * 20,
    timeout: batchTimeoutMs,
  });

  fs.appendFileSync(logPath, result.stdout || '');
  fs.appendFileSync(logPath, result.stderr || '');

  if (result.error) {
    log(`Batch ${batchNo} process error: ${result.error.message}`);
    return { found: null, failed: true };
  }

  if (result.status !== 0) {
    log(`Batch ${batchNo} failed with exit code ${result.status}`);
    return { found: null, failed: true };
  }

  const found = Number((result.stdout || '').match(/Found (\d+) source files to parse/)?.[1] || '0');
  log(`Batch ${batchNo} finished; found=${found}`);
  return { found, failed: false };
}

async function main() {
  log(`Starting MinerU-only full refresh runId=${runId}, source=${source}, order=${order}, batchSize=${batchSize}, batchTimeoutMs=${batchTimeoutMs}, maxConsecutiveBatchErrors=${maxConsecutiveBatchErrors}, createNewBizDocs=${createNewBizDocs}, skipNonfinancial=${skipNonfinancial}, includeFailed=${includeFailed}, retryInvalidGrant=${retryInvalidGrant}`);
  let batchNo = 0;
  let consecutiveErrors = 0;

  while (true) {
    const before = await progress();
    log(`Progress before batch: ${before.done}/${before.total} done, ${before.remaining} remaining`);
    if (before.remaining <= 0) break;
    if (maxBatches > 0 && batchNo >= maxBatches) {
      log(`Reached maxBatches=${maxBatches}; stopping.`);
      break;
    }

    batchNo++;
    const { found, failed } = runBatch(batchNo);
    const after = await progress();
    log(`Progress after batch: ${after.done}/${after.total} done, ${after.remaining} remaining`);
    if (failed) {
      consecutiveErrors++;
      log(`Consecutive batch errors: ${consecutiveErrors}/${maxConsecutiveBatchErrors}`);
      if (consecutiveErrors >= maxConsecutiveBatchErrors) {
        log('Reached max consecutive batch errors; stopping.');
        break;
      }
      if (after.done <= before.done) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      continue;
    }
    consecutiveErrors = 0;
    if (found === 0) break;
  }

  log('MinerU-only full refresh runner finished.');
}

main()
  .catch(err => {
    log(`FATAL: ${err.stack || err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
