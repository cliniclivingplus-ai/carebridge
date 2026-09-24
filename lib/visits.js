// File-backed storage for home visits (local dev, no DATABASE_URL). Storage only -- every rule
// about who may do what, and in which order, lives in lib/visit-service.js so the file and
// Postgres versions can't drift apart.
const fs = require('fs');
const path = require('path');
const os = require('os');

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

const VISITS_FILE = getFilePath('visits.json');

function loadVisits() {
  if (!fs.existsSync(VISITS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveVisits(data) {
  fs.writeFileSync(VISITS_FILE, JSON.stringify(data, null, 2));
}

async function getVisit(id) {
  return loadVisits().find((v) => v.id === id) || null;
}

async function listVisitsForCase(caseId) {
  return loadVisits()
    .filter((v) => v.caseId === caseId)
    .sort((a, b) => a.visitNumber - b.visitNumber);
}

async function listVisitsForCases(caseIds) {
  const wanted = new Set(caseIds);
  return loadVisits()
    .filter((v) => wanted.has(v.caseId))
    .sort((a, b) => a.visitNumber - b.visitNumber);
}

// Inclusive date range (YYYY-MM-DD), optionally only one physio's visits.
async function listVisitsBetween(fromDate, toDate, username) {
  return loadVisits()
    .filter((v) => v.scheduledDate >= fromDate && v.scheduledDate <= toDate)
    .filter((v) => !username || v.assignedPhysio === username)
    .sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime));
}

async function insertVisits(newVisits) {
  const list = loadVisits();
  list.push(...newVisits);
  saveVisits(list);
  return newVisits;
}

async function saveVisit(visit) {
  const list = loadVisits();
  const i = list.findIndex((v) => v.id === visit.id);
  if (i < 0) throw new Error('Visit not found');
  list[i] = { ...visit, updatedAt: new Date().toISOString() };
  saveVisits(list);
  return list[i];
}

async function deleteVisits(ids) {
  const drop = new Set(ids);
  saveVisits(loadVisits().filter((v) => !drop.has(v.id)));
}

module.exports = { getVisit, listVisitsForCase, listVisitsForCases, listVisitsBetween, insertVisits, saveVisit, deleteVisits };
