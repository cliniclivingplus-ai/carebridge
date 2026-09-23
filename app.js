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
const notifications = require('./lib/notifications');
const { normalizeAppointment } = require('./lib/webhook-normalize');

// Postgres (Vercel Postgres) when DATABASE_URL is set; local JSON-file store otherwise.
const store = db.isConfigured() ? require('./lib/store-pg') : require('./lib/store');
const partners = db.isConfigured() ? require('./lib/partners-pg') : require('./lib/partners');
const plans = db.isConfigured() ? require('./lib/plans-pg') : require('./lib/plans');

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
  try {
    const pgSession = require('connect-pg-simple')(session);
    sessionConfig.store = new pgSession({ pool: db.getPool(), tableName: 'session', createTableIfMissing: true });
  } catch (err) {
    console.error('[session] Postgres session store setup failed, using memory store:', err.message);
  }
}

app.use(session(sessionConfig));

if (process.env.NODE_ENV === 'production') {
  const missing = [];
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (!process.env.WEBHOOK_SECRET) missing.push('WEBHOOK_SECRET');
  if (missing.length) {
    console.warn(`[warning] Missing recommended production env var(s): ${missing.join(', ')}`);
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
  const serviceName = (appt.AppointmentServiceName || '').trim();
  const serviceCat = (appt.AppointmentServiceCategory || '').trim();
  // If Clinicea did not specify a service category, include it by default so home visits aren't hidden
  if (!serviceName && !serviceCat) {
    return true;
  }
  const haystack = `${serviceName} ${serviceCat} ${appt.AppointmentPractionerName || ''}`.toLowerCase().trim();
  return PHYSIO_FILTER.some((term) => haystack.includes(term));
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    const role = req.session.user.role || 'external_physio';
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: `Access denied. Only ${allowedRoles.join(', ')} users can perform this action.` });
    }
    next();
  };
}

async function toView(a) {
  const planInfo = a.PatientID ? await plans.getPlan(a.PatientID) : null;
  return {
    id: a.AppointmentID,
    start: a.AppointmentStartDateTime,
    end: a.AppointmentEndDateTime,
    service: a.AppointmentServiceName,
    practitioner: a.AppointmentPractionerName,
    patientId: a.PatientID,
    patientName: a.PatientName,
    patientMobile: a.PatientMobileNo,
    address: [a.Address1, a.City, a.PCode].filter(Boolean).join(', '),
    notes: a.notes || '',
    notesSyncStatus: a.notesSyncStatus || 'synced',
    source: a.source || 'clinicea',
    assignedTo: a.assignedTo || null,
    patientPlan: planInfo,
  };
}

// The clinic/team operate in India; the front-end always sends an explicit local (IST) date,
// but these server-side fallbacks only run when no date is given at all (e.g. raw API testing,
// or the very first seed). Compute "today" in IST rather than the server's own timezone
// (UTC on Vercel) so the fallback doesn't disagree with what "today" means for actual users.
function todayInIndia() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // en-CA => YYYY-MM-DD
}

let seedPromise = null;
// Seed the store on first run so there's something to show before any webhook has fired.
// Guarded by a module-level promise so concurrent cold-start invocations don't race each other.
function seedStoreIfEmpty() {
  if (!seedPromise) {
    seedPromise = (async () => {
      if (await store.isEmpty()) {
        const seedData = clinicea.isLiveMode()
          ? await clinicea.getAppointmentsByDate(todayInIndia()).catch(() => [])
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
  res.json({ ok: true, username: user.username, name: user.name, role: user.role });
});

// Create New Team Member (Sales Team & CLP Doctor only)
app.post('/api/team', requireAuth, requireRole(['sales', 'clp_doctor']), async (req, res) => {
  const { username, password, name, role, email, phone } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'Please provide Name, Username, and Password' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }
  const ALLOWED_ROLES = ['sales', 'clp_doctor', 'external_physio'];
  const targetRole = role || 'external_physio';
  if (!ALLOWED_ROLES.includes(targetRole)) {
    return res.status(400).json({ error: 'Invalid role. Must be sales, clp_doctor, or external_physio' });
  }
  try {
    const user = await partners.registerUser({ username, password, name, role: targetRole, email, phone });
    res.json({ ok: true, user });
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

// Update Profile Details (Name, Email, Phone)
app.put('/api/me/profile', requireAuth, async (req, res) => {
  const { name, email, phone } = req.body || {};
  try {
    const updated = await partners.updateProfile(req.session.user.username, { name, email, phone });
    req.session.user.name = updated.name;
    res.json({ ok: true, user: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Change Password
app.put('/api/me/password', requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  try {
    await partners.changePassword(req.session.user.username, oldPassword, newPassword);
    res.json({ ok: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Current Account
app.delete('/api/me', requireAuth, async (req, res) => {
  const username = req.session.user.username;
  try {
    await partners.deleteAccount(username);
    req.session.destroy(() => res.json({ ok: true, message: 'Account deleted successfully' }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update Specific Team Account (Sales & Doctor only)
app.put('/api/team/:username', requireAuth, requireRole(['sales', 'clp_doctor']), async (req, res) => {
  const targetUsername = req.params.username;
  const { name, email, phone, role, password } = req.body || {};

  const ALLOWED_ROLES = ['sales', 'clp_doctor', 'external_physio'];
  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be sales, clp_doctor, or external_physio' });
  }
  if (password && password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }
  if (targetUsername === req.session.user.username && role && role !== req.session.user.role) {
    return res.status(400).json({ error: 'You cannot demote or change your own active role.' });
  }

  try {
    const updated = await partners.updateTeamMember(targetUsername, { name, email, phone, role, password });
    res.json({ ok: true, user: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete Specific Team Account (Sales & Doctor only)
app.delete('/api/team/:username', requireAuth, requireRole(['sales', 'clp_doctor']), async (req, res) => {
  const targetUsername = req.params.username;
  if (targetUsername === req.session.user.username) {
    return res.status(400).json({ error: 'You cannot delete your own active account from Team Manager.' });
  }
  try {
    await partners.deleteAccount(targetUsername);
    res.json({ ok: true, message: `Account ${targetUsername} deleted successfully` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  const date = req.query.date || todayInIndia();
  const viewMode = req.query.view || 'enrolled'; // 'enrolled' (default) or 'all'
  await refreshDateFromClinieaIfDue(date);
  const dayAppointments = await store.getByDate(date);
  let visible = await Promise.all(dayAppointments.filter(isPhysioAppointment).map(toView));

  if (viewMode === 'enrolled') {
    visible = visible.filter((a) => a.patientPlan && a.patientPlan.enrolled);
  }

  res.json({ date, liveMode: clinicea.isLiveMode(), appointments: visible });
});

// The partner team roster, so the dashboard can offer "assign to ___" options.
app.get('/api/team', requireAuth, async (req, res) => {
  const team = await partners.listTeam();
  res.json({ team });
});

// ---------- New-booking notifications (email/SMS), any date -- "next month" included ----------
// Uses appointments/getChanges rather than getAppointmentsByDate: confirmed empirically that
// getChanges returns appointments for ANY date since a given sync time (tagged Added/Modified/
// Deleted), not just one day -- exactly what's needed to catch a booking made far in the future
// without scanning every future date one at a time.

async function scanForNewBookings() {
  // clinicea.getAppointmentChangesSince() already returns mock.getAppointmentChangesSince()
  // when not live, so this runs the same code path in demo mode too -- useful for testing
  // the notify pipeline without a real key.
  const lastSync = (await store.getSyncState('appointments_last_sync')) || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const changes = await clinicea.getAppointmentChangesSince(lastSync);
  let notifiedCount = 0;

  for (const change of changes) {
    if (change.dataStatus === 'Deleted') {
      await store.markDeleted(change.AppointmentID);
      continue;
    }
    const saved = await store.upsertAppointment(change);
    // Deliberately NOT limited to dataStatus === 'Added': confirmed against real data that
    // an appointment edited shortly after creation shows as "Modified" by the time we scan,
    // so Clinicea's own tag isn't reliable for "is this new to us." notifiedNewBooking (our
    // own per-appointment flag) is the actual dedupe -- first time we've ever seen this
    // physio appointment, regardless of what Clinicea currently calls it.
    const isNewPhysioBooking = isPhysioAppointment(change) && !saved.notifiedNewBooking;
    if (isNewPhysioBooking) {
      const team = await partners.listTeam();
      await notifications.notifyTeamOfNewBooking(team, await toView(saved));
      await store.markNotified(change.AppointmentID);
      notifiedCount += 1;
      console.log(`[scan] notified team of new booking ${change.AppointmentID} (${change.PatientName || 'unknown patient'})`);
    }
  }

  await store.setSyncState('appointments_last_sync', nowIso);
  return { checked: changes.length, notified: notifiedCount };
}

// For Vercel Cron (see vercel.json) -- guarded by a shared secret since cron endpoints are
// public URLs otherwise. Run this every few minutes in production.
app.get('/api/cron/scan-new-bookings', async (req, res) => {
  const configured = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const isBearerMatch = authHeader && authHeader === `Bearer ${configured}`;
  const isCustomMatch = req.headers['x-cron-secret'] === configured;
  if (configured && !isBearerMatch && !isCustomMatch) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const result = await scanForNewBookings();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[scan] failed:', err);
    res.status(502).json({ error: err.message });
  }
});

// Manual trigger for logged-in users -- useful before Vercel Cron is set up, or to force an
// immediate check rather than waiting for the schedule.
app.post('/api/scan-now', requireAuth, async (req, res) => {
  try {
    const result = await scanForNewBookings();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
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
    const view = toPatientLookupView(patient);
    const planInfo = await plans.getPlan(id || patient.PatientID);
    res.json({ patient: view, patientPlan: planInfo });
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
    res.json({ ok: true, notesSyncStatus: 'failed', warning: `Saved in CareBridge. Clinicea API sync failed: ${err.message}` });
  }
});

// GET /api/patients/plan/:patientId
app.get('/api/patients/plan/:patientId', requireAuth, async (req, res) => {
  const planInfo = await plans.getPlan(req.params.patientId);
  res.json({ plan: planInfo });
});

// POST /api/patients/plan/:patientId (Restricted to Sales & CLP Doctor!)
app.post('/api/patients/plan/:patientId', requireAuth, requireRole(['sales', 'clp_doctor']), async (req, res) => {
  const { allottedSessions, assignedPhysio, notes } = req.body || {};
  try {
    const updatedPlan = await plans.updateAllotted(req.params.patientId, allottedSessions, assignedPhysio, notes, req.session.user.username);
    res.json({ ok: true, plan: updatedPlan });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/appointments/:id/feedback (Structured Physio Feedback & Clinicea Sync)
app.post('/api/appointments/:id/feedback', requireAuth, requireRole(['external_physio', 'clp_doctor']), async (req, res) => {
  const { painLevel, mobilityStatus, exercisesCompleted, patientCompliance, clinicalNotes } = req.body || {};

  const all = await store.getAll();
  const existing = all.find((a) => a.AppointmentID === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Appointment not found' });
  if (!existing.PatientID || existing.PatientID === 'UNASSIGNED') {
    return res.status(400).json({ error: 'Cannot record feedback: Appointment has no linked patient' });
  }

  const currentPlan = await plans.getPlan(existing.PatientID);
  if (!currentPlan.enrolled || currentPlan.allottedSessions <= 0) {
    return res.status(400).json({ error: 'Cannot record feedback: Patient is not enrolled in a session plan' });
  }
  if (currentPlan.completedSessions >= currentPlan.allottedSessions) {
    return res.status(400).json({ error: `All allotted sessions (${currentPlan.allottedSessions}) for this patient are already completed` });
  }

  // Prevent duplicate feedback submission for the same appointment ID
  if (existing.feedbackLogged || (existing.notes && existing.notes.includes('[PhysioWay Feedback'))) {
    return res.status(400).json({ error: 'Visit feedback has already been recorded for this appointment' });
  }

  const feedbackData = {
    painLevel: painLevel || 'N/A',
    mobilityStatus: mobilityStatus || 'N/A',
    exercisesCompleted: exercisesCompleted || 'None specified',
    patientCompliance: patientCompliance || 'N/A',
    clinicalNotes: clinicalNotes || '',
  };

  const { plan: updatedPlan, feedbackEntry } = await plans.recordSessionFeedback(existing.PatientID, feedbackData, req.session.user.username);

  const formattedNote = `[PhysioWay Feedback - Session ${feedbackEntry.sessionNumber} of ${feedbackEntry.totalAllotted}] Pain: ${feedbackData.painLevel}/10 | Mobility: ${feedbackData.mobilityStatus} | Compliance: ${feedbackData.patientCompliance} | Exercises: ${feedbackData.exercisesCompleted} | Notes: ${feedbackData.clinicalNotes}`.trim();

  await store.setNotes(req.params.id, formattedNote, 'pending');

  try {
    await clinicea.updateAppointmentNotes(req.params.id, formattedNote);
    const updated = await store.setNotes(req.params.id, formattedNote, 'synced');
    res.json({ ok: true, notesSyncStatus: 'synced', plan: updatedPlan, note: formattedNote });
  } catch (err) {
    await store.setNotes(req.params.id, formattedNote, 'failed');
    res.json({ ok: true, notesSyncStatus: 'failed', warning: `Saved in CareBridge. Clinicea API sync failed: ${err.message}`, plan: updatedPlan, note: formattedNote });
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
      const saved = await store.upsertAppointment(appt);
      // Once webhooks are live this fires instantly instead of waiting for the cron scan --
      // same notified_new_booking flag means whichever path notices it first "wins", no
      // double notification if the cron also picks it up on the same appointment.
      if (eventType === 'add' && isPhysioAppointment(appt) && !saved.notifiedNewBooking) {
        const team = await partners.listTeam();
        const viewObj = await toView(saved);
        notifications.notifyTeamOfNewBooking(team, viewObj).catch((err) =>
          console.error('[webhook] notify failed:', err.message)
        );
        await store.markNotified(appt.AppointmentID);
      }
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
    res.json({ ok: true, appointment: await toView(saved) });
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

// Vercel's Express detection may load this file directly as the function entry, which requires
// the default export to be the app itself. The named properties keep `const { app } = require('./app')`
// working for server.js and api/index.js.
module.exports = app;
module.exports.app = app;
module.exports.seedStoreIfEmpty = seedStoreIfEmpty;
module.exports.DEMO_MODE = DEMO_MODE;
