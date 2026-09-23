const bcrypt = require('bcryptjs');
const { getPool } = require('./db');

async function findByUsername(username) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM partners WHERE username = $1', [username]);
  return rows[0] || null;
}

async function verifyLogin(username, password) {
  const partner = await findByUsername(username);
  if (!partner) return null;
  const ok = await bcrypt.compare(password, partner.password_hash);
  if (!ok) return null;
  return {
    username: partner.username,
    name: partner.name,
    allowedPatientIds: partner.allowed_patient_ids || [],
  };
}

function canSeePatient(user, patientId) {
  if (!user.allowedPatientIds || user.allowedPatientIds.length === 0) return true;
  return user.allowedPatientIds.includes(patientId);
}

async function createPartner({ username, password, name, allowedPatientIds }) {
  const pool = getPool();
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO partners (username, password_hash, name, allowed_patient_ids)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, allowed_patient_ids = EXCLUDED.allowed_patient_ids`,
    [username, passwordHash, name, JSON.stringify(allowedPatientIds || [])]
  );
}

module.exports = { findByUsername, verifyLogin, canSeePatient, createPartner };
