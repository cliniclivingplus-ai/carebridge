// Partner account config: which external users can log in, and which patient(s)
// each one is allowed to see/edit. Plain-text passwords here are demo-only —
// replace with hashed passwords (bcrypt) before any real partner uses this.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'partners.json');

function loadPartners() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function findByUsername(username) {
  return loadPartners().find((p) => p.username === username) || null;
}

function verifyLogin(username, password) {
  const partner = findByUsername(username);
  if (!partner || partner.password !== password) return null;
  return {
    username: partner.username,
    name: partner.name,
    role: partner.role || 'external_physio',
    allowedPatientIds: partner.allowedPatientIds || [],
  };
}

// Empty/missing allowedPatientIds means "no restriction" (e.g. an internal-staff account).
function canSeePatient(user, patientId) {
  if (!user.allowedPatientIds || user.allowedPatientIds.length === 0) return true;
  return user.allowedPatientIds.includes(patientId);
}

// The partner team itself decides who does each home visit -- this lists everyone on the
// team so the dashboard can offer them as assignment options. Includes email/phone/role.
function listTeam() {
  return loadPartners().map((p) => ({ username: p.username, name: p.name, role: p.role || 'external_physio', email: p.email || '', phone: p.phone || '' }));
}

function registerUser({ username, password, name, email, phone, role }) {
  const partnersList = loadPartners();
  if (partnersList.some((p) => p.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('Username is already taken');
  }
  const newUser = {
    username: username.trim(),
    password: password.trim(),
    name: name.trim(),
    role: role || 'external_physio',
    email: (email || '').trim(),
    phone: (phone || '').trim(),
    allowedPatientIds: [],
  };
  partnersList.push(newUser);
  fs.writeFileSync(FILE, JSON.stringify(partnersList, null, 2));
  return { username: newUser.username, name: newUser.name, role: newUser.role, allowedPatientIds: [] };
}

function resetPassword(username, newPassword) {
  const partnersList = loadPartners();
  const partner = partnersList.find((p) => p.username.toLowerCase() === username.toLowerCase());
  if (!partner) {
    throw new Error('Account not found');
  }
  partner.password = newPassword.trim();
  fs.writeFileSync(FILE, JSON.stringify(partnersList, null, 2));
  return true;
}

module.exports = { findByUsername, verifyLogin, canSeePatient, listTeam, registerUser, resetPassword };
