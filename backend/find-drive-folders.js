require('dotenv').config();
const { google } = require('googleapis');

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });

async function main() {
  // List all folders
  const res = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
    fields: 'files(id, name, parents)',
    pageSize: 100,
    orderBy: 'name',
  });

  const folders = res.data.files;
  console.log('All folders:');
  folders.forEach(f => {
    console.log(`  ${f.id}  "${f.name}"  parent:${(f.parents||[]).join(',')}`);
  });

  // Find year folders
  const yearFolders = folders.filter(f => /^202[0-9]$/.test(f.name));
  console.log('\nYear folders:');
  yearFolders.forEach(f => console.log(`  ${f.id}  ${f.name}`));
}

main().catch(console.error);
