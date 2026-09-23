// Postgres connection pool. Only created when DATABASE_URL is set, so local dev
// without a database still runs fine on the file-based store (see store.js / partners.js).
const { Pool } = require('pg');

let pool = null;

function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!isConfigured()) throw new Error('DATABASE_URL is not set');
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Most managed Postgres providers (Render included) require SSL but use
      // certs that Node's default trust store won't validate against.
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
    pool.on('error', (err) => {
      console.error('[db] Unexpected error on idle Postgres client:', err.message);
    });
  }
  return pool;
}

module.exports = { isConfigured, getPool };
