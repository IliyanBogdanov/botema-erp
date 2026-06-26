const bcrypt = require('bcryptjs');
const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const email = process.argv[2] || 'office@studiobotema.com';
const newPassword = process.argv[3] || 'Botema@2024!';

async function run() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const hash = await bcrypt.hash(newPassword, 12);
  const r = await c.query(
    'UPDATE users SET password=$1 WHERE email=$2 RETURNING email, role',
    [hash, email]
  );
  console.log('Updated:', r.rows);
  await c.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
