const bcrypt = require('bcryptjs');
const { getPool } = require('./db');

const DEFAULT_PARTNERS = [
  { username: 'sales_user', name: 'Sales Team', role: 'sales', email: 'sales@example.com', phone: '+910000000000' },
  { username: 'dr_ritika', name: 'Dr. Ritika', role: 'clp_doctor', email: 'dr.ritika@example.com', phone: '+910000000099' },
  { username: 'physio_jane', name: 'Jane Fernandes', role: 'external_physio', email: 'jane.demo@example.com', phone: '+910000000001' },
  { username: 'physio_raj', name: 'Raj Malhotra', role: 'external_physio', email: 'raj.demo@example.com', phone: '+910000000002' },
  { username: 'physio_meera', name: 'Meera Nair', role: 'external_physio', email: 'meera.demo@example.com', phone: '+910000000003' },
];

let seededPromise = null;
async function seedDefaultPartnersIfEmpty() {
  if (!seededPromise) {
    seededPromise = (async () => {
      try {
        const pool = getPool();
        const { rows } = await pool.query('SELECT COUNT(*) FROM partners');
        if (parseInt(rows[0].count, 10) === 0) {
          for (const p of DEFAULT_PARTNERS) {
            const passwordHash = await bcrypt.hash('demo123', 10);
            await pool.query(
              `INSERT INTO partners (username, password_hash, name, role, allowed_patient_ids, email, phone)
               VALUES ($1, $2, $3, $4, '[]'::jsonb, $5, $6) ON CONFLICT DO NOTHING`,
              [p.username, passwordHash, p.name, p.role, p.email, p.phone]
            );
          }
        }
      } catch (e) {}
    })();
  }
  return seededPromise;
}

async function findByUsername(username) {
  await seedDefaultPartnersIfEmpty();
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM partners WHERE username = $1', [username]);
  return rows[0] || null;
}

async function verifyLogin(username, password) {
  await seedDefaultPartnersIfEmpty();
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

async function updateProfile(username, { name, email, phone }) {
  const pool = getPool();
  const existing = await findByUsername(username);
  if (!existing) throw new Error('Account not found');

  const newName = name ? name.trim() : existing.name;
  const newEmail = email !== undefined ? email.trim() : existing.email;
  const newPhone = phone !== undefined ? phone.trim() : existing.phone;

  await pool.query(
    `UPDATE partners SET name = $2, email = $3, phone = $4 WHERE username = $1`,
    [username.trim(), newName, newEmail, newPhone]
  );
  return { username: existing.username, name: newName, role: existing.role, email: newEmail, phone: newPhone };
}

async function changePassword(username, oldPassword, newPassword) {
  const pool = getPool();
  const existing = await findByUsername(username);
  if (!existing) throw new Error('Account not found');

  const ok = await bcrypt.compare(oldPassword, existing.password_hash);
  if (!ok) throw new Error('Current password is incorrect');
  if (!newPassword || newPassword.length < 4) throw new Error('New password must be at least 4 characters');

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(`UPDATE partners SET password_hash = $2 WHERE username = $1`, [username.trim(), passwordHash]);
  return true;
}

async function deleteAccount(username) {
  const pool = getPool();
  await pool.query(`DELETE FROM partners WHERE username = $1`, [username.trim()]);
  return true;
}

async function updateTeamMember(username, { name, email, phone, role, password }) {
  const pool = getPool();
  const existing = await findByUsername(username);
  if (!existing) throw new Error('Account not found');

  const newName = name ? name.trim() : existing.name;
  const newEmail = email !== undefined ? email.trim() : existing.email;
  const newPhone = phone !== undefined ? phone.trim() : existing.phone;
  const newRole = role ? role.trim() : (existing.role || 'external_physio');

  if (password) {
    if (password.length < 4) throw new Error('Password must be at least 4 characters');
    const passwordHash = await bcrypt.hash(password.trim(), 10);
    await pool.query(
      `UPDATE partners SET name = $2, email = $3, phone = $4, role = $5, password_hash = $6 WHERE username = $1`,
      [username.trim(), newName, newEmail, newPhone, newRole, passwordHash]
    );
  } else {
    await pool.query(
      `UPDATE partners SET name = $2, email = $3, phone = $4, role = $5 WHERE username = $1`,
      [username.trim(), newName, newEmail, newPhone, newRole]
    );
  }

  return { username: existing.username, name: newName, role: newRole, email: newEmail, phone: newPhone };
}

module.exports = { findByUsername, verifyLogin, canSeePatient, createPartner, listTeam, registerUser, resetPassword, updateProfile, changePassword, deleteAccount, updateTeamMember };
