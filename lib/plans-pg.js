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
    const allotted = Number(plan.allotted_sessions) || 0;
    const completed = Number(plan.completed_sessions) || 0;
    return {
      patientId: key,
      enrolled: Boolean(plan.enrolled !== false && allotted > 0),
      allottedSessions: allotted,
      completedSessions: completed,
      remainingSessions: Math.max(0, allotted - completed),
      assignedPhysio: plan.assigned_physio || null,
      notes: plan.notes || '',
      history: plan.history || [],
      updatedAt: plan.updated_at,
    };
  } catch (e) {
    return filePlans.getPlan(patientId);
  }
}

async function updateAllotted(patientId, allottedSessions, assignedPhysio, notes, updatedBy) {
  try {
    return filePlans.updateAllotted(patientId, allottedSessions, assignedPhysio, notes, updatedBy);
  } catch (e) {
    return filePlans.updateAllotted(patientId, allottedSessions, assignedPhysio, notes, updatedBy);
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
