require('dotenv').config();
const { google } = require('googleapis');

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });

async function listSubfolders(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 30,
  });
  return res.data.files || [];
}

async function listFiles(folderId, limit = 5) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name, mimeType)',
    pageSize: limit,
  });
  return res.data.files || [];
}

async function exploreFolder(id, name, depth = 0) {
  const indent = '  '.repeat(depth);
  const subs = await listSubfolders(id);
  const files = await listFiles(id, 3);
  console.log(`${indent}📁 ${name} (${id})`);
  files.forEach(f => console.log(`${indent}  📄 ${f.name}`));
  if (depth < 2) {
    for (const sub of subs.slice(0, 5)) {
      await exploreFolder(sub.id, sub.name, depth + 1);
    }
  } else {
    subs.slice(0, 3).forEach(s => console.log(`${indent}  📁 ${s.name} ...`));
  }
}

async function main() {
  console.log('\n=== 2024_a ===');
  await exploreFolder('1yHzB_YyiyTAQfdiQ4PLAA6btdB6TKRAA', '2024_a');
  
  console.log('\n=== 2025_a ===');
  await exploreFolder('1bRaKz6epxZW8I2bg-orOnEm2KYgWMZsj', '2025_a');
}

main().catch(console.error);
