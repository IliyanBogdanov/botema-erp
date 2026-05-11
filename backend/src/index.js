require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { startAlertJobs } = require('./lib/alertEngine');
const prisma = require('./lib/prisma');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      'http://localhost:3000',
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    // Allow requests with no origin (mobile apps, curl) or matching origins
    if (!origin || allowed.some(o => origin === o || origin.endsWith('.vercel.app'))) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: ${origin} not allowed`));
    }
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/clients',    require('./routes/clients'));
app.use('/api/suppliers',  require('./routes/suppliers'));
app.use('/api/projects',   require('./routes/projects'));
app.use('/api/invoices',   require('./routes/invoices'));
app.use('/api/purchases',  require('./routes/purchases'));
app.use('/api/inventory',  require('./routes/inventory'));
app.use('/api/expenses',   require('./routes/expenses'));
app.use('/api/documents',  require('./routes/documents'));
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/alerts',     require('./routes/alerts'));
app.use('/api/vat',        require('./routes/vat'));
app.use('/api/ai',         require('./routes/ai'));
app.use('/api/gmail',          require('./routes/gmail'));
app.use('/api/counterparties', require('./routes/counterparties'));
app.use('/api/biz-documents',  require('./routes/bizDocuments'));
app.use('/api/payments',       require('./routes/payments'));
app.use('/api/reconciliation', require('./routes/reconciliation'));
app.use('/api/orders',         require('./routes/orders'));
app.use('/api/deliveries',     require('./routes/deliveries'));
app.use('/api/issued-docs',     require('./routes/issuedDocs'));
app.use('/api/gmail-inbox',    require('./routes/gmailInbox'));
app.use('/api/backfill',       require('./routes/backfill'));
app.use('/api/auth/google',    require('./routes/google'));  // callback at /api/auth/google/callback
app.use('/api/google',         require('./routes/google'));  // auth-url + status

const { companyRouter } = require('./routes/misc');
app.use('/api/company', companyRouter);

app.use('/api/search',  require('./routes/search'));
app.use('/api/rates',   require('./routes/rates'));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Studio Botema ERP API running on port ${PORT}`);
  console.log(`🤖 AI chain: Gemini → Groq → OpenRouter (openai/gpt-oss-20b:free) [v2e21dda]`);
});

startAlertJobs(prisma);

module.exports = app;
