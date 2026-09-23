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
    allowedPatientIds: partner.allowedPatientIds || [],
  };
}

// Empty/missing allowedPatientIds means "no restriction" (e.g. an internal-staff account).
function canSeePatient(user, patientId) {
  if (!user.allowedPatientIds || user.allowedPatientIds.length === 0) return true;
  return user.allowedPatientIds.includes(patientId);
}

// The partner team itself decides who does each home visit -- this lists everyone on the
// team so the dashboard can offer them as assignment options. No passwords included.
function listTeam() {
  return loadPartners().map((p) => ({ username: p.username, name: p.name }));
}

module.exports = { findByUsername, verifyLogin, canSeePatient, listTeam };
