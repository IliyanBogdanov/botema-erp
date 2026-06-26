const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function boolEnv(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function isMineruEnabled() {
  return boolEnv('MINERU_ENABLED', false);
}

function safeFilename(filename) {
  const ext = path.extname(filename || '').slice(0, 12) || '.pdf';
  const base = path.basename(filename || 'document', ext)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'document';
  return `${base}${ext}`;
}

async function walk(dir) {
  const result = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await walk(full));
    } else {
      result.push(full);
    }
  }
  return result;
}

function runCommand(command, args, options, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`MinerU timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timeout);
      if (code === 0) return resolve({ stdout, stderr });
      const msg = stderr || stdout || `${command} exited with code ${code}`;
      reject(new Error(msg.trim().slice(0, 2000)));
    });
  });
}

function contentListToText(contentList) {
  if (!Array.isArray(contentList)) return '';
  const chunks = [];
  for (const item of contentList) {
    if (!item || typeof item !== 'object') continue;
    for (const key of ['text', 'content', 'caption', 'html']) {
      if (typeof item[key] === 'string' && item[key].trim()) {
        chunks.push(item[key].trim());
      }
    }
    if (Array.isArray(item.table_body)) {
      chunks.push(item.table_body.flat().join(' '));
    }
  }
  return chunks.join('\n');
}

async function readMineruOutput(outputDir) {
  const files = await walk(outputDir);
  const markdownFile = files.find(f => f.toLowerCase().endsWith('.md'));
  const contentListFile = files.find(f => f.toLowerCase().endsWith('_content_list.json'));
  const contentListV2File = files.find(f => f.toLowerCase().endsWith('_content_list_v2.json'));

  const markdown = markdownFile ? await fs.readFile(markdownFile, 'utf8') : '';
  let contentList = null;
  let contentListV2 = null;

  if (contentListFile) {
    contentList = JSON.parse(await fs.readFile(contentListFile, 'utf8'));
  }
  if (contentListV2File) {
    contentListV2 = JSON.parse(await fs.readFile(contentListV2File, 'utf8'));
  }

  const structuredText = contentListToText(contentList) || contentListToText(contentListV2);
  const text = [structuredText, markdown].filter(Boolean).join('\n\n').trim();

  return {
    text,
    markdown,
    contentList,
    contentListV2,
    files: files.map(f => path.relative(outputDir, f)),
  };
}

async function runMineru({ buffer, filename, inputPath }) {
  if (!buffer && !inputPath) throw new Error('runMineru requires buffer or inputPath');

  const command = process.env.MINERU_COMMAND || 'mineru';
  const backend = process.env.MINERU_BACKEND || '';
  const method = process.env.MINERU_METHOD || '';
  const apiUrl = process.env.MINERU_API_URL || '';
  const timeoutMs = Number(process.env.MINERU_TIMEOUT_MS || 15 * 60 * 1000);
  const keepOutput = boolEnv('MINERU_KEEP_OUTPUT', false);

  const workRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'botema-mineru-'));
  const outputDir = path.join(workRoot, 'output');
  await fs.mkdir(outputDir, { recursive: true });

  let sourcePath = inputPath;
  if (!sourcePath) {
    sourcePath = path.join(workRoot, safeFilename(filename));
    await fs.writeFile(sourcePath, buffer);
  }

  const args = ['-p', sourcePath, '-o', outputDir];
  if (backend) args.push('-b', backend);
  if (method) args.push('-m', method);
  if (apiUrl) args.push('--api-url', apiUrl);

  try {
    const startedAt = Date.now();
    const { stdout, stderr } = await runCommand(command, args, { cwd: workRoot, env: process.env }, timeoutMs);
    const output = await readMineruOutput(outputDir);
    return {
      ...output,
      provider: 'mineru',
      command,
      args,
      outputDir: keepOutput ? outputDir : null,
      durationMs: Date.now() - startedAt,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      digest: crypto.createHash('sha256').update(output.text || '').digest('hex'),
    };
  } finally {
    if (!keepOutput) {
      await fs.rm(workRoot, { recursive: true, force: true });
    }
  }
}

module.exports = {
  isMineruEnabled,
  runMineru,
};
