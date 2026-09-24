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
      // Safety limits so one stuck query or a frozen serverless instance can't hang the site:
      // give up connecting after 10s, cancel any statement after 20s, and let Postgres close a
      // transaction left open for 30s (which also releases any row/table locks it held).
      connectionTimeoutMillis: 10000,
      statement_timeout: 20000,
      idle_in_transaction_session_timeout: 30000,
    });
    pool.on('error', (err) => {
      console.error('[db] Unexpected error on idle Postgres client:', err.message);
    });
  }
  return pool;
}

module.exports = { isConfigured, getPool };
