// Partner accounts for the file-backed (no DATABASE_URL) mode. Passwords are stored as bcrypt
// hashes (`passwordHash`). A legacy plain-text `password` field is still accepted for local demo
// data, but never in production -- there, an account without a hash simply can't log in.

const fs = require('fs');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

function checkPassword(partner, password) {
  if (!partner || typeof password !== 'string') return false;
  if (partner.passwordHash) return bcrypt.compareSync(password, partner.passwordHash);
  if (!IS_PRODUCTION && typeof partner.password === 'string') return partner.password === password;
  return false;
}

function setPassword(partner, password) {
  partner.passwordHash = bcrypt.hashSync(password.trim(), 10);
  delete partner.password;
}

function getFilePath(filename) {
  const local = path.join(__dirname, '..', 'data', filename);
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const tmp = path.join(os.tmpdir(), filename);
    if (!fs.existsSync(tmp) && fs.existsSync(local)) {
      try { fs.copyFileSync(local, tmp); } catch (e) {}
    }
    return tmp;
  }
  return local;
}

const FILE = getFilePath('partners.json');

function loadPartners() {
  const local = path.join(__dirname, '..', 'data', 'partners.json');
  let target = FILE;
  if (!fs.existsSync(target)) target = local;

  try {
    let list = JSON.parse(fs.readFileSync(target, 'utf8'));
    if ((!Array.isArray(list) || list.length === 0) && fs.existsSync(local)) {
      list = JSON.parse(fs.readFileSync(local, 'utf8'));
      if (target !== local) {
        try { fs.copyFileSync(local, target); } catch (e) {}
      }
    }
    return list;
  } catch (err) {
    if (fs.existsSync(local)) {
      return JSON.parse(fs.readFileSync(local, 'utf8'));
    }
    return [];
  }
}

function findByUsername(username) {
  return loadPartners().find((p) => p.username === username) || null;
}

function verifyLogin(username, password) {
  const partner = findByUsername(username);
  if (!checkPassword(partner, password)) return null;
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
    name: name.trim(),
    role: role || 'external_physio',
    email: (email || '').trim(),
    phone: (phone || '').trim(),
    allowedPatientIds: [],
  };
  setPassword(newUser, password);
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
  setPassword(partner, newPassword);
  fs.writeFileSync(FILE, JSON.stringify(partnersList, null, 2));
  return true;
}

function updateProfile(username, { name, email, phone }) {
  const partnersList = loadPartners();
  const partner = partnersList.find((p) => p.username.toLowerCase() === username.toLowerCase());
  if (!partner) throw new Error('Account not found');

  if (name) partner.name = name.trim();
  if (email !== undefined) partner.email = email.trim();
  if (phone !== undefined) partner.phone = phone.trim();

  fs.writeFileSync(FILE, JSON.stringify(partnersList, null, 2));
  return { username: partner.username, name: partner.name, role: partner.role, email: partner.email, phone: partner.phone };
}

function changePassword(username, oldPassword, newPassword) {
  const partnersList = loadPartners();
  const partner = partnersList.find((p) => p.username.toLowerCase() === username.toLowerCase());
  if (!partner) throw new Error('Account not found');
  if (!checkPassword(partner, oldPassword)) throw new Error('Current password is incorrect');
  if (!newPassword || newPassword.length < 6) throw new Error('New password must be at least 6 characters');

  setPassword(partner, newPassword);
  fs.writeFileSync(FILE, JSON.stringify(partnersList, null, 2));
  return true;
}

function deleteAccount(username) {
  let partnersList = loadPartners();
  const index = partnersList.findIndex((p) => p.username.toLowerCase() === username.toLowerCase());
  if (index === -1) throw new Error('Account not found');

  partnersList.splice(index, 1);
  fs.writeFileSync(FILE, JSON.stringify(partnersList, null, 2));
  return true;
}

function updateTeamMember(username, { name, email, phone, role, password }) {
  const partnersList = loadPartners();
  const partner = partnersList.find((p) => p.username.toLowerCase() === username.toLowerCase());
  if (!partner) throw new Error('Account not found');

  if (name) partner.name = name.trim();
  if (email !== undefined) partner.email = email.trim();
  if (phone !== undefined) partner.phone = phone.trim();
  if (role) partner.role = role.trim();
  if (password) {
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    setPassword(partner, password);
  }

  fs.writeFileSync(FILE, JSON.stringify(partnersList, null, 2));
  return { username: partner.username, name: partner.name, role: partner.role, email: partner.email, phone: partner.phone };
}

module.exports = { findByUsername, verifyLogin, canSeePatient, listTeam, registerUser, resetPassword, updateProfile, changePassword, deleteAccount, updateTeamMember };
