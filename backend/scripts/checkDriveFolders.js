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
  // List top-level folders
  const foldRes = await drive.files.list({
    q: 'mimeType = "application/vnd.google-apps.folder" and "root" in parents and trashed = false',
    fields: 'files(id,name)',
    pageSize: 30
  });
  console.log('Root folders:', JSON.stringify(foldRes.data.files, null, 2));

  // Search for offer files
  const offerRes = await drive.files.list({
    q: '(name contains "offer" or name contains "оферт" or name contains "Оферт") and trashed = false',
    fields: 'files(id,name,createdTime,mimeType,parents)',
    pageSize: 30
  });
  console.log('\nOffer files:', JSON.stringify(offerRes.data.files, null, 2));
}
main().catch(console.error);
