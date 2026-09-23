const { getPool } = require('./db');

function row(a) {
  return {
    AppointmentID: a.appointment_id,
    AppointmentStartDateTime: a.start_datetime,
    AppointmentEndDateTime: a.end_datetime,
    AppointmentServiceName: a.service_name,
    AppointmentServiceCategory: a.service_category,
    AppointmentPractionerName: a.practitioner_name,
    PatientID: a.patient_id,
    PatientName: a.patient_name,
    PatientMobileNo: a.patient_mobile,
    Address1: a.address1,
    City: a.city,
    PCode: a.pcode,
    notes: a.notes,
    notesSyncStatus: a.notes_sync_status,
    source: a.source,
    deleted: a.deleted,
  };
}

async function upsertAppointment(appt) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO appointments (
       appointment_id, start_datetime, end_datetime, service_name, service_category,
       practitioner_name, patient_id, patient_name, patient_mobile, address1, city, pcode,
       notes, source, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (appointment_id) DO UPDATE SET
       start_datetime = EXCLUDED.start_datetime,
       end_datetime = EXCLUDED.end_datetime,
       service_name = EXCLUDED.service_name,
       service_category = EXCLUDED.service_category,
       practitioner_name = EXCLUDED.practitioner_name,
       patient_id = EXCLUDED.patient_id,
       patient_name = EXCLUDED.patient_name,
       patient_mobile = EXCLUDED.patient_mobile,
       address1 = EXCLUDED.address1,
       city = EXCLUDED.city,
       pcode = EXCLUDED.pcode,
       source = EXCLUDED.source,
       updated_at = now()
     RETURNING *`,
    [
      appt.AppointmentID,
      appt.AppointmentStartDateTime,
      appt.AppointmentEndDateTime,
      appt.AppointmentServiceName || '',
      appt.AppointmentServiceCategory || '',
      appt.AppointmentPractionerName || '',
      appt.PatientID,
      appt.PatientName || '',
      appt.PatientMobileNo || '',
      appt.Address1 || '',
      appt.City || '',
      appt.PCode || '',
      appt.notes || '',
      appt.source || 'clinicea',
    ]
  );
  return row(rows[0]);
}

async function markDeleted(appointmentId) {
  const pool = getPool();
  await pool.query('UPDATE appointments SET deleted = true, updated_at = now() WHERE appointment_id = $1', [appointmentId]);
}

async function getAll() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM appointments WHERE deleted = false');
  return rows.map(row);
}

async function getByDate(dateStr) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM appointments WHERE deleted = false AND start_datetime::date = $1::date',
    [dateStr]
  );
  return rows.map(row);
}

async function setNotes(appointmentId, notes, syncStatus) {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE appointments SET notes = $2, notes_sync_status = $3, notes_updated_at = now(), updated_at = now()
     WHERE appointment_id = $1 RETURNING *`,
    [appointmentId, notes, syncStatus]
  );
  if (!rows[0]) return null;
  return row(rows[0]);
}

async function isEmpty() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM appointments');
  return rows[0].count === 0;
}

module.exports = { upsertAppointment, markDeleted, getAll, getByDate, setNotes, isEmpty };
