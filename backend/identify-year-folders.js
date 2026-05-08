require('dotenv').config();
const { google } = require('googleapis');

const oauth2 = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const drive = google.drive({ version: 'v3', auth: oauth2 });

const YEAR_FOLDER_IDS = {
  '2024_a': '1yHzB_YyiyTAQfdiQ4PLAA6btdB6TKRAA',
  '2024_b': '1T2-2El0DNuh9jQ7KfMU877AGiR0sJthB',
  '2025_a': '1bRaKz6epxZW8I2bg-orOnEm2KYgWMZsj',
  '2025_b': '1LYULbaxA2q9SNQlYaf_8_gZuO6TTjlVJ',
  '2026_a': '1LDUxtIohrkjKKt6RklD_1G8ZcXPuac8r',
  '2026_b': '1BnoBbHoYrEiPPgR3BeZcXIZ9RLaI6tph',
};

const BG_MONTHS = ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'];

async function listSubfolders(folderId) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 20,
  });
  return res.data.files || [];
}

async function main() {
  for (const [key, id] of Object.entries(YEAR_FOLDER_IDS)) {
    const subs = await listSubfolders(id);
    const hasBgMonth = subs.some(f => BG_MONTHS.some(m => f.name.toLowerCase().includes(m.toLowerCase())));
    const names = subs.map(f => f.name).join(', ');
    console.log(`${key} (${id}): [${hasBgMonth ? 'BG MONTHS ✅' : 'no BG months'}] ${names.substring(0, 100)}`);
  }
}

main().catch(console.error);
