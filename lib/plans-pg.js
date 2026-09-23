const { getPool } = require('./db');

async function getPlan(patientId) {
  const pool = getPool();
  const key = String(patientId).toUpperCase().trim();
  const { rows } = await pool.query('SELECT * FROM patient_plans WHERE patient_id = $1', [key]);
  if (!rows[0]) {
    return {
      patientId: key,
      enrolled: false,
      allottedSessions: 0,
      completedSessions: 0,
      remainingSessions: 0,
      assignedPhysio: null,
      notes: '',
      history: [],
      updatedAt: null,
    };
  }
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
}

async function updateAllotted(patientId, allottedSessions, assignedPhysio, notes, updatedBy) {
  const pool = getPool();
  const key = String(patientId).toUpperCase().trim();
  const num = parseInt(allottedSessions, 10);
  if (isNaN(num) || num < 1) throw new Error('Allotted sessions must be a positive number');

  const current = await getPlan(key);
  const assigned = assignedPhysio !== undefined ? (assignedPhysio || null) : current.assignedPhysio;
  const planNotes = notes !== undefined ? (notes || '') : current.notes;

  await pool.query(
    `INSERT INTO patient_plans (patient_id, enrolled, allotted_sessions, completed_sessions, assigned_physio, notes, history, updated_by, updated_at)
     VALUES ($1, true, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (patient_id) DO UPDATE SET enrolled = true, allotted_sessions = EXCLUDED.allotted_sessions, assigned_physio = EXCLUDED.assigned_physio, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, num, current.completedSessions || 0, assigned, planNotes, JSON.stringify(current.history || []), updatedBy || 'system']
  );

  return getPlan(key);
}

async function recordSessionFeedback(patientId, feedbackData, loggedBy) {
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
}

module.exports = { getPlan, updateAllotted, recordSessionFeedback };
