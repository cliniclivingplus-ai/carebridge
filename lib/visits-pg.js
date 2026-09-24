const crypto = require('crypto');
const { getPool } = require('./db');

function getPatternDays(pattern) {
  const p = (pattern || 'MWF').toUpperCase();
  if (p === 'TTS') return [2, 4, 6];
  if (p === 'DAILY') return [0, 1, 2, 3, 4, 5, 6];
  if (p === 'WEEKDAYS') return [1, 2, 3, 4, 5];
  return [1, 3, 5]; // Default Mon / Wed / Fri
}

function calculateVisitDates(startDateStr, totalSessions, pattern) {
  const allowedDays = getPatternDays(pattern);
  const dates = [];
  let curr = new Date(startDateStr ? `${startDateStr}T00:00:00` : new Date());

  while (dates.length < totalSessions) {
    const dayOfWeek = curr.getDay();
    if (allowedDays.includes(dayOfWeek)) {
      dates.push(curr.toISOString().split('T')[0]);
    }
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

async function createVisitSchedule({
  caseId,
  patientId,
  patientName = 'Unknown Patient',
  patientMobile = '',
  address = '',
  allottedSessions = 10,
  startDate = '',
  startTime = '10:00',
  pattern = 'MWF',
  assignedPhysio = null,
  createdBy = 'sales_user',
}) {
  const pool = getPool();
  const dates = calculateVisitDates(startDate, allottedSessions, pattern);
  const newVisits = [];

  for (let i = 0; i < dates.length; i++) {
    const id = `VISIT-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const initialHistory = [
      {
        step: 'scheduled',
        timestamp: new Date().toISOString(),
        user: createdBy,
        note: `Schedule created for ${dates[i]} at ${startTime} (${pattern})`,
      },
    ];

    const { rows } = await pool.query(
      `INSERT INTO visits (id, case_id, patient_id, patient_name, patient_mobile, address, visit_number, scheduled_date, scheduled_time, duration_minutes, assigned_physio, status, status_history)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 45, $10, 'scheduled', $11)
       RETURNING *`,
      [
        id,
        caseId,
        patientId,
        patientName,
        patientMobile,
        address,
        i + 1,
        dates[i],
        startTime,
        assignedPhysio ? assignedPhysio.trim() : null,
        JSON.stringify(initialHistory),
      ]
    );

    newVisits.push(mapVisit(rows[0]));
  }

  return newVisits;
}

async function listVisitsForCase(caseId) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM visits WHERE case_id = $1 ORDER BY visit_number ASC',
    [caseId]
  );
  return rows.map(mapVisit);
}

async function listVisitsForPhysio(username, dateStr) {
  const pool = getPool();
  const targetDate = dateStr || new Date().toISOString().split('T')[0];
  const params = [targetDate];

  let sql = 'SELECT * FROM visits WHERE scheduled_date = $1';
  if (username) {
    params.push(username);
    sql += ' AND assigned_physio = $2';
  }

  sql += ' ORDER BY scheduled_time ASC';
  const { rows } = await pool.query(sql, params);
  const filtered = rows.map(mapVisit);

  for (let i = 0; i < filtered.length; i++) {
    filtered[i].overlapWarning = false;
    if (i > 0) {
      const prevTime = filtered[i - 1].scheduledTime;
      const currTime = filtered[i].scheduledTime;
      if (prevTime && currTime) {
        const prevMins = parseInt(prevTime.split(':')[0], 10) * 60 + parseInt(prevTime.split(':')[1], 10);
        const currMins = parseInt(currTime.split(':')[0], 10) * 60 + parseInt(currTime.split(':')[1], 10);
        if (currMins - prevMins < 45) {
          filtered[i].overlapWarning = true;
          filtered[i - 1].overlapWarning = true;
        }
      }
    }
  }

  return filtered;
}

async function updateVisitStep(visitId, { step, username, coords, reason }) {
  const pool = getPool();
  const { rows: existingRows } = await pool.query('SELECT * FROM visits WHERE id = $1', [visitId]);
  if (existingRows.length === 0) throw new Error('Visit not found');

  const visit = mapVisit(existingRows[0]);
  const history = visit.statusHistory || [];
  history.push({
    step,
    timestamp: new Date().toISOString(),
    user: username,
    coords: coords || null,
    reason: reason || null,
  });

  let cancelReason = visit.cancellationReason;
  let reschReason = visit.rescheduleReason;
  if (reason) {
    if (step === 'cancelled') cancelReason = reason;
    if (step === 'rescheduled') reschReason = reason;
  }

  const { rows: updatedRows } = await pool.query(
    `UPDATE visits SET status = $2, status_history = $3, cancellation_reason = $4, reschedule_reason = $5, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [visitId, step, JSON.stringify(history), cancelReason, reschReason]
  );

  return mapVisit(updatedRows[0]);
}

async function requestReschedule(visitId, { newDate, newTime, reason, username }) {
  const pool = getPool();
  const { rows: existingRows } = await pool.query('SELECT * FROM visits WHERE id = $1', [visitId]);
  if (existingRows.length === 0) throw new Error('Visit not found');

  const visit = mapVisit(existingRows[0]);
  const history = visit.statusHistory || [];
  const reqObj = {
    newDate,
    newTime,
    reason,
    requestedBy: username,
    requestedAt: new Date().toISOString(),
  };

  history.push({
    step: 'reschedule_requested',
    timestamp: new Date().toISOString(),
    user: username,
    note: `Reschedule requested for ${newDate} at ${newTime}: ${reason}`,
  });

  const { rows: updatedRows } = await pool.query(
    `UPDATE visits SET status = 'reschedule_requested', reschedule_request = $2, status_history = $3, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [visitId, JSON.stringify(reqObj), JSON.stringify(history)]
  );

  return mapVisit(updatedRows[0]);
}

async function assignVisitsToPhysio(caseId, physioUsername) {
  const pool = getPool();
  const assigned = physioUsername ? physioUsername.trim() : null;
  const { rowCount } = await pool.query(
    'UPDATE visits SET assigned_physio = $2, updated_at = now() WHERE case_id = $1',
    [caseId, assigned]
  );
  return rowCount;
}

function mapVisit(row) {
  if (!row) return null;
  return {
    id: row.id,
    caseId: row.case_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientMobile: row.patient_mobile || '',
    address: row.address || '',
    visitNumber: row.visit_number,
    scheduledDate: typeof row.scheduled_date === 'string' ? row.scheduled_date : row.scheduled_date.toISOString().split('T')[0],
    scheduledTime: row.scheduled_time || '10:00',
    durationMinutes: row.duration_minutes || 45,
    assignedPhysio: row.assigned_physio || null,
    status: row.status || 'scheduled',
    statusHistory: typeof row.status_history === 'string' ? JSON.parse(row.status_history) : (row.status_history || []),
    cancellationReason: row.cancellation_reason || null,
    rescheduleReason: row.reschedule_reason || null,
    rescheduleRequest: typeof row.reschedule_request === 'string' ? JSON.parse(row.reschedule_request) : (row.reschedule_request || null),
    cliniceaAppointmentId: row.clinicea_appointment_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createVisitSchedule,
  listVisitsForCase,
  listVisitsForPhysio,
  updateVisitStep,
  requestReschedule,
  assignVisitsToPhysio,
};
