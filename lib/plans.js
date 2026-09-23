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

const FILE = getFilePath('patient_plans.json');

function ensureFile() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({}, null, 2));
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeAll(data) {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function getPlan(patientId) {
  if (!patientId) return null;
  const key = String(patientId).toUpperCase().trim();
  const all = readAll();
  const plan = all[key];
  if (!plan) {
    return {
      patientId: key,
      enrolled: false,
      allottedSessions: 0,
      completedSessions: 0,
      remainingSessions: 0,
      assignedPhysio: null,
      notes: '',
      history: [],
      updatedAt: null,
    };
  }
  const allotted = Number(plan.allottedSessions) || 0;
  const completed = Number(plan.completedSessions) || 0;
  return {
    patientId: key,
    enrolled: Boolean(plan.enrolled !== false && allotted > 0),
    allottedSessions: allotted,
    completedSessions: completed,
    remainingSessions: Math.max(0, allotted - completed),
    assignedPhysio: plan.assignedPhysio || null,
    notes: plan.notes || '',
    history: plan.history || [],
    updatedAt: plan.updatedAt,
  };
}

function updateAllotted(patientId, allottedSessions, assignedPhysio, notes, updatedBy) {
  if (!patientId) throw new Error('Patient ID is required');
  const key = String(patientId).toUpperCase().trim();
  const num = parseInt(allottedSessions, 10);
  if (isNaN(num) || num < 1) throw new Error('Allotted sessions must be a positive number');

  const all = readAll();
  const existing = all[key] || {
    patientId: key,
    completedSessions: 0,
    history: [],
  };
  existing.enrolled = true;
  existing.allottedSessions = num;
  if (assignedPhysio !== undefined) existing.assignedPhysio = assignedPhysio || null;
  if (notes !== undefined) existing.notes = notes || '';
  existing.updatedBy = updatedBy || 'system';
  existing.updatedAt = new Date().toISOString();

  all[key] = existing;
  writeAll(all);
  return getPlan(key);
}

function recordSessionFeedback(patientId, feedbackData, loggedBy) {
  if (!patientId) throw new Error('Patient ID is required');
  const key = String(patientId).toUpperCase().trim();
  const all = readAll();
  const existing = getPlan(key);

  existing.completedSessions = (Number(existing.completedSessions) || 0) + 1;
  const feedbackEntry = {
    id: `fb-${Date.now()}`,
    sessionNumber: existing.completedSessions,
    totalAllotted: existing.allottedSessions,
    painLevel: feedbackData.painLevel,
    mobilityStatus: feedbackData.mobilityStatus,
    exercisesCompleted: feedbackData.exercisesCompleted,
    patientCompliance: feedbackData.patientCompliance,
    clinicalNotes: feedbackData.clinicalNotes,
    loggedBy: loggedBy || 'external_physio',
    timestamp: new Date().toISOString(),
  };

  existing.history = existing.history || [];
  existing.history.unshift(feedbackEntry);
  existing.updatedAt = new Date().toISOString();

  all[key] = existing;
  writeAll(all);
  return { plan: getPlan(key), feedbackEntry };
}

module.exports = { getPlan, updateAllotted, recordSessionFeedback };
