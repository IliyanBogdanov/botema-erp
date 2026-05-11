const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

const getOAuth2Client = () => new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback'
);

// GET /api/google/login — redirect directly to Google OAuth
router.get('/login', (req, res) => {
  const oauth2 = getOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  res.redirect(url);
});

// GET /api/google/auth-url — returns the URL to open in browser
router.get('/auth-url', async (req, res) => {
  const oauth2 = getOAuth2Client();
  const url = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  res.json({ url });
});

// GET /api/google/callback — handles redirect from Google, saves refresh_token
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google OAuth error: ${error}`);
  if (!code) return res.status(400).send('Missing code');

  try {
    const oauth2 = getOAuth2Client();
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(400).send(`
        <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee">
        <h2 style="color:#ff9f0a">⚠️ Няма refresh_token</h2>
        <p>Отвори <a href="https://myaccount.google.com/permissions" style="color:#0a84ff">Google Account Permissions</a>,
        премахни достъпа за това приложение и опитай отново.</p>
        </body></html>
      `);
    }

    // Set in memory for this process lifetime
    process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;

    console.log('[Google OAuth] ✅ refresh_token saved');
    res.send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee;max-width:700px;margin:0 auto">
        <h2 style="color:#30d158">✅ Google OAuth успешен!</h2>
        <p style="color:#aaa">Копирай token-а по-долу и го добави в <strong>Railway → Variables → GOOGLE_REFRESH_TOKEN</strong>, после рестартирай service-а.</p>
        <div style="background:#1c1c1e;border:1px solid #333;border-radius:8px;padding:16px;margin:20px 0">
          <p style="margin:0 0 8px;font-size:11px;color:#666;letter-spacing:.08em">GOOGLE_REFRESH_TOKEN</p>
          <code style="word-break:break-all;font-size:13px;color:#30d158;user-select:all">${tokens.refresh_token}</code>
        </div>
        <p style="font-size:12px;color:#555">Прозорецът може да се затвори след копиране.</p>
      </body></html>
    `);
  } catch (e) {
    console.error('[Google OAuth] Error:', e.message);
    res.status(500).send(`OAuth error: ${e.message}`);
  }
});

// GET /api/google/status — check if credentials are working
router.get('/status', async (req, res) => {
  const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
  const hasSecret = !!process.env.GOOGLE_CLIENT_SECRET;
  const hasRefreshToken = !!process.env.GOOGLE_REFRESH_TOKEN;

  let gmailOk = false;
  let driveOk = false;

  if (hasRefreshToken) {
    try {
      const oauth2 = getOAuth2Client();
      oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const gmail = google.gmail({ version: 'v1', auth: oauth2 });
      await gmail.users.getProfile({ userId: 'me' });
      gmailOk = true;
    } catch (e) {
      gmailOk = false;
    }
    try {
      const oauth2 = getOAuth2Client();
      oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
      const drive = google.drive({ version: 'v3', auth: oauth2 });
      await drive.about.get({ fields: 'user' });
      driveOk = true;
    } catch (e) {
      driveOk = false;
    }
  }

  res.json({
    hasClientId,
    hasSecret,
    hasRefreshToken,
    gmailOk,
    driveOk,
    authUrl: hasClientId && hasSecret && !hasRefreshToken
      ? `http://localhost:3001/api/google/auth-url`
      : null,
  });
});

module.exports = router;
