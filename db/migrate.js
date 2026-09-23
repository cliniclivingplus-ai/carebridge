require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getPool, isConfigured } = require('../lib/db');

async function main() {
  if (!isConfigured()) {
    console.error('DATABASE_URL is not set. Nothing to migrate (app will use the local file store instead).');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const pool = getPool();
  await pool.query(sql);
  console.log('Migration complete: partners, appointments, session tables are ready.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
