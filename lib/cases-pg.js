const crypto = require('crypto');
const { getPool } = require('./db');
const { syncSession } = require('./session-sync');

async function createCase({
  patientId,
  cliniceaPatientId = '',
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
    `INSERT INTO cases (id, patient_id, clinicea_patient_id, patient_name, patient_mobile, address, city, pcode, symptoms_concern, allotted_sessions, completed_sessions, created_by, status, instructions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, 'open', $12)
     RETURNING *`,
    [
      id,
      String(patientId).trim(),
      (cliniceaPatientId || '').trim(),
      (patientName || 'Unknown Patient').trim(),
      (patientMobile || '').trim(),
      (address || '').trim(),
      (city || '').trim(),
      (pcode || '').trim(),
      (symptomsConcern || '').trim(),
      parseInt(allottedSessions, 10),
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
  } else if (status === 'active') {
    sql += " AND status = 'in_progress'";
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
  const { rows: caseRows } = await pool.query('SELECT * FROM cases WHERE id = $1', [id]);
  if (caseRows.length === 0) return null;

  const targetCase = caseRows[0];
  const { rows: sessionRows } = await pool.query(
    'SELECT * FROM sessions WHERE case_id = $1 ORDER BY session_number ASC',
    [targetCase.id]
  );

  return mapCase(targetCase, sessionRows);
}

// Single conditional UPDATE, so two physios claiming at the same moment can't both win.
async function claimCase(id, physioUsername) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE cases SET assigned_physio = $2, status = 'in_progress', updated_at = now()
     WHERE id = $1 AND status = 'open' AND assigned_physio IS NULL RETURNING id`,
    [id, physioUsername.trim()]
  );
  if (rows.length === 0) {
    const existing = await getCase(id);
    throw new Error(existing ? 'This case has already been claimed' : 'Case not found');
  }
  return getCase(id);
}

async function assignCase(id, targetPhysioUsername) {
  const pool = getPool();
  const assigned = targetPhysioUsername ? targetPhysioUsername.trim() : null;
  const status = assigned ? 'in_progress' : 'open';

  const { rows } = await pool.query(
    `UPDATE cases SET assigned_physio = $2, status = $3, updated_at = now()
     WHERE id = $1 AND status <> 'completed' RETURNING id`,
    [id, assigned, status]
  );
  if (rows.length === 0) {
    const existing = await getCase(id);
    throw new Error(existing ? 'Completed cases cannot be reassigned' : 'Case not found');
  }
  return getCase(id);
}

async function recordSessionFeedback(caseId, { beforeAssessment, afterSummary, clinicalNotes, sessionDate, physioUsername, visitId }) {
  const pool = getPool();
  const client = await pool.connect();
  let caseRow;
  let sessionRow;
  try {
    // Lock the case row so two submissions can't both take the same session number.
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM cases WHERE id = $1 FOR UPDATE', [caseId]);
    caseRow = rows[0];
    if (!caseRow) throw new Error('Case not found');
    if (caseRow.status === 'completed' || caseRow.completed_sessions >= caseRow.allotted_sessions) {
      throw new Error(`All allotted sessions (${caseRow.allotted_sessions}) for this patient are already completed`);
    }

    const nextSessionNumber = caseRow.completed_sessions + 1;
    const sessionId = `SESS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const notes = clinicalNotes || (afterSummary ? afterSummary.clinicalNotes : '') || '';
    const inserted = await client.query(
      `INSERT INTO sessions (id, case_id, patient_id, session_number, scheduled_date, physio_username, status, before_assessment, after_summary, clinical_notes, clinicea_sync_status, visit_id)
       VALUES ($1, $2, $3, $4, COALESCE($9::timestamptz, now()), $5, 'completed', $6, $7, $8, 'pending', $10)
       RETURNING *`,
      [sessionId, caseRow.id, caseRow.patient_id, nextSessionNumber, physioUsername, JSON.stringify(beforeAssessment || {}), JSON.stringify(afterSummary || {}), notes, sessionDate || null, visitId || null]
    );
    sessionRow = inserted.rows[0];

    const newStatus = nextSessionNumber >= caseRow.allotted_sessions ? 'completed' : 'in_progress';
    await client.query(
      `UPDATE cases SET completed_sessions = $2, status = $3, updated_at = now() WHERE id = $1`,
      [caseRow.id, nextSessionNumber, newStatus]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Trigger Clinicea sync in the background so session submission returns instantly to the user
  const session = mapSession(sessionRow);
  const targetCaseObj = mapCase(caseRow);

  syncSession(session, targetCaseObj).then(async (sync) => {
    await pool.query(
      `UPDATE sessions SET clinicea_sync_status = $2, clinicea_sync_error = $3, clinicea_document_id = $4, updated_at = now() WHERE id = $1`,
      [session.id, sync.status, sync.error, sync.documentId]
    ).catch(() => {});
  }).catch((err) => {
    console.warn(`[Clinicea background sync error] session ${session.id}:`, err.message);
  });

  return {
    case: await getCase(caseRow.id),
    session,
  };
}

async function getSession(sessionId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);
  return rows[0] ? mapSession(rows[0]) : null;
}

// Never re-sends a session Clinicea already accepted -- that would create a duplicate encounter.
async function retrySessionSync(sessionId) {
  const pool = getPool();
  const session = await getSession(sessionId);
  if (!session) throw new Error('Session not found');
  if (session.cliniceaSyncStatus === 'synced') return session;

  const parentCase = await getCase(session.caseId);
  const sync = await syncSession(session, parentCase);
  await pool.query(
    `UPDATE sessions SET clinicea_sync_status = $2, clinicea_sync_error = $3, clinicea_document_id = $4, updated_at = now() WHERE id = $1`,
    [sessionId, sync.status, sync.error, sync.documentId]
  );
  return { ...session, cliniceaSyncStatus: sync.status, cliniceaSyncError: sync.error, cliniceaDocumentId: sync.documentId };
}

function mapCase(row, sessionRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    cliniceaPatientId: row.clinicea_patient_id || '',
    patientName: row.patient_name,
    patientMobile: row.patient_mobile || '',
    address: row.address || '',
    city: row.city || '',
    pcode: row.pcode || '',
    symptomsConcern: row.symptoms_concern || '',
    allottedSessions: row.allotted_sessions,
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
    visitId: row.visit_id || null,
    status: row.status,
    beforeAssessment: typeof row.before_assessment === 'string' ? JSON.parse(row.before_assessment) : (row.before_assessment || {}),
    afterSummary: typeof row.after_summary === 'string' ? JSON.parse(row.after_summary) : (row.after_summary || {}),
    clinicalNotes: row.clinical_notes || '',
    cliniceaSyncStatus: row.clinicea_sync_status || 'pending',
    cliniceaSyncError: row.clinicea_sync_error || null,
    cliniceaEncounterId: row.clinicea_encounter_id || null,
    cliniceaDocumentId: row.clinicea_document_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function updateCaseAllotted(id, { allottedSessions, assignedPhysio, instructions }) {
  const pool = getPool();
  const target = await getCase(id);
  if (!target) throw new Error('Case not found');

  let newAllotted = target.allottedSessions;
  if (allottedSessions !== undefined) {
    const count = parseInt(allottedSessions, 10);
    if (!Number.isInteger(count) || count < target.completedSessions || count > 100) {
      throw new Error(`Allotted sessions must be between completed sessions (${target.completedSessions}) and 100`);
    }
    newAllotted = count;
  }

  let newPhysio = target.assignedPhysio;
  if (assignedPhysio !== undefined) {
    newPhysio = assignedPhysio ? assignedPhysio.trim() : null;
  }

  let newInstructions = target.instructions;
  if (instructions !== undefined) {
    newInstructions = (instructions || '').trim();
  }

  let newStatus = target.status;
  if (target.status === 'completed' && newAllotted > target.completedSessions) {
    newStatus = newPhysio ? 'in_progress' : 'open';
  } else if (target.completedSessions >= newAllotted) {
    newStatus = 'completed';
  }

  await pool.query(
    `UPDATE cases SET allotted_sessions = $1, assigned_physio = $2, instructions = $3, status = $4, updated_at = NOW() WHERE id = $5`,
    [newAllotted, newPhysio, newInstructions, newStatus, id]
  );
  return getCase(id);
}

// Removes a case from CareBridge only; its sessions and visits are deleted with it by the
// ON DELETE CASCADE foreign keys. Nothing in Clinicea is touched.
async function deleteCase(id) {
  const { rowCount } = await getPool().query('DELETE FROM cases WHERE id = $1', [id]);
  return rowCount > 0;
}

module.exports = {
  createCase,
  deleteCase,
  listCases,
  getCase,
  claimCase,
  assignCase,
  updateCaseAllotted,
  recordSessionFeedback,
  getSession,
  retrySessionSync,
};

