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

// Patient lookup returns real PHI on demand -- capped harder than normal dashboard reads so a
// logged-in account can't be used to enumerate/scrape patient records at speed.
const patientLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many lookups. Slow down and try again shortly.' },
});

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Not logged in' });
}

function isPhysioAppointment(appt) {
  if (PHYSIO_FILTER.includes('*') || PHYSIO_FILTER.includes('all') || PHYSIO_FILTER.includes('any')) {
    return true;
  }
  const haystack = `${appt.AppointmentServiceName || ''} ${appt.AppointmentServiceCategory || ''} ${appt.AppointmentPractionerName || ''}`.toLowerCase().trim();
  if (!haystack) return false;
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
    assignedTo: a.assignedTo || null,
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

app.post('/api/register', loginLimiter, async (req, res) => {
  const { username, password, name } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Please provide Name, Username, and Password' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }
  try {
    const user = await partners.registerUser({ username, password, name });
    req.session.user = user;
    res.json({ ok: true, username: user.username, name: user.name });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/forgot-password', loginLimiter, async (req, res) => {
  const { username, newPassword } = req.body || {};
  if (!username || !newPassword) {
    return res.status(400).json({ error: 'Please provide Username and New Password' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long' });
  }
  try {
    await partners.resetPassword(username, newPassword);
    res.json({ ok: true, message: 'Password updated successfully. Please sign in.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null, liveMode: clinicea.isLiveMode() });
});

// ---------- Dashboard data (reads from the store, kept in sync by webhooks) ----------
// Every physiotherapy appointment is visible to every logged-in partner-team member --
// the partner company (not this app) decides internally who covers each home visit, via
// the assignment endpoint below. There is no per-patient access restriction here.

// seedStoreIfEmpty() only ever pulls from Clinicea once, the very first time the store is
// empty -- after that it relied entirely on webhooks to learn about new/changed appointments.
// Since webhooks require a public URL registered in Clinicea (not set up until this is
// deployed), an appointment added directly in Clinicea's Calendar had no way to reach the
// dashboard at all. This re-pulls the viewed date from Clinicea on every read instead,
// throttled per-date so the 4s dashboard poll doesn't hammer the Clinicea API.
const lastLiveFetch = new Map(); // date -> timestamp ms
const LIVE_REFRESH_INTERVAL_MS = 15 * 1000;

async function refreshDateFromClinieaIfDue(date) {
  if (!clinicea.isLiveMode()) return;
  const last = lastLiveFetch.get(date) || 0;
  if (Date.now() - last < LIVE_REFRESH_INTERVAL_MS) return;
  lastLiveFetch.set(date, Date.now());
  try {
    const fresh = await clinicea.getAppointmentsByDate(date);
    for (const a of fresh) {
      await store.upsertAppointment(a);
    }
  } catch (err) {
    console.error(`[refresh] failed to pull ${date} from Clinicea:`, err.message);
  }
}

app.get('/api/appointments', requireAuth, async (req, res) => {
  await seedStoreIfEmpty();
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  await refreshDateFromClinieaIfDue(date);
  const dayAppointments = await store.getByDate(date);
  const visible = dayAppointments.filter(isPhysioAppointment).map(toView);
  res.json({ date, liveMode: clinicea.isLiveMode(), appointments: visible });
});

// The partner team roster, so the dashboard can offer "assign to ___" options.
app.get('/api/team', requireAuth, async (req, res) => {
  const team = await partners.listTeam();
  res.json({ team });
});

// ---------- Patient lookup by Clinicea unique ID ----------
// Deliberately returns only a curated field set (name, mobile, address, blood group,
// allergies, notes) -- whatever else Clinicea's patient record contains is never sent to
// the client, regardless of what the underlying API call returns. This is the actual
// access-control boundary for this feature, since Clinicea's own Role permissions don't
// reliably restrict the API (confirmed empirically -- see conversation).
function toPatientLookupView(p) {
  return {
    id: p.PatientID,
    name: p.Name,
    mobile: p.Mobile,
    address: p.Address,
    bloodGroup: p.BloodGroup,
    allergies: p.Allergies,
    notes: p.Notes,
  };
}

app.get('/api/patients/lookup', requireAuth, patientLookupLimiter, async (req, res) => {
  const id = (req.query.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id is required' });
  try {
    const patient = await clinicea.getPatientByUniqueId(id);
    console.log(`[patient-lookup] user=${req.session.user.username} id=${id} found=${Boolean(patient)}`);
    if (!patient) return res.status(404).json({ error: 'No patient found for that ID' });
    res.json({ patient: toPatientLookupView(patient) });
  } catch (err) {
    console.error('[patient-lookup] error', err);
    res.status(502).json({ error: `Lookup failed: ${err.message}` });
  }
});

app.put('/api/appointments/:id/assign', requireAuth, async (req, res) => {
  const { assignedTo } = req.body || {};
  if (assignedTo !== null && typeof assignedTo !== 'string') {
    return res.status(400).json({ error: 'assignedTo must be a username string or null' });
  }
  if (assignedTo) {
    const team = await partners.listTeam();
    if (!team.some((t) => t.username === assignedTo)) {
      return res.status(400).json({ error: 'Unknown team member' });
    }
  }
  const updated = await store.setAssignedTo(req.params.id, assignedTo);
  if (!updated) return res.status(404).json({ error: 'Appointment not found' });
  res.json({ ok: true, assignedTo: updated.assignedTo || null });
});

app.put('/api/appointments/:id/notes', requireAuth, async (req, res) => {
  const { notes } = req.body || {};
  if (typeof notes !== 'string') return res.status(400).json({ error: 'notes must be a string' });

  const all = await store.getAll();
  const existing = all.find((a) => a.AppointmentID === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Appointment not found' });

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
  const DEMO_PATIENTS = [
    { id: 'pat-501', name: 'Anitha Kumar', mobile: '9876500001', address1: '12 Lake View Road', pcode: '560034' },
    { id: 'pat-503', name: 'Salma Farooq', mobile: '9876500003', address1: '7 Palm Grove Apartments', pcode: '560068' },
    { id: 'pat-sim-' + crypto.randomBytes(2).toString('hex'), name: 'New Walk-in Patient', mobile: '9876500099', address1: '221B Residency Road', pcode: '560025' },
  ];

  app.post('/api/dev/simulate-booking', requireAuth, async (req, res) => {
    await seedStoreIfEmpty();
    const { source } = req.body || {};
    const patient = DEMO_PATIENTS[Math.floor(Math.random() * DEMO_PATIENTS.length)];
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
      PatientID: patient.id,
      PatientName: patient.name,
      PatientMobileNo: patient.mobile,
      Address1: patient.address1,
      City: 'Bengaluru',
      PCode: patient.pcode,
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
