/**
 * Gmail Document Scanner — daily cron job.
 *
 * Runs at 07:00 and 19:00 every day.
 * Searches Gmail for emails with PDF attachments (invoices, bank statements, offers),
 * classifies them with Gemini AI, and stores results in the DB.
 *
 * Exports:
 *   startGmailScanJob(prisma)  — registers the cron schedule
 *   runGmailScan(prisma)       — run immediately (manual trigger / historical import)
 *   getLastJobStatus()         — last run result for status endpoint
 */

const cron = require('node-cron');
const { scanGmail } = require('../lib/gmailScanner');

let lastJob = null;
let isRunning = false;

function makeJob() {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    done: 0,
    bankTx: 0,
    documents: 0,
    skipped: 0,
    errors: 0,
    log: [],
    status: 'running',
  };
}

async function runGmailScan(prisma) {
  if (isRunning) {
    console.log('[GmailScan] Already running, skipping.');
    return lastJob;
  }

  const job = makeJob();
  lastJob = job;
  isRunning = true;

  console.log(`[GmailScan] Starting scan at ${job.startedAt}`);

  try {
    await scanGmail(prisma, job);
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.log.push(`Fatal: ${err.message}`);
    console.error('[GmailScan] Fatal error:', err.message);
  } finally {
    job.finishedAt = new Date().toISOString();
    isRunning = false;
    console.log(
      `[GmailScan] Done. processed=${job.done}, bankTx=${job.bankTx}, docs=${job.documents}, errors=${job.errors}`
    );
  }

  return job;
}

function startGmailScanJob(prisma) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    console.log('[GmailScan] GOOGLE_REFRESH_TOKEN not set — job disabled.');
    return;
  }

  // Run at 07:00 and 19:00 every day
  cron.schedule('0 7,19 * * *', () => {
    console.log('[GmailScan] Cron triggered');
    runGmailScan(prisma).catch(err => console.error('[GmailScan] Unhandled:', err));
  });

  console.log('[GmailScan] Scheduled: daily at 07:00 and 19:00');
}

function getLastJobStatus() {
  return lastJob || { status: 'never_run' };
}

module.exports = { startGmailScanJob, runGmailScan, getLastJobStatus };
