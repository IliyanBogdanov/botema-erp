/**
 * Daily cron: parse Drive incoming PDFs that were scanned but never turned into
 * a BizDocument (see src/lib/unparsedIncoming.js for the guards). Runs on Railway
 * because Google Workspace only issues OAuth refresh tokens to approved network
 * origins — the local machine that used to run this as a Windows Scheduled Task
 * can no longer reach the Google token endpoint.
 */
const cron = require('node-cron');
const { runUnparsedIncoming } = require('../lib/unparsedIncoming');

let lastRun = null;

function startUnparsedIncomingJob(prisma) {
  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    console.log('[UnparsedIncoming] GOOGLE_REFRESH_TOKEN not set — job disabled.');
    return;
  }

  const cronExpr = process.env.UNPARSED_INCOMING_CRON || '30 9 * * *';
  cron.schedule(cronExpr, async () => {
    console.log('[UnparsedIncoming] Cron triggered');
    try {
      const stats = await runUnparsedIncoming(prisma, { apply: true, log: m => console.log('[UnparsedIncoming]', m) });
      lastRun = { at: new Date().toISOString(), ...stats };
    } catch (err) {
      console.error('[UnparsedIncoming] Fatal:', err.message);
      lastRun = { at: new Date().toISOString(), error: err.message };
    }
  }, { timezone: 'Europe/Sofia' });

  console.log(`[UnparsedIncoming] Scheduled daily at "${cronExpr}" Europe/Sofia`);
}

function getLastRun() {
  return lastRun;
}

module.exports = { startUnparsedIncomingJob, getLastRun };
