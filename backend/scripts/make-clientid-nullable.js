require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // Make clientId nullable in invoices table
  const r = await c.query(`
    ALTER TABLE invoices ALTER COLUMN "clientId" DROP NOT NULL;
  `);
  console.log('✅ invoices.clientId is now nullable');

  await c.end();
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
