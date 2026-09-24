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
ALTER TABLE partners ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'external_physio';

CREATE TABLE IF NOT EXISTS patient_plans (
  patient_id TEXT PRIMARY KEY,
  enrolled BOOLEAN NOT NULL DEFAULT true,
  allotted_sessions INT NOT NULL DEFAULT 0,
  completed_sessions INT NOT NULL DEFAULT 0,
  assigned_physio TEXT,
  notes TEXT NOT NULL DEFAULT '',
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

-- Home-Visit Cases (Programme Enrolments)
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  patient_mobile TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  pcode TEXT DEFAULT '',
  symptoms_concern TEXT DEFAULT '',
  allotted_sessions INT NOT NULL DEFAULT 10,
  completed_sessions INT NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  assigned_physio TEXT REFERENCES partners (username) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  instructions TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_assigned_physio ON cases (assigned_physio);
CREATE INDEX IF NOT EXISTS idx_cases_patient_id ON cases (patient_id);

-- Home-Visit Sessions (Individual Visits within a Case)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL,
  session_number INT NOT NULL,
  scheduled_date TIMESTAMPTZ,
  physio_username TEXT REFERENCES partners (username) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  before_assessment JSONB DEFAULT '{}'::jsonb,
  after_summary JSONB DEFAULT '{}'::jsonb,
  clinical_notes TEXT DEFAULT '',
  clinicea_sync_status TEXT DEFAULT 'pending',
  clinicea_encounter_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_case_id ON sessions (case_id);
CREATE INDEX IF NOT EXISTS idx_sessions_patient_id ON sessions (patient_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);

-- Clinicea's internal patient GUID (patient record `ID`), needed for patient-level API calls such
-- as createEncounterFull. patient_id keeps the human-facing File Number used for lookup.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS clinicea_patient_id TEXT NOT NULL DEFAULT '';
-- Why a session's Clinicea sync is pending/failed, so the reason is visible rather than guessed.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS clinicea_sync_error TEXT;

-- Home-Visit Appointments / Individual Visits (Phase 2a)
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL,
  patient_name TEXT NOT NULL,
  patient_mobile TEXT DEFAULT '',
  address TEXT DEFAULT '',
  visit_number INT NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TEXT NOT NULL DEFAULT '10:00',
  duration_minutes INT DEFAULT 45,
  assigned_physio TEXT REFERENCES partners (username) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  status_history JSONB DEFAULT '[]'::jsonb,
  cancellation_reason TEXT,
  reschedule_reason TEXT,
  reschedule_request JSONB,
  clinicea_appointment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_case_id ON visits (case_id);
CREATE INDEX IF NOT EXISTS idx_visits_assigned_physio ON visits (assigned_physio);
CREATE INDEX IF NOT EXISTS idx_visits_scheduled_date ON visits (scheduled_date);

-- ID of the PDF session report attached to the patient's documents in Clinicea.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS clinicea_document_id TEXT;
-- The home visit a session's notes belong to (for the visit timeline in the Clinicea report).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS visit_id TEXT;
