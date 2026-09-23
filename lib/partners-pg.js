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
    role: partner.role || 'external_physio',
    allowedPatientIds: partner.allowed_patient_ids || [],
  };
}

function canSeePatient(user, patientId) {
  if (!user.allowedPatientIds || user.allowedPatientIds.length === 0) return true;
  return user.allowedPatientIds.includes(patientId);
}

async function listTeam() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT username, name, role, email, phone FROM partners ORDER BY name');
  return rows.map((r) => ({ username: r.username, name: r.name, role: r.role || 'external_physio', email: r.email || '', phone: r.phone || '' }));
}

async function createPartner({ username, password, name, role, allowedPatientIds, email, phone }) {
  const pool = getPool();
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO partners (username, password_hash, name, role, allowed_patient_ids, email, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, role = EXCLUDED.role, allowed_patient_ids = EXCLUDED.allowed_patient_ids, email = EXCLUDED.email, phone = EXCLUDED.phone`,
    [username, passwordHash, name, role || 'external_physio', JSON.stringify(allowedPatientIds || []), email || '', phone || '']
  );
}

async function registerUser({ username, password, name, role, email, phone }) {
  const pool = getPool();
  const existing = await findByUsername(username);
  if (existing) {
    throw new Error('Username is already taken');
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO partners (username, password_hash, name, role, allowed_patient_ids, email, phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [username.trim(), passwordHash, name.trim(), role || 'external_physio', JSON.stringify([]), (email || '').trim(), (phone || '').trim()]
  );
  return { username: username.trim(), name: name.trim(), role: role || 'external_physio', allowedPatientIds: [] };
}

async function resetPassword(username, newPassword) {
  const pool = getPool();
  const existing = await findByUsername(username);
  if (!existing) {
    throw new Error('Account not found');
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    `UPDATE partners SET password_hash = $2 WHERE username = $1`,
    [username.trim(), passwordHash]
  );
  return true;
}

module.exports = { findByUsername, verifyLogin, canSeePatient, createPartner, listTeam, registerUser, resetPassword };
