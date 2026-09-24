// Brings the Postgres database up to date from inside the app. Vercel marks the database
// credentials as sensitive, so they can't be pulled to a laptop to run `npm run db:migrate`
// by hand -- the deployed app, which does have them, runs the migration itself instead.
//
// The schema script only runs when db/schema.sql has actually changed. Its ALTER TABLE
// statements take a brief exclusive lock on each table even when there's nothing to add, and
// running them on every cold start (several instances at once, while users are active) queued
// behind normal queries and hung requests. Now a normal start is one small read:
// the stored fingerprint of the schema matches, so nothing else happens.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getPool } = require('./db');

const LOCK_KEY = 72810431; // arbitrary constant identifying "CareBridge schema migration"
const SCHEMA_FILE = path.join(__dirname, '..', 'db', 'schema.sql');
const VERSION_KEY = 'schema_sha256';

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

// The fingerprint stored after the last successful migration, or null (fresh database).
async function storedVersion(client) {
  try {
    const { rows } = await client.query('SELECT value FROM sync_state WHERE key = $1', [VERSION_KEY]);
    return rows[0] ? rows[0].value : null;
  } catch (err) {
    if (err.code === '42P01') return null; // sync_state doesn't exist yet
    throw err;
  }
}

async function migrate() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const version = crypto.createHash('sha256').update(sql).digest('hex');
  const client = await getPool().connect();
  try {
    if ((await storedVersion(client)) === version) return; // up to date: no locks taken

    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      // Another instance may have finished the same migration while we waited for the lock.
      if ((await storedVersion(client)) === version) return;
      // Don't queue behind user traffic indefinitely; fail this attempt and retry on the next request.
      await client.query("SET lock_timeout = '10s'");
      await client.query(sql);
      await client.query('RESET lock_timeout');
      const imported = await importPartnersIfEmpty(client);
      if (imported) console.log(`[db] Imported ${imported} account(s) from data/partners.json`);
      await client.query(
        `INSERT INTO sync_state (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [VERSION_KEY, version]
      );
      console.log('[db] Schema migrated to', version.slice(0, 12));
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    }
  } finally {
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
