'use strict';

/**
 * Lightweight structured logger for the parsing pipeline.
 *
 * Usage:
 *   const { createLogger } = require('./logger');
 *   const log = createLogger('aiParser');
 *   log.info('Starting parse', { filename, folder });
 *   log.warn('Rate limit hit', { retries });
 *   log.error('Parse failed', { error: err.message });
 *
 * Environment variables:
 *   LOG_LEVEL  — minimum level to emit: debug | info | warn | error  (default: info)
 *   LOG_FILE   — optional path to append JSON lines to (e.g. logs/parsing.log)
 *   NODE_ENV   — 'production' switches console output to JSON lines (default: pretty)
 */

const fs   = require('fs');
const path = require('path');

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const COLORS = {
  debug: '\x1b[36m',  // cyan
  info:  '\x1b[32m',  // green
  warn:  '\x1b[33m',  // yellow
  error: '\x1b[31m',  // red
  reset: '\x1b[0m',
  dim:   '\x1b[2m',
};

const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;
const IS_DEV    = process.env.NODE_ENV !== 'production';
const LOG_FILE  = process.env.LOG_FILE || null;

// Open append stream once at module load
let logStream = null;
if (LOG_FILE) {
  const logPath = path.isAbsolute(LOG_FILE)
    ? LOG_FILE
    : path.join(process.cwd(), LOG_FILE);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
}

function serialize(data) {
  if (data === undefined) return '';
  try   { return ' ' + JSON.stringify(data); }
  catch { return ' [unserializable]'; }
}

function write(level, context, message, data) {
  if (LEVELS[level] < MIN_LEVEL) return;

  const ts    = new Date().toISOString();
  const entry = { ts, level, context, message, ...(data !== undefined ? { data } : {}) };

  // Always write JSON to file when configured
  if (logStream) logStream.write(JSON.stringify(entry) + '\n');

  // Console: pretty in dev, JSON lines in prod
  if (IS_DEV) {
    const c = COLORS[level] || '';
    const r = COLORS.reset;
    const d = COLORS.dim;
    process.stderr.write(
      `${d}[${ts.slice(11, 23)}]${r} ${c}${level.toUpperCase().padEnd(5)}${r} ${d}[${context}]${r} ${message}${serialize(data)}\n`
    );
  } else {
    process.stderr.write(JSON.stringify(entry) + '\n');
  }
}

/**
 * Create a logger scoped to a specific module.
 * @param {string} context  Module name shown in every log line, e.g. 'aiParser'
 */
function createLogger(context) {
  return {
    debug: (msg, data) => write('debug', context, msg, data),
    info:  (msg, data) => write('info',  context, msg, data),
    warn:  (msg, data) => write('warn',  context, msg, data),
    error: (msg, data) => write('error', context, msg, data),
  };
}

module.exports = { createLogger };
