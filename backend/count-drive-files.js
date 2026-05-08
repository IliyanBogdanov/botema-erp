require('dotenv').config();
const { google } = require('googleapis');

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });

async function countFiles(folderId, path = '', depth = 0) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 100,
  });
  
  let count = 0;
  for (const f of res.data.files || []) {
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      const sub = await countFiles(f.id, `${path}/${f.name}`, depth + 1);
      count += sub;
    } else if (f.name.match(/\.(pdf|xlsx|xls|docx|csv)$/i)) {
      count++;
      if (depth <= 2) console.log(`  FILE: ${path}/${f.name}`);
    }
  }
  return count;
}

async function main() {
  console.log('Testing 2024_a folder:');
  const c2024 = await countFiles('1yHzB_YyiyTAQfdiQ4PLAA6btdB6TKRAA', '2024');
  console.log(`Total PDF/Excel files in 2024: ${c2024}`);
}

main().catch(e => console.error('ERROR:', e.message));
