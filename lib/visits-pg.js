// Postgres storage for home visits. Storage only -- the rules live in lib/visit-service.js.
const { getPool } = require('./db');

function mapVisit(row) {
  if (!row) return null;
  const json = (v, fallback) => (typeof v === 'string' ? JSON.parse(v) : (v ?? fallback));
  return {
    id: row.id,
    caseId: row.case_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientMobile: row.patient_mobile || '',
    address: row.address || '',
    visitNumber: row.visit_number,
    // DATE columns come back as JS Dates at local midnight; format from local parts so the day
    // never shifts (toISOString would move it back a day in any timezone ahead of UTC).
    scheduledDate: typeof row.scheduled_date === 'string'
      ? row.scheduled_date.slice(0, 10)
      : `${row.scheduled_date.getFullYear()}-${String(row.scheduled_date.getMonth() + 1).padStart(2, '0')}-${String(row.scheduled_date.getDate()).padStart(2, '0')}`,
    scheduledTime: row.scheduled_time || '10:00',
    durationMinutes: row.duration_minutes || 45,
    assignedPhysio: row.assigned_physio || null,
    status: row.status || 'scheduled',
    statusHistory: json(row.status_history, []),
    cancellationReason: row.cancellation_reason || null,
    rescheduleReason: row.reschedule_reason || null,
    rescheduleRequest: json(row.reschedule_request, null),
    cliniceaAppointmentId: row.clinicea_appointment_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getVisit(id) {
  const { rows } = await getPool().query('SELECT * FROM visits WHERE id = $1', [id]);
  return mapVisit(rows[0]);
}

async function listVisitsForCase(caseId) {
  const { rows } = await getPool().query('SELECT * FROM visits WHERE case_id = $1 ORDER BY visit_number', [caseId]);
  return rows.map(mapVisit);
}

async function listVisitsForCases(caseIds) {
  if (!caseIds.length) return [];
  const { rows } = await getPool().query('SELECT * FROM visits WHERE case_id = ANY($1) ORDER BY visit_number', [caseIds]);
  return rows.map(mapVisit);
}

async function listVisitsBetween(fromDate, toDate, username) {
  const params = [fromDate, toDate];
  let sql = 'SELECT * FROM visits WHERE scheduled_date BETWEEN $1 AND $2';
  if (username) {
    params.push(username);
    sql += ' AND assigned_physio = $3';
  }
  sql += ' ORDER BY scheduled_date, scheduled_time';
  const { rows } = await getPool().query(sql, params);
  return rows.map(mapVisit);
}

async function insertVisits(newVisits) {
  const pool = getPool();
  for (const v of newVisits) {
    await pool.query(
      `INSERT INTO visits (id, case_id, patient_id, patient_name, patient_mobile, address, visit_number,
         scheduled_date, scheduled_time, duration_minutes, assigned_physio, status, status_history)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [v.id, v.caseId, v.patientId, v.patientName, v.patientMobile, v.address, v.visitNumber,
        v.scheduledDate, v.scheduledTime, v.durationMinutes, v.assignedPhysio, v.status, JSON.stringify(v.statusHistory || [])]
    );
  }
  return newVisits;
}

async function saveVisit(v) {
  const { rows } = await getPool().query(
    `UPDATE visits SET scheduled_date = $2, scheduled_time = $3, assigned_physio = $4, status = $5,
       status_history = $6, cancellation_reason = $7, reschedule_reason = $8, reschedule_request = $9,
       visit_number = $10, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [v.id, v.scheduledDate, v.scheduledTime, v.assignedPhysio, v.status, JSON.stringify(v.statusHistory || []),
      v.cancellationReason, v.rescheduleReason, v.rescheduleRequest ? JSON.stringify(v.rescheduleRequest) : null, v.visitNumber]
  );
  if (!rows[0]) throw new Error('Visit not found');
  return mapVisit(rows[0]);
}

async function deleteVisits(ids) {
  if (!ids.length) return;
  await getPool().query('DELETE FROM visits WHERE id = ANY($1)', [ids]);
}

module.exports = { getVisit, listVisitsForCase, listVisitsForCases, listVisitsBetween, insertVisits, saveVisit, deleteVisits };
