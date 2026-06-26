/**
 * Run MinerU against a local document and print a compact extraction preview.
 *
 * Usage:
 *   node scripts/mineruParseFile.js path/to/file.pdf
 *   MINERU_BACKEND=pipeline node scripts/mineruParseFile.js path/to/file.pdf
 *   MINERU_API_URL=http://127.0.0.1:8000 node scripts/mineruParseFile.js path/to/file.pdf
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs/promises');
const path = require('path');
const { runMineru } = require('../src/lib/mineru');

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/mineruParseFile.js path/to/file.pdf');
    process.exitCode = 1;
    return;
  }

  const fullPath = path.resolve(inputPath);
  await fs.access(fullPath);

  const result = await runMineru({
    inputPath: fullPath,
    filename: path.basename(fullPath),
  });

  console.log(JSON.stringify({
    provider: result.provider,
    durationMs: result.durationMs,
    digest: result.digest,
    files: result.files,
    outputDir: result.outputDir,
    textPreview: (result.text || '').slice(0, 4000),
  }, null, 2));
}

main().catch(err => {
  console.error(err.message || err);
  process.exitCode = 1;
});
