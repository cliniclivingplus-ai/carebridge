const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const clinicea = require('./clinicea-client');

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
    patientId: (patientId || 'UNASSIGNED').trim(),
    patientName: (patientName || 'Unknown Patient').trim(),
    patientMobile: (patientMobile || '').trim(),
    address: (address || '').trim(),
    city: (city || '').trim(),
    pcode: (pcode || '').trim(),
    symptomsConcern: (symptomsConcern || '').trim(),
    allottedSessions: parseInt(allottedSessions, 10) || 10,
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
  const targetCase = casesList.find((c) => c.id === id || c.patientId === id);
  if (!targetCase) return null;

  const sessionsList = loadSessions();
  const caseSessions = sessionsList.filter((s) => s.caseId === targetCase.id);
  return {
    ...targetCase,
    sessions: caseSessions.sort((a, b) => (a.sessionNumber || 0) - (b.sessionNumber || 0)),
  };
}

async function claimCase(id, physioUsername) {
  const casesList = loadCases();
  const target = casesList.find((c) => c.id === id);
  if (!target) throw new Error('Case not found');

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

  target.assignedPhysio = targetPhysioUsername ? targetPhysioUsername.trim() : null;
  if (target.assignedPhysio) {
    if (target.status === 'open') target.status = 'in_progress';
  } else {
    target.status = 'open';
  }
  target.updatedAt = new Date().toISOString();

  saveCases(casesList);
  return getCase(target.id);
}

async function recordSessionFeedback(caseId, { beforeAssessment, afterSummary, clinicalNotes, physioUsername }) {
  const casesList = loadCases();
  const targetCase = casesList.find((c) => c.id === caseId || c.patientId === caseId);
  if (!targetCase) throw new Error('Case not found');

  if (targetCase.completedSessions >= targetCase.allottedSessions) {
    throw new Error(`All allotted sessions (${targetCase.allottedSessions}) for this patient are already completed`);
  }

  const nextSessionNumber = targetCase.completedSessions + 1;
  const sessionsList = loadSessions();

  const newSession = {
    id: `SESS-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    caseId: targetCase.id,
    patientId: targetCase.patientId,
    sessionNumber: nextSessionNumber,
    scheduledDate: new Date().toISOString(),
    physioUsername: physioUsername || targetCase.assignedPhysio || 'external_physio',
    status: 'completed',
    beforeAssessment: beforeAssessment || {},
    afterSummary: afterSummary || {},
    clinicalNotes: clinicalNotes || (afterSummary ? afterSummary.clinicalNotes : '') || '',
    cliniceaSyncStatus: 'pending',
    cliniceaEncounterId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  sessionsList.push(newSession);
  saveSessions(sessionsList);

  targetCase.completedSessions += 1;
  if (!targetCase.assignedPhysio) {
    targetCase.assignedPhysio = physioUsername;
  }
  if (targetCase.completedSessions >= targetCase.allottedSessions) {
    targetCase.status = 'completed';
  } else {
    targetCase.status = 'in_progress';
  }
  targetCase.updatedAt = new Date().toISOString();
  saveCases(casesList);

  // Auto Sync to Clinicea if live key is available
  const formattedNote = `[PhysioWay Home-Visit Session ${newSession.sessionNumber}/${targetCase.allottedSessions}] Physio: ${newSession.physioUsername} | Pain (Pre): ${beforeAssessment?.painLevelBefore || 'N/A'}/10 | Pain (Post): ${afterSummary?.painLevelAfter || 'N/A'}/10 | Mobility: ${afterSummary?.mobilityStatus || 'N/A'} | Compliance: ${afterSummary?.patientCompliance || 'N/A'} | Exercises: ${afterSummary?.exercisesCompleted || 'N/A'} | Notes: ${newSession.clinicalNotes}`.trim();

  if (clinicea.isLiveMode()) {
    try {
      const result = await clinicea.addPatientEncounter(targetCase.patientId, formattedNote);
      newSession.cliniceaSyncStatus = 'synced';
      newSession.cliniceaEncounterId = result?.encounterId || result?.id || 'SYNCED';
    } catch (err) {
      console.warn(`[Clinicea sync] Failed for session ${newSession.id}:`, err.message);
      newSession.cliniceaSyncStatus = 'failed';
    }
  } else {
    newSession.cliniceaSyncStatus = 'synced'; // Simulated success in demo mode
  }

  saveSessions(sessionsList);
  return { case: await getCase(targetCase.id), session: newSession };
}

async function retrySessionSync(sessionId) {
  const sessionsList = loadSessions();
  const session = sessionsList.find((s) => s.id === sessionId);
  if (!session) throw new Error('Session not found');

  const casesList = loadCases();
  const parentCase = casesList.find((c) => c.id === session.caseId);

  const formattedNote = `[PhysioWay Home-Visit Session ${session.sessionNumber}/${parentCase?.allottedSessions || 10}] Physio: ${session.physioUsername} | Pain (Pre): ${session.beforeAssessment?.painLevelBefore || 'N/A'}/10 | Pain (Post): ${session.afterSummary?.painLevelAfter || 'N/A'}/10 | Mobility: ${session.afterSummary?.mobilityStatus || 'N/A'} | Compliance: ${session.afterSummary?.patientCompliance || 'N/A'} | Exercises: ${session.afterSummary?.exercisesCompleted || 'N/A'} | Notes: ${session.clinicalNotes}`.trim();

  if (clinicea.isLiveMode()) {
    try {
      const result = await clinicea.addPatientEncounter(session.patientId, formattedNote);
      session.cliniceaSyncStatus = 'synced';
      session.cliniceaEncounterId = result?.encounterId || result?.id || 'SYNCED';
    } catch (err) {
      session.cliniceaSyncStatus = 'failed';
      throw err;
    }
  } else {
    session.cliniceaSyncStatus = 'synced';
  }

  saveSessions(sessionsList);
  return session;
}

module.exports = {
  createCase,
  listCases,
  getCase,
  claimCase,
  assignCase,
  recordSessionFeedback,
  retrySessionSync,
};
