const crypto = require('crypto');
const { getPool } = require('./db');
const clinicea = require('./clinicea-client');

async function createCase({
  patientId,
  patientName,
  patientMobile = '',
  address = '',
  city = '',
  pcode = '',
  symptomsConcern = '',
  allottedSessions = 10,
  createdBy,
  instructions = '',
}) {
  const pool = getPool();
  const id = `CASE-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const { rows } = await pool.query(
    `INSERT INTO cases (id, patient_id, patient_name, patient_mobile, address, city, pcode, symptoms_concern, allotted_sessions, completed_sessions, created_by, status, instructions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, 'open', $11)
     RETURNING *`,
    [
      id,
      (patientId || 'UNASSIGNED').trim(),
      (patientName || 'Unknown Patient').trim(),
      (patientMobile || '').trim(),
      (address || '').trim(),
      (city || '').trim(),
      (pcode || '').trim(),
      (symptomsConcern || '').trim(),
      parseInt(allottedSessions, 10) || 10,
      (createdBy || 'sales_user').trim(),
      (instructions || '').trim(),
    ]
  );

  return mapCase(rows[0], []);
}

async function listCases({ status, physio, query } = {}) {
  const pool = getPool();
  let sql = 'SELECT * FROM cases WHERE 1=1';
  const params = [];

  if (status === 'open') {
    sql += " AND status = 'open'";
  } else if (status === 'mine' && physio) {
    params.push(physio);
    sql += ` AND assigned_physio = $${params.length}`;
  } else if (status === 'completed') {
    sql += " AND status = 'completed'";
  }

  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    const idx = params.length;
    sql += ` AND (LOWER(patient_name) LIKE $${idx} OR LOWER(patient_id) LIKE $${idx} OR LOWER(symptoms_concern) LIKE $${idx} OR LOWER(patient_mobile) LIKE $${idx} OR LOWER(assigned_physio) LIKE $${idx})`;
  }

  sql += ' ORDER BY created_at DESC';

  const { rows: caseRows } = await pool.query(sql, params);
  if (caseRows.length === 0) return [];

  const caseIds = caseRows.map((c) => c.id);
  const { rows: sessionRows } = await pool.query(
    'SELECT * FROM sessions WHERE case_id = ANY($1) ORDER BY session_number ASC',
    [caseIds]
  );

  return caseRows.map((c) => {
    const caseSessions = sessionRows.filter((s) => s.case_id === c.id);
    return mapCase(c, caseSessions);
  });
}

async function getCase(id) {
  const pool = getPool();
  const { rows: caseRows } = await pool.query('SELECT * FROM cases WHERE id = $1 OR patient_id = $1 LIMIT 1', [id]);
  if (caseRows.length === 0) return null;

  const targetCase = caseRows[0];
  const { rows: sessionRows } = await pool.query(
    'SELECT * FROM sessions WHERE case_id = $1 ORDER BY session_number ASC',
    [targetCase.id]
  );

  return mapCase(targetCase, sessionRows);
}

async function claimCase(id, physioUsername) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE cases SET assigned_physio = $2, status = 'in_progress', updated_at = now() WHERE id = $1 RETURNING *`,
    [id, physioUsername.trim()]
  );
  if (rows.length === 0) throw new Error('Case not found');
  return getCase(id);
}

async function assignCase(id, targetPhysioUsername) {
  const pool = getPool();
  const assigned = targetPhysioUsername ? targetPhysioUsername.trim() : null;
  const status = assigned ? 'in_progress' : 'open';

  const { rows } = await pool.query(
    `UPDATE cases SET assigned_physio = $2, status = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, assigned, status]
  );
  if (rows.length === 0) throw new Error('Case not found');
  return getCase(id);
}

async function recordSessionFeedback(caseId, { beforeAssessment, afterSummary, clinicalNotes, physioUsername }) {
  const pool = getPool();
  const targetCase = await getCase(caseId);
  if (!targetCase) throw new Error('Case not found');

  if (targetCase.completedSessions >= targetCase.allottedSessions) {
    throw new Error(`All allotted sessions (${targetCase.allottedSessions}) for this patient are already completed`);
  }

  const nextSessionNumber = targetCase.completedSessions + 1;
  const sessionId = `SESS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const physio = physioUsername || targetCase.assignedPhysio || 'external_physio';
  const notes = clinicalNotes || (afterSummary ? afterSummary.clinicalNotes : '') || '';

  const { rows: sessRows } = await pool.query(
    `INSERT INTO sessions (id, case_id, patient_id, session_number, scheduled_date, physio_username, status, before_assessment, after_summary, clinical_notes, clinicea_sync_status)
     VALUES ($1, $2, $3, $4, now(), $5, 'completed', $6, $7, $8, 'pending')
     RETURNING *`,
    [sessionId, targetCase.id, targetCase.patientId, nextSessionNumber, physio, JSON.stringify(beforeAssessment || {}), JSON.stringify(afterSummary || {}), notes]
  );

  const newCompleted = targetCase.completedSessions + 1;
  const newStatus = newCompleted >= targetCase.allottedSessions ? 'completed' : 'in_progress';
  const assigned = targetCase.assignedPhysio || physio;

  await pool.query(
    `UPDATE cases SET completed_sessions = $2, status = $3, assigned_physio = $4, updated_at = now() WHERE id = $1`,
    [targetCase.id, newCompleted, newStatus, assigned]
  );

  const formattedNote = `[PhysioWay Home-Visit Session ${nextSessionNumber}/${targetCase.allottedSessions}] Physio: ${physio} | Pain (Pre): ${beforeAssessment?.painLevelBefore || 'N/A'}/10 | Pain (Post): ${afterSummary?.painLevelAfter || 'N/A'}/10 | Mobility: ${afterSummary?.mobilityStatus || 'N/A'} | Compliance: ${afterSummary?.patientCompliance || 'N/A'} | Exercises: ${afterSummary?.exercisesCompleted || 'N/A'} | Notes: ${notes}`.trim();

  let syncStatus = 'pending';
  let encounterId = null;

  if (clinicea.isLiveMode()) {
    try {
      const result = await clinicea.addPatientEncounter(targetCase.patientId, formattedNote);
      syncStatus = 'synced';
      encounterId = result?.encounterId || result?.id || 'SYNCED';
    } catch (err) {
      console.warn(`[Clinicea sync] Failed for session ${sessionId}:`, err.message);
      syncStatus = 'failed';
    }
  } else {
    syncStatus = 'synced';
  }

  await pool.query(`UPDATE sessions SET clinicea_sync_status = $2, clinicea_encounter_id = $3 WHERE id = $1`, [
    sessionId,
    syncStatus,
    encounterId,
  ]);

  const updatedSession = mapSession({ ...sessRows[0], clinicea_sync_status: syncStatus, clinicea_encounter_id: encounterId });
  return { case: await getCase(targetCase.id), session: updatedSession };
}

async function retrySessionSync(sessionId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  if (rows.length === 0) throw new Error('Session not found');
  const session = rows[0];

  const parentCase = await getCase(session.case_id);
  const beforeObj = typeof session.before_assessment === 'string' ? JSON.parse(session.before_assessment) : session.before_assessment;
  const afterObj = typeof session.after_summary === 'string' ? JSON.parse(session.after_summary) : session.after_summary;

  const formattedNote = `[PhysioWay Home-Visit Session ${session.session_number}/${parentCase?.allottedSessions || 10}] Physio: ${session.physio_username} | Pain (Pre): ${beforeObj?.painLevelBefore || 'N/A'}/10 | Pain (Post): ${afterObj?.painLevelAfter || 'N/A'}/10 | Mobility: ${afterObj?.mobilityStatus || 'N/A'} | Compliance: ${afterObj?.patientCompliance || 'N/A'} | Exercises: ${afterObj?.exercisesCompleted || 'N/A'} | Notes: ${session.clinical_notes}`.trim();

  let syncStatus = 'pending';
  let encounterId = null;

  if (clinicea.isLiveMode()) {
    try {
      const result = await clinicea.addPatientEncounter(session.patient_id, formattedNote);
      syncStatus = 'synced';
      encounterId = result?.encounterId || result?.id || 'SYNCED';
    } catch (err) {
      syncStatus = 'failed';
      throw err;
    }
  } else {
    syncStatus = 'synced';
  }

  await pool.query(`UPDATE sessions SET clinicea_sync_status = $2, clinicea_encounter_id = $3 WHERE id = $1`, [
    sessionId,
    syncStatus,
    encounterId,
  ]);

  return mapSession({ ...session, clinicea_sync_status: syncStatus, clinicea_encounter_id: encounterId });
}

function mapCase(row, sessionRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientMobile: row.patient_mobile || '',
    address: row.address || '',
    city: row.city || '',
    pcode: row.pcode || '',
    symptomsConcern: row.symptoms_concern || '',
    allottedSessions: row.allotted_sessions || 10,
    completedSessions: row.completed_sessions || 0,
    createdBy: row.created_by,
    assignedPhysio: row.assigned_physio || null,
    status: row.status || 'open',
    instructions: row.instructions || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sessions: sessionRows.map(mapSession),
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    patientId: row.patient_id,
    sessionNumber: row.session_number,
    scheduledDate: row.scheduled_date,
    physioUsername: row.physio_username,
    status: row.status,
    beforeAssessment: typeof row.before_assessment === 'string' ? JSON.parse(row.before_assessment) : (row.before_assessment || {}),
    afterSummary: typeof row.after_summary === 'string' ? JSON.parse(row.after_summary) : (row.after_summary || {}),
    clinicalNotes: row.clinical_notes || '',
    cliniceaSyncStatus: row.clinicea_sync_status || 'pending',
    cliniceaEncounterId: row.clinicea_encounter_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createCase,
  listCases,
  getCase,
  claimCase,
  assignCase,
  recordSessionFeedback,
  retrySessionSync,
};
