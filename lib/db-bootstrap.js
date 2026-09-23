// Brings the Postgres database up to date from inside the app. Vercel marks the database
// credentials as sensitive, so they can't be pulled to a laptop to run `npm run db:migrate`
// by hand -- the deployed app, which does have them, runs the migration itself instead.
//
// Safe to run on every cold start: schema.sql only uses CREATE ... IF NOT EXISTS / ADD COLUMN
// IF NOT EXISTS, and an advisory lock stops two instances starting together from racing.
const fs = require('fs');
const path = require('path');
const { getPool } = require('./db');

const LOCK_KEY = 72810431; // arbitrary constant identifying "CareBridge schema migration"

// First run against an empty partners table: import the existing accounts (roles and bcrypt
// hashes) from data/partners.json, so switching to Postgres doesn't lock everyone out. Accounts
// without a hash are skipped -- plain-text demo passwords never make it into the database.
async function importPartnersIfEmpty(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM partners');
  if (rows[0].n > 0) return 0;

  const file = path.join(__dirname, '..', 'data', 'partners.json');
  if (!fs.existsSync(file)) return 0;
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));

  let imported = 0;
  for (const p of list) {
    if (!p.username || !p.passwordHash) continue;
    await client.query(
      `INSERT INTO partners (username, password_hash, name, role, allowed_patient_ids, email, phone)
       VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6) ON CONFLICT (username) DO NOTHING`,
      [p.username, p.passwordHash, p.name || p.username, p.role || 'external_physio', p.email || '', p.phone || '']
    );
    imported += 1;
  }
  return imported;
}

async function migrate() {
  const client = await getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await client.query(sql);
    const imported = await importPartnersIfEmpty(client);
    if (imported) console.log(`[db] Imported ${imported} account(s) from data/partners.json`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

let migratePromise = null;
function ensureDatabaseReady() {
  if (!migratePromise) {
    migratePromise = migrate().catch((err) => {
      migratePromise = null; // let the next request try again rather than caching the failure
      throw err;
    });
  }
  return migratePromise;
}

module.exports = { ensureDatabaseReady };
