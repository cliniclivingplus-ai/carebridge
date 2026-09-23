require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const clinicea = require('./lib/clinicea-client');
const db = require('./lib/db');
const mock = require('./lib/mock-data');
const { normalizeAppointment } = require('./lib/webhook-normalize');

// Postgres (Vercel Postgres) when DATABASE_URL is set; local JSON-file store otherwise.
const store = db.isConfigured() ? require('./lib/store-pg') : require('./lib/store');
const partners = db.isConfigured() ? require('./lib/partners-pg') : require('./lib/partners');

// The "Simulate booking" endpoint exists purely to demo the webhook flow without a real
// Clinicea connection. Once a real API key is set, real bookings arrive via webhook and
// this should not exist as an attack surface -- so it's compiled out, not just hidden.
const DEMO_MODE = !clinicea.isLiveMode();

const app = express();
app.set('trust proxy', 1); // needed behind Vercel's proxy so secure cookies work
app.use(helmet());
const PHYSIO_FILTER = (process.env.PHYSIO_SERVICE_FILTER || 'physio')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  },
};

if (db.isConfigured()) {
  // Sessions live in Postgres, not process memory -- required on Vercel since each request
  // can hit a different (or newly cold-started) function instance with no shared memory.
  const pgSession = require('connect-pg-simple')(session);
  sessionConfig.store = new pgSession({ pool: db.getPool(), tableName: 'session', createTableIfMissing: true });
}

app.use(session(sessionConfig));

if (process.env.NODE_ENV === 'production') {
  // Fail loudly at startup rather than silently running with a guessable session secret
  // or an unprotected webhook endpoint in production.
  const missing = [];
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!process.env.WEBHOOK_SECRET) missing.push('WEBHOOK_SECRET');
  if (missing.length) {
    throw new Error(`Missing required production env var(s): ${missing.join(', ')}`);
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // generous -- real Clinicea traffic, not user-facing, but still capped
  standardHeaders: true,
  legacyHeaders: false,
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not logged in' });
}

function isPhysioAppointment(appt) {
  const haystack = `${appt.AppointmentServiceName || ''} ${appt.AppointmentServiceCategory || ''}`.toLowerCase();
  return PHYSIO_FILTER.some((term) => haystack.includes(term));
}

function toView(a) {
  return {
    id: a.AppointmentID,
    start: a.AppointmentStartDateTime,
    end: a.AppointmentEndDateTime,
    service: a.AppointmentServiceName,
    practitioner: a.AppointmentPractionerName,
    patientName: a.PatientName,
    patientMobile: a.PatientMobileNo,
    address: [a.Address1, a.City, a.PCode].filter(Boolean).join(', '),
    notes: a.notes || '',
    notesSyncStatus: a.notesSyncStatus || 'synced',
    source: a.source || 'clinicea',
  };
}

let seedPromise = null;
// Seed the store on first run so there's something to show before any webhook has fired.
// Guarded by a module-level promise so concurrent cold-start invocations don't race each other.
function seedStoreIfEmpty() {
  if (!seedPromise) {
    seedPromise = (async () => {
      if (await store.isEmpty()) {
        const seedData = clinicea.isLiveMode()
          ? await clinicea.getAppointmentsByDate(new Date().toISOString().slice(0, 10)).catch(() => [])
          : mock.getAppointmentsByDate();
        for (const a of seedData) {
          await store.upsertAppointment(a);
        }
      }
    })();
  }
  return seedPromise;
}

// ---------- Auth ----------

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = await partners.verifyLogin(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.user = user;
  res.json({ ok: true, username: user.username, name: user.name });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null, liveMode: clinicea.isLiveMode() });
});

// ---------- Dashboard data (reads from the store, kept in sync by webhooks) ----------

app.get('/api/appointments', requireAuth, async (req, res) => {
  await seedStoreIfEmpty();
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const dayAppointments = await store.getByDate(date);
  const visible = dayAppointments
    .filter(isPhysioAppointment)
    .filter((a) => partners.canSeePatient(req.session.user, a.PatientID))
    .map(toView);
  res.json({ date, liveMode: clinicea.isLiveMode(), appointments: visible });
});

app.put('/api/appointments/:id/notes', requireAuth, async (req, res) => {
  const { notes } = req.body || {};
  if (typeof notes !== 'string') return res.status(400).json({ error: 'notes must be a string' });

  const all = await store.getAll();
  const existing = all.find((a) => a.AppointmentID === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Appointment not found' });
  if (!partners.canSeePatient(req.session.user, existing.PatientID)) {
    return res.status(403).json({ error: 'Not authorized for this patient' });
  }

  // Reflect the edit immediately, then push to Clinicea. If the push fails, the dashboard
  // still shows the note but flags it as not-yet-synced rather than losing the edit.
  await store.setNotes(req.params.id, notes, 'pending');
  try {
    await clinicea.updateAppointmentNotes(req.params.id, notes);
    const updated = await store.setNotes(req.params.id, notes, 'synced');
    if (!updated) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ ok: true, notesSyncStatus: 'synced' });
  } catch (err) {
    await store.setNotes(req.params.id, notes, 'failed');
    res.status(502).json({ error: `Saved locally, but Clinicea sync failed: ${err.message}`, notesSyncStatus: 'failed' });
  }
});

// ---------- Webhooks: Clinicea -> this dashboard ----------
// Register these URLs in Clinicea under Tools > Organization > Integrations > Webhooks,
// one per (feature, operation) pair, e.g.
// Appointment/Add -> https://<your-vercel-domain>/webhooks/clinicea/<WEBHOOK_SECRET>/appointment/add
// The secret path segment is checked below since Clinicea does not sign its webhook calls.

function requireWebhookSecret(req, res, next) {
  const configured = process.env.WEBHOOK_SECRET;
  if (!configured) return next(); // not set in dev/mock mode; required once deployed (see .env.example)
  if (req.params.secret !== configured) return res.status(404).end(); // 404, not 401 -- don't reveal the route exists
  next();
}

function handleAppointmentWebhook(eventType) {
  return async (req, res) => {
    await seedStoreIfEmpty();
    const appt = normalizeAppointment(req.body);
    if (!appt.AppointmentID) {
      console.warn(`[webhook] appointment/${eventType} payload missing AppointmentID:`, req.body);
      return res.status(400).json({ error: 'Payload missing AppointmentID' });
    }
    if (eventType === 'delete' || eventType === 'cancel') {
      await store.markDeleted(appt.AppointmentID);
    } else {
      await store.upsertAppointment(appt);
    }
    console.log(`[webhook] appointment/${eventType} -> ${appt.AppointmentID} synced to dashboard`);
    res.json({ ok: true });
  };
}

app.post('/webhooks/clinicea/:secret/appointment/add', webhookLimiter, requireWebhookSecret, handleAppointmentWebhook('add'));
app.post('/webhooks/clinicea/:secret/appointment/edit', webhookLimiter, requireWebhookSecret, handleAppointmentWebhook('edit'));
app.post('/webhooks/clinicea/:secret/appointment/cancel', webhookLimiter, requireWebhookSecret, handleAppointmentWebhook('cancel'));
app.post('/webhooks/clinicea/:secret/appointment/delete', webhookLimiter, requireWebhookSecret, handleAppointmentWebhook('delete'));

// ---------- Demo helper: simulate what a real Clinicea webhook would send ----------
// Only registered in demo/mock mode (no CLINICEA_API_KEY set). Once a real key is
// configured, this route does not exist at all -- not hidden, not disabled, absent --
// so there's no way to inject fake appointments into a production dataset.
if (DEMO_MODE) {
  app.post('/api/dev/simulate-booking', requireAuth, async (req, res) => {
    await seedStoreIfEmpty();
    const { source, forOwnClient } = req.body || {};
    const id = `apt-sim-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date();
    const start = new Date(now.getTime() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    const appt = {
      AppointmentID: id,
      AppointmentStartDateTime: start.toISOString().slice(0, 19),
      AppointmentEndDateTime: end.toISOString().slice(0, 19),
      AppointmentServiceName: 'Physiotherapy - Home Visit',
      AppointmentServiceCategory: 'Physiotherapy',
      AppointmentPractionerName: source === 'patient' ? 'Unassigned (online booking)' : 'Dr. Rao',
      PatientID: forOwnClient ? 'pat-501' : `pat-sim-${crypto.randomBytes(2).toString('hex')}`,
      PatientName: forOwnClient ? 'Anitha Kumar' : source === 'patient' ? 'New Online Patient (different client)' : 'New Walk-in Patient (different client)',
      PatientMobileNo: forOwnClient ? '9876500001' : '9876500099',
      Address1: forOwnClient ? '12 Lake View Road' : '221B Residency Road',
      City: 'Bengaluru',
      PCode: forOwnClient ? '560034' : '560025',
      source: source === 'patient' ? 'patient-online-booking' : 'doctor-booked-in-clinicea',
      notes: '',
    };
    const saved = await store.upsertAppointment(appt);
    res.json({ ok: true, appointment: toView(saved) });
  });
}

// ---------- Fallbacks ----------

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler: never leak stack traces or internal error details to clients.
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = { app, seedStoreIfEmpty, DEMO_MODE };
