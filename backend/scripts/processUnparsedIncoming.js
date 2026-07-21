/**
 * CLI wrapper around src/lib/unparsedIncoming.js — dry run by default, --apply to write, --limit N.
 * The scheduled execution runs server-side on Railway (src/jobs/unparsedIncomingJob.js);
 * this script is for manual/local inspection only.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
process.env.MINERU_ENABLED = 'false';

const { PrismaClient } = require('@prisma/client');
const { runUnparsedIncoming } = require('../src/lib/unparsedIncoming');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx >= 0 ? Number(process.argv[limIdx + 1]) : Infinity;

runUnparsedIncoming(prisma, { apply: APPLY, limit: LIMIT })
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
