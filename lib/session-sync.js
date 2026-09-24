// Shared by cases.js (file store) and cases-pg.js (Postgres): sends a saved session to Clinicea
// as a PDF report attached to the patient's documents, and decides its sync status.
//
// Statuses:
//   synced    -- the report is attached to the patient in Clinicea
//   failed    -- Clinicea was called and it didn't work (retryable; nothing is left half-done)
//   pending   -- not sent: sync is switched off, or the patient couldn't be found in Clinicea
//   simulated -- demo mode (no API key); nothing was sent anywhere
const clinicea = require('./clinicea-client');
const db = require('./db');
const { buildSessionReport } = require('./session-report');

async function physioDisplayName(username) {
  if (!username) return '';
  try {
    const partners = db.isConfigured() ? require('./partners-pg') : require('./partners');
    const member = (await partners.listTeam()).find((t) => t.username === username);
    return member ? member.name : username;
  } catch {
    return username;
  }
}

function reportFileName(session, parentCase) {
  const date = (session.beforeAssessment && session.beforeAssessment.sessionDate) || new Date().toISOString().slice(0, 10);
  const safeId = String(parentCase.patientId || 'patient').replace(/[^A-Za-z0-9_-]/g, '');
  return `PhysioWay_Session_${session.sessionNumber}_${safeId}_${date}.pdf`;
}

async function syncSession(session, parentCase) {
  if (!clinicea.isLiveMode()) {
    return { status: 'simulated', documentId: null, error: null };
  }
  if (!clinicea.isSessionSyncEnabled()) {
    return { status: 'pending', documentId: null, error: 'Clinicea sync is switched off' };
  }
  if (!parentCase) {
    return { status: 'pending', documentId: null, error: 'Case not found' };
  }

  // Cases enrolled before the internal ID was stored: look it up by File Number.
  let patientGuid = parentCase.cliniceaPatientId;
  if (!patientGuid && parentCase.patientId) {
    const p = await clinicea.getPatientByUniqueId(parentCase.patientId).catch(() => null);
    patientGuid = (p && p.CliniceaPatientID) || '';
  }
  if (!patientGuid) {
    return { status: 'pending', documentId: null, error: 'Patient not found in Clinicea' };
  }

  try {
    const pdf = await buildSessionReport(session, parentCase, await physioDisplayName(session.physioUsername));
    const docDate = session.beforeAssessment && session.beforeAssessment.sessionDate;
    const result = await clinicea.attachPatientDocument(patientGuid, reportFileName(session, parentCase), pdf, docDate);
    return { status: 'synced', documentId: result.documentId, error: null };
  } catch (err) {
    console.warn(`[Clinicea sync] Failed for session ${session.id}:`, err.message);
    return { status: 'failed', documentId: null, error: err.message };
  }
}

module.exports = { syncSession };
