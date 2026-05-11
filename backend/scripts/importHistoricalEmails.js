/**
 * One-off script: import all historical emails with PDF attachments from Gmail.
 *
 * Uses the same scanGmail() function as the daily cron job.
 * Already-processed messages (tracked in GmailMessage table) are skipped automatically.
 *
 * Usage:
 *   cd backend
 *   node scripts/importHistoricalEmails.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { scanGmail } = require('../src/lib/gmailScanner');

const prisma = new PrismaClient();

async function main() {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    console.error('❌ GOOGLE_REFRESH_TOKEN not set in .env');
    process.exit(1);
  }

  const job = {
    startedAt: new Date().toISOString(),
    total: 0,
    done: 0,
    bankTx: 0,
    documents: 0,
    skipped: 0,
    errors: 0,
    log: [],
    status: 'running',
  };

  console.log('📧 Starting historical Gmail import...');
  console.log('   (already-processed emails will be skipped)');

  try {
    await scanGmail(prisma, job);
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    console.error('Fatal:', err.message);
  }

  console.log('\n=== Results ===');
  console.log(`Processed : ${job.done} / ${job.total}`);
  console.log(`Bank Tx   : ${job.bankTx}`);
  console.log(`Documents : ${job.documents}`);
  console.log(`Errors    : ${job.errors}`);

  if (job.log.length > 0) {
    console.log('\n--- Log (last 30 lines) ---');
    job.log.slice(-30).forEach(l => console.log(l));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
