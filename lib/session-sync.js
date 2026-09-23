// Shared by cases.js (file store) and cases-pg.js (Postgres): formats a session's feedback as a
// Clinicea note and decides what sync status it ends up with.
//
// Statuses:
//   synced    -- Clinicea accepted the encounter
//   failed    -- Clinicea was called and rejected it / errored (retryable)
//   pending   -- not sent: encounter sync is switched off, or the case has no internal patient ID
//   simulated -- demo mode (no API key); nothing was sent anywhere
const clinicea = require('./clinicea-client');
const questionnaire = require('./feedback-questions.json');

function formatExercise(ex) {
  const dose = [ex.sets && `${ex.sets} set${ex.sets === '1' ? '' : 's'}`, ex.reps && `${ex.reps} reps`].filter(Boolean).join(' x ');
  const extra = [dose, ex.frequency].filter(Boolean).join(', ');
  return extra ? `${ex.name} (${extra})` : ex.name;
}

function formatAnswer(q, value) {
  if (q && q.type === 'scale_0_10') return `${value}/10`;
  if (q && q.type === 'exercise_list') return value.map(formatExercise).join('; ');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

// One "Label: answer" line per answered question, in form order. Answers to questions that are
// no longer in the form (older sessions) are kept, under their stored key.
function formatSessionNote(session, allottedSessions) {
  const lines = [`[PhysioWay Home-Visit Session ${session.sessionNumber}/${allottedSessions || '?'}] Physio: ${session.physioUsername}`];
  for (const section of questionnaire.sections) {
    const answers = session[section.id] || {};
    const known = new Set(section.questions.map((q) => q.id));
    for (const q of section.questions) {
      const v = answers[q.id];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
      lines.push(`${q.label}: ${formatAnswer(q, v)}`);
    }
    for (const [key, v] of Object.entries(answers)) {
      if (!known.has(key) && v !== '' && v !== null && v !== undefined) lines.push(`${key}: ${formatAnswer(null, v)}`);
    }
  }
  return lines.join('\n');
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
