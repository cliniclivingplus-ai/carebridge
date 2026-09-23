// Shared by cases.js (file store) and cases-pg.js (Postgres): formats a session's feedback as a
// Clinicea note and decides what sync status it ends up with.
//
// Statuses:
//   synced    -- Clinicea accepted the encounter
//   failed    -- Clinicea was called and rejected it / errored (retryable)
//   pending   -- not sent: encounter sync is switched off, or the case has no internal patient ID
//   simulated -- demo mode (no API key); nothing was sent anywhere
const clinicea = require('./clinicea-client');

function formatSessionNote(session, allottedSessions) {
  const before = session.beforeAssessment || {};
  const after = session.afterSummary || {};
  return `[PhysioWay Home-Visit Session ${session.sessionNumber}/${allottedSessions || '?'}] Physio: ${session.physioUsername} | Pain (Pre): ${before.painLevelBefore || 'N/A'}/10 | Pain (Post): ${after.painLevelAfter || 'N/A'}/10 | Mobility: ${after.mobilityStatus || 'N/A'} | Compliance: ${after.patientCompliance || 'N/A'} | Exercises: ${after.exercisesCompleted || 'N/A'} | Notes: ${session.clinicalNotes || ''}`.trim();
}

async function syncSession(session, parentCase) {
  if (!clinicea.isLiveMode()) {
    return { status: 'simulated', encounterId: null, error: null };
  }
  if (!clinicea.isEncounterSyncEnabled()) {
    return { status: 'pending', encounterId: null, error: 'Clinicea encounter sync is not enabled yet' };
  }
  if (!parentCase || !parentCase.cliniceaPatientId) {
    return { status: 'pending', encounterId: null, error: 'Case has no Clinicea internal patient ID' };
  }
  try {
    const note = formatSessionNote(session, parentCase.allottedSessions);
    const result = await clinicea.addPatientEncounter(parentCase.cliniceaPatientId, note, {
      encounterDate: session.scheduledDate,
    });
    return { status: 'synced', encounterId: result.encounterId, error: null };
  } catch (err) {
    console.warn(`[Clinicea sync] Failed for session ${session.id}:`, err.message);
    return { status: 'failed', encounterId: null, error: err.message };
  }
}

module.exports = { formatSessionNote, syncSession };
