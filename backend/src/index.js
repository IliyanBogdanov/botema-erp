require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
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
app.use('/api/ai',         require('./routes/ai'));
app.use('/api/gmail',      require('./routes/gmail'));

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Studio Botema ERP API running on port ${PORT}`);
});

module.exports = app;
