const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { syncSession } = require('./session-sync');

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

const CASES_FILE = getFilePath('cases.json');
const SESSIONS_FILE = getFilePath('sessions.json');

function loadCases() {
  if (!fs.existsSync(CASES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveCases(data) {
  fs.writeFileSync(CASES_FILE, JSON.stringify(data, null, 2));
}

function loadSessions() {
  if (!fs.existsSync(SESSIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function saveSessions(data) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
}

async function createCase({
  patientId,
  cliniceaPatientId = '',
  patientName,
  patientMobile = '',
  address = '',
  city = '',
  pcode = '',
  symptomsConcern = '',
  allottedSessions = 10,
  createdBy,
  instructions = '',
}) {
  const casesList = loadCases();
  const id = `CASE-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  
  const newCase = {
    id,
    patientId: String(patientId).trim(),
    cliniceaPatientId: (cliniceaPatientId || '').trim(),
    patientName: (patientName || 'Unknown Patient').trim(),
    patientMobile: (patientMobile || '').trim(),
    address: (address || '').trim(),
    city: (city || '').trim(),
    pcode: (pcode || '').trim(),
    symptomsConcern: (symptomsConcern || '').trim(),
    allottedSessions: parseInt(allottedSessions, 10),
    completedSessions: 0,
    createdBy: (createdBy || 'sales_user').trim(),
    assignedPhysio: null,
    status: 'open',
    instructions: (instructions || '').trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  casesList.unshift(newCase);
  saveCases(casesList);
  return newCase;
}

async function listCases({ status, physio, query } = {}) {
  const casesList = loadCases();
  const sessionsList = loadSessions();
  const q = (query || '').toLowerCase().trim();

  let filtered = casesList.filter((c) => {
    if (status === 'open') return c.status === 'open';
    if (status === 'mine' && physio) return c.assignedPhysio === physio;
    if (status === 'active') return c.status === 'in_progress';
    if (status === 'completed') return c.status === 'completed';
    return true;
  });

  if (q) {
    filtered = filtered.filter(
      (c) =>
        (c.patientName || '').toLowerCase().includes(q) ||
        (c.patientId || '').toLowerCase().includes(q) ||
        (c.symptomsConcern || '').toLowerCase().includes(q) ||
        (c.patientMobile || '').toLowerCase().includes(q) ||
        (c.assignedPhysio || '').toLowerCase().includes(q)
    );
  }

  return filtered.map((c) => {
    const caseSessions = sessionsList.filter((s) => s.caseId === c.id);
    return {
      ...c,
      sessions: caseSessions.sort((a, b) => (a.sessionNumber || 0) - (b.sessionNumber || 0)),
    };
  });
}

async function getCase(id) {
  const casesList = loadCases();
  const targetCase = casesList.find((c) => c.id === id);
  if (!targetCase) return null;

  const sessionsList = loadSessions();
  const caseSessions = sessionsList.filter((s) => s.caseId === targetCase.id);
  return {
    ...targetCase,
    sessions: caseSessions.sort((a, b) => (a.sessionNumber || 0) - (b.sessionNumber || 0)),
  };
}

// Claiming only works on an open case -- a physio can't take a case someone else already owns.
async function claimCase(id, physioUsername) {
  const casesList = loadCases();
  const target = casesList.find((c) => c.id === id);
  if (!target) throw new Error('Case not found');
  if (target.status !== 'open' || target.assignedPhysio) throw new Error('This case has already been claimed');

  target.assignedPhysio = physioUsername.trim();
  target.status = 'in_progress';
  target.updatedAt = new Date().toISOString();

  saveCases(casesList);
  return getCase(target.id);
}

async function assignCase(id, targetPhysioUsername) {
  const casesList = loadCases();
  const target = casesList.find((c) => c.id === id);
  if (!target) throw new Error('Case not found');
  if (target.status === 'completed') throw new Error('Completed cases cannot be reassigned');

  target.assignedPhysio = targetPhysioUsername ? targetPhysioUsername.trim() : null;
  target.status = target.assignedPhysio ? 'in_progress' : 'open';
  target.updatedAt = new Date().toISOString();

  saveCases(casesList);
  return getCase(target.id);
}

async function recordSessionFeedback(caseId, { beforeAssessment, afterSummary, clinicalNotes, sessionDate, physioUsername, visitId }) {
  const casesList = loadCases();
  const targetCase = casesList.find((c) => c.id === caseId);
  if (!targetCase) throw new Error('Case not found');
  if (targetCase.status === 'completed' || targetCase.completedSessions >= targetCase.allottedSessions) {
    throw new Error(`All allotted sessions (${targetCase.allottedSessions}) for this patient are already completed`);
  }

  const sessionsList = loadSessions();
  const newSession = {
    id: `SESS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    caseId: targetCase.id,
    patientId: targetCase.patientId,
    sessionNumber: targetCase.completedSessions + 1,
    scheduledDate: sessionDate || new Date().toISOString(),
    physioUsername,
    visitId: visitId || null,
    status: 'completed',
    beforeAssessment: beforeAssessment || {},
    afterSummary: afterSummary || {},
    clinicalNotes: clinicalNotes || (afterSummary ? afterSummary.clinicalNotes : '') || '',
    cliniceaSyncStatus: 'pending',
    cliniceaSyncError: null,
    cliniceaEncounterId: null,
    cliniceaDocumentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sessionsList.push(newSession);

  targetCase.completedSessions += 1;
  targetCase.status = targetCase.completedSessions >= targetCase.allottedSessions ? 'completed' : 'in_progress';
  targetCase.updatedAt = new Date().toISOString();
  saveSessions(sessionsList);
  saveCases(casesList);

  // Trigger background Clinicea EMR sync asynchronously so the session saves instantly for the user
  syncSession(newSession, targetCase).then((sync) => {
    const list = loadSessions();
    const targetSess = list.find((s) => s.id === newSession.id);
    if (targetSess) {
      targetSess.cliniceaSyncStatus = sync.status;
      targetSess.cliniceaSyncError = sync.error;
      targetSess.cliniceaDocumentId = sync.documentId;
      saveSessions(list);
    }
  }).catch((err) => {
    console.warn(`[Clinicea background sync error] session ${newSession.id}:`, err.message);
  });

  return { case: await getCase(targetCase.id), session: newSession };
}

async function getSession(sessionId) {
  return loadSessions().find((s) => s.id === sessionId) || null;
}

// Never re-sends a session Clinicea already accepted -- that would create a duplicate encounter.
async function retrySessionSync(sessionId) {
  const sessionsList = loadSessions();
  const session = sessionsList.find((s) => s.id === sessionId);
  if (!session) throw new Error('Session not found');
  if (session.cliniceaSyncStatus === 'synced') return session;

  const parentCase = loadCases().find((c) => c.id === session.caseId);
  const sync = await syncSession(session, parentCase);
  session.cliniceaSyncStatus = sync.status;
  session.cliniceaSyncError = sync.error;
  session.cliniceaDocumentId = sync.documentId;
  session.updatedAt = new Date().toISOString();
  saveSessions(sessionsList);
  return session;
}

async function updateCaseAllotted(id, { allottedSessions, assignedPhysio, instructions }) {
  const casesList = loadCases();
  const target = casesList.find((c) => c.id === id);
  if (!target) throw new Error('Case not found');
  
  if (allottedSessions !== undefined) {
    const count = parseInt(allottedSessions, 10);
    if (!Number.isInteger(count) || count < target.completedSessions || count > 100) {
      throw new Error(`Allotted sessions must be between completed sessions (${target.completedSessions}) and 100`);
    }
    target.allottedSessions = count;
  }
  
  if (instructions !== undefined) {
    target.instructions = (instructions || '').trim();
  }

  if (assignedPhysio !== undefined) {
    target.assignedPhysio = assignedPhysio ? assignedPhysio.trim() : null;
  }

  if (target.status === 'completed' && target.allottedSessions > target.completedSessions) {
    target.status = target.assignedPhysio ? 'in_progress' : 'open';
  } else if (target.completedSessions >= target.allottedSessions) {
    target.status = 'completed';
  }

  target.updatedAt = new Date().toISOString();
  saveCases(casesList);
  return getCase(target.id);
}

// Removes a case and its sessions from CareBridge only (nothing in Clinicea is touched).
async function deleteCase(id) {
  const casesList = loadCases();
  if (!casesList.some((c) => c.id === id)) return false;
  saveCases(casesList.filter((c) => c.id !== id));
  saveSessions(loadSessions().filter((s) => s.caseId !== id));
  return true;
}

module.exports = {
  createCase,
  deleteCase,
  listCases,
  getCase,
  claimCase,
  assignCase,
  updateCaseAllotted,
  recordSessionFeedback,
  getSession,
  retrySessionSync,
};

