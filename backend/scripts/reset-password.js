require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

async function run() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const hash = await bcrypt.hash('Botema2024!', 12);
  const r = await c.query(
    'UPDATE users SET password=$1 WHERE email=$2 RETURNING email, role',
    [hash, 'office@studiobotema.com']
  );
  console.log('Updated:', r.rows);
  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
