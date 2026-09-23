const filePlans = require('./plans');
const { getPool } = require('./db');

// Postgres table fallback to file-store interface
async function getPlan(patientId) {
  try {
    const pool = getPool();
    const key = String(patientId).toUpperCase().trim();
    const { rows } = await pool.query('SELECT * FROM patient_plans WHERE patient_id = $1', [key]);
    if (!rows[0]) return filePlans.getPlan(key);
    const plan = rows[0];
    const allotted = Number(plan.allotted_sessions) || 5;
    const completed = Number(plan.completed_sessions) || 0;
    return {
      patientId: key,
      allottedSessions: allotted,
      completedSessions: completed,
      remainingSessions: Math.max(0, allotted - completed),
      history: plan.history || [],
      updatedAt: plan.updated_at,
    };
  } catch (e) {
    return filePlans.getPlan(patientId);
  }
}

async function updateAllotted(patientId, allottedSessions, updatedBy) {
  try {
    const pool = getPool();
    const key = String(patientId).toUpperCase().trim();
    const num = parseInt(allottedSessions, 10);
    if (isNaN(num) || num < 1) throw new Error('Allotted sessions must be a positive number');

    await pool.query(
      `CREATE TABLE IF NOT EXISTS patient_plans (
         patient_id TEXT PRIMARY KEY,
         allotted_sessions INT NOT NULL DEFAULT 5,
         completed_sessions INT NOT NULL DEFAULT 0,
         history JSONB NOT NULL DEFAULT '[]'::jsonb,
         updated_by TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`
    );

    const { rows } = await pool.query(
      `INSERT INTO patient_plans (patient_id, allotted_sessions, updated_by, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (patient_id) DO UPDATE SET allotted_sessions = EXCLUDED.allotted_sessions, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [key, num, updatedBy || 'system']
    );

    return getPlan(key);
  } catch (e) {
    return filePlans.updateAllotted(patientId, allottedSessions, updatedBy);
  }
}

async function recordSessionFeedback(patientId, feedbackData, loggedBy) {
  try {
    const pool = getPool();
    const key = String(patientId).toUpperCase().trim();
    const current = await getPlan(key);

    const newCompleted = current.completedSessions + 1;
    const feedbackEntry = {
      id: `fb-${Date.now()}`,
      sessionNumber: newCompleted,
      totalAllotted: current.allottedSessions,
      painLevel: feedbackData.painLevel,
      mobilityStatus: feedbackData.mobilityStatus,
      exercisesCompleted: feedbackData.exercisesCompleted,
      patientCompliance: feedbackData.patientCompliance,
      clinicalNotes: feedbackData.clinicalNotes,
      loggedBy: loggedBy || 'external_physio',
      timestamp: new Date().toISOString(),
    };

    const newHistory = [feedbackEntry, ...(current.history || [])];

    await pool.query(
      `INSERT INTO patient_plans (patient_id, allotted_sessions, completed_sessions, history, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (patient_id) DO UPDATE SET completed_sessions = EXCLUDED.completed_sessions, history = EXCLUDED.history, updated_at = now()`,
      [key, current.allottedSessions, newCompleted, JSON.stringify(newHistory), loggedBy || 'external_physio']
    );

    return { plan: await getPlan(key), feedbackEntry };
  } catch (e) {
    return filePlans.recordSessionFeedback(patientId, feedbackData, loggedBy);
  }
}

module.exports = { getPlan, updateAllotted, recordSessionFeedback };
