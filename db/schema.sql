-- Run once against the production database (see db/migrate.js).
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS partners (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  allowed_patient_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Adds the columns for anyone who already ran this schema before email/phone existed.
ALTER TABLE partners ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id TEXT PRIMARY KEY,
  start_datetime TIMESTAMP,
  end_datetime TIMESTAMP,
  service_name TEXT,
  service_category TEXT,
  practitioner_name TEXT,
  patient_id TEXT,
  patient_name TEXT,
  patient_mobile TEXT,
  address1 TEXT,
  city TEXT,
  pcode TEXT,
  notes TEXT NOT NULL DEFAULT '',
  notes_sync_status TEXT NOT NULL DEFAULT 'synced',
  notes_updated_at TIMESTAMPTZ,
  source TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  -- Which partner-team member (partners.username) is doing this home visit. Not a hard
  -- access gate -- any partner account can see and assign/reassign any appointment; this
  -- is coordination metadata, decided by the partner team itself, not enforced by us.
  assigned_to TEXT REFERENCES partners (username) ON DELETE SET NULL,
  -- Set once a "new booking" notification (email/SMS) has been sent for this appointment,
  -- so repeated scan runs don't spam the team every time they re-check for changes.
  notified_new_booking BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_start_date ON appointments ((start_datetime::date));
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_assigned_to ON appointments (assigned_to);

-- Adds the columns for anyone who already ran this schema before these existed.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS assigned_to TEXT REFERENCES partners (username) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notified_new_booking BOOLEAN NOT NULL DEFAULT false;

-- Small key-value table for cross-run state, e.g. the last time we scanned Clinicea for
-- new bookings across all future dates (see the /api/cron/scan-new-bookings route).
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- connect-pg-simple creates its own "session" table automatically on first run,
-- but declaring it here means db:migrate sets everything up in one step.
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
