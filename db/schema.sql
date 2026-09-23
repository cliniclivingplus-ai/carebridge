-- Run once against the production database (see db/migrate.js).
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS partners (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  allowed_patient_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_start_date ON appointments ((start_datetime::date));
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments (patient_id);

-- connect-pg-simple creates its own "session" table automatically on first run,
-- but declaring it here means db:migrate sets everything up in one step.
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
