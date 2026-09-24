const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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

// Pattern map: 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
function getPatternDays(pattern) {
  const p = (pattern || 'MWF').toUpperCase();
  if (p === 'TTS') return [2, 4, 6];
  if (p === 'DAILY') return [0, 1, 2, 3, 4, 5, 6];
  if (p === 'WEEKDAYS') return [1, 2, 3, 4, 5];
  return [1, 3, 5]; // Default Mon / Wed / Fri
}

function calculateVisitDates(startDateStr, totalSessions, pattern) {
  const allowedDays = getPatternDays(pattern);
  const dates = [];
  let curr = new Date(startDateStr ? `${startDateStr}T00:00:00` : new Date());

  while (dates.length < totalSessions) {
    const dayOfWeek = curr.getDay();
    if (allowedDays.includes(dayOfWeek)) {
      dates.push(curr.toISOString().split('T')[0]);
    }
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

async function createVisitSchedule({
  caseId,
  patientId,
  patientName = 'Unknown Patient',
  patientMobile = '',
  address = '',
  allottedSessions = 10,
  startDate = '',
  startTime = '10:00',
  pattern = 'MWF',
  assignedPhysio = null,
  createdBy = 'sales_user',
}) {
  const visitsList = loadVisits();
  const dates = calculateVisitDates(startDate, allottedSessions, pattern);
  const newVisits = [];

  for (let i = 0; i < dates.length; i++) {
    const visitId = `VISIT-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const visitObj = {
      id: visitId,
      caseId,
      patientId,
      patientName,
      patientMobile,
      address,
      visitNumber: i + 1,
      scheduledDate: dates[i],
      scheduledTime: startTime,
      durationMinutes: 45,
      assignedPhysio: assignedPhysio ? assignedPhysio.trim() : null,
      status: 'scheduled',
      statusHistory: [
        {
          step: 'scheduled',
          timestamp: new Date().toISOString(),
          user: createdBy,
          note: `Schedule created for ${dates[i]} at ${startTime} (${pattern})`,
        },
      ],
      cancellationReason: null,
      rescheduleReason: null,
      rescheduleRequest: null,
      cliniceaAppointmentId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    newVisits.push(visitObj);
    visitsList.unshift(visitObj);
  }

  saveVisits(visitsList);
  return newVisits;
}

async function listVisitsForCase(caseId) {
  const visitsList = loadVisits();
  return visitsList
    .filter((v) => v.caseId === caseId)
    .sort((a, b) => a.visitNumber - b.visitNumber);
}

async function listVisitsForPhysio(username, dateStr) {
  const visitsList = loadVisits();
  const targetDate = dateStr || new Date().toISOString().split('T')[0];

  let filtered = visitsList.filter((v) => {
    if (username && v.assignedPhysio !== username) return false;
    return v.scheduledDate === targetDate;
  });

  filtered.sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));

  // Calculate overlap warnings (if two visits start within 45 mins of each other)
  for (let i = 0; i < filtered.length; i++) {
    filtered[i].overlapWarning = false;
    if (i > 0) {
      const prevTime = filtered[i - 1].scheduledTime;
      const currTime = filtered[i].scheduledTime;
      if (prevTime && currTime) {
        const prevMins = parseInt(prevTime.split(':')[0], 10) * 60 + parseInt(prevTime.split(':')[1], 10);
        const currMins = parseInt(currTime.split(':')[0], 10) * 60 + parseInt(currTime.split(':')[1], 10);
        if (currMins - prevMins < 45) {
          filtered[i].overlapWarning = true;
          filtered[i - 1].overlapWarning = true;
        }
      }
    }
  }

  return filtered;
}

async function updateVisitStep(visitId, { step, username, coords, reason }) {
  const visitsList = loadVisits();
  const visit = visitsList.find((v) => v.id === visitId);
  if (!visit) throw new Error('Visit not found');

  const historyEntry = {
    step,
    timestamp: new Date().toISOString(),
    user: username,
    coords: coords || null,
    reason: reason || null,
  };

  visit.status = step;
  if (!visit.statusHistory) visit.statusHistory = [];
  visit.statusHistory.push(historyEntry);

  if (reason) {
    if (step === 'cancelled') visit.cancellationReason = reason;
    if (step === 'rescheduled') visit.rescheduleReason = reason;
  }

  visit.updatedAt = new Date().toISOString();
  saveVisits(visitsList);
  return visit;
}

async function requestReschedule(visitId, { newDate, newTime, reason, username }) {
  const visitsList = loadVisits();
  const visit = visitsList.find((v) => v.id === visitId);
  if (!visit) throw new Error('Visit not found');

  visit.status = 'reschedule_requested';
  visit.rescheduleRequest = {
    newDate,
    newTime,
    reason,
    requestedBy: username,
    requestedAt: new Date().toISOString(),
  };

  if (!visit.statusHistory) visit.statusHistory = [];
  visit.statusHistory.push({
    step: 'reschedule_requested',
    timestamp: new Date().toISOString(),
    user: username,
    note: `Reschedule requested for ${newDate} at ${newTime}: ${reason}`,
  });

  visit.updatedAt = new Date().toISOString();
  saveVisits(visitsList);
  return visit;
}

async function assignVisitsToPhysio(caseId, physioUsername) {
  const visitsList = loadVisits();
  let updatedCount = 0;
  for (const v of visitsList) {
    if (v.caseId === caseId) {
      v.assignedPhysio = physioUsername ? physioUsername.trim() : null;
      v.updatedAt = new Date().toISOString();
      updatedCount++;
    }
  }
  if (updatedCount > 0) saveVisits(visitsList);
  return updatedCount;
}

module.exports = {
  createVisitSchedule,
  listVisitsForCase,
  listVisitsForPhysio,
  updateVisitStep,
  requestReschedule,
  assignVisitsToPhysio,
};
