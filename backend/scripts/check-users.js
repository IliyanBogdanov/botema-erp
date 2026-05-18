require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(() => c.query('SELECT email, role, name FROM users ORDER BY email LIMIT 10'))
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); c.end(); })
  .catch(e => { console.error(e.message); c.end(); });
