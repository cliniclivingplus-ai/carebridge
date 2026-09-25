// Home-visit scheduling and the visit lifecycle. Every rule lives here -- which step can follow
// which, who may take it, and when -- on top of a storage module (lib/visits.js for the local
// file store, lib/visits-pg.js for Postgres) that only reads and writes.
//
// Lifecycle of one visit:
//   scheduled -> confirmed -> on_the_way -> arrived -> in_session -> completed -> notes_submitted
// Taking (or being assigned) the case confirms its visits. Exceptions along the way:
//   reschedule_requested (physio asks, Sales/Doctor approve or decline), cancelled, no_show.
const crypto = require('crypto');

const STAFF = ['sales', 'clp_doctor'];
const NOT_STARTED = ['scheduled', 'confirmed'];
const FINAL = ['notes_submitted', 'cancelled', 'no_show'];
const PATTERNS = {
  MWF: [1, 3, 5],
  TTS: [2, 4, 6],
  WEEKDAYS: [1, 2, 3, 4, 5],
  DAILY: [0, 1, 2, 3, 4, 5, 6],
};
const DEFAULT_DURATION = 45;
const MAX_REASON = 500;

// The physio's own steps: which statuses each one may follow.
const PHYSIO_STEPS = {
  confirmed: ['scheduled'],
  on_the_way: ['confirmed'],
  arrived: ['confirmed', 'on_the_way'], // "On my way" is skippable, arriving is not
  in_session: ['arrived'],
  completed: ['in_session'],
};

class VisitError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------- dates (all plain YYYY-MM-DD strings, India time) ----------

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// Date arithmetic in UTC on the date alone, so no server/browser timezone can shift the day.
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function weekday(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

function isTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// `count` dates on the given weekdays, starting at (and including) `startDate`.
function datesOnWeekdays(startDate, count, days) {
  const dates = [];
  let d = startDate;
  while (dates.length < count) {
    if (days.includes(weekday(d))) dates.push(d);
    d = addDays(d, 1);
  }
  return dates;
}

function cleanReason(reason, required) {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (required && !r) throw new VisitError('Please give a reason');
  if (r.length > MAX_REASON) throw new VisitError('Reason is too long');
  return r || null;
}

function historyEntry(step, user, extra = {}) {
  return { step, timestamp: new Date().toISOString(), user: user.username, ...extra };
}

function isStaff(user) {
  return STAFF.includes(user.role);
}

function newVisitId() {
  return `VISIT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function buildVisit(caseObj, number, date, time, user, note) {
  const assigned = caseObj.assignedPhysio || null;
  return {
    id: newVisitId(),
    caseId: caseObj.id,
    patientId: caseObj.patientId,
    patientName: caseObj.patientName,
    patientMobile: caseObj.patientMobile || '',
    address: [caseObj.address, caseObj.city, caseObj.pcode].filter(Boolean).join(', '),
    visitNumber: number,
    scheduledDate: date,
    scheduledTime: time,
    durationMinutes: DEFAULT_DURATION,
    assignedPhysio: assigned,
    status: assigned ? 'confirmed' : 'scheduled',
    statusHistory: [historyEntry('scheduled', user, { note })],
    cancellationReason: null,
    rescheduleReason: null,
    rescheduleRequest: null,
    cliniceaAppointmentId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createVisitService(store) {
  async function load(visitId) {
    const visit = await store.getVisit(visitId);
    if (!visit) throw new VisitError('Visit not found', 404);
    return visit;
  }

  // Checked before a case is created, so a bad schedule never leaves a case without visits.
  function validateScheduleInput({ startDate, startTime, pattern }) {
    if (!isDate(startDate)) throw new VisitError('Please choose a valid first visit date');
    if (startDate < todayIST()) throw new VisitError('The first visit cannot be in the past');
    if (!isTime(startTime)) throw new VisitError('Please choose a valid visit time');
    if (!PATTERNS[String(pattern || '').toUpperCase()]) throw new VisitError('Unknown repeat pattern');
  }

  // Book every allotted visit upfront on the chosen weekdays (decision A).
  async function createSchedule(caseObj, { startDate, startTime, pattern }, user) {
    validateScheduleInput({ startDate, startTime, pattern });
    const key = pattern.toUpperCase();
    const dates = datesOnWeekdays(startDate, caseObj.allottedSessions, PATTERNS[key]);
    const list = dates.map((d, i) => buildVisit(caseObj, i + 1, d, startTime, user, `Booked for ${d} at ${startTime} (${key})`));
    return store.insertVisits(list);
  }

  // Keep the number of visits equal to the case's allotted sessions after an allotment change.
  // Extra visits continue on the weekdays already in use; removed visits must not have started.
  async function resizeSchedule(caseObj, user) {
    const visits = await store.listVisitsForCase(caseObj.id);
    const target = caseObj.allottedSessions;
    if (visits.length < target) {
      const last = visits[visits.length - 1];
      const days = [...new Set(visits.map((v) => weekday(v.scheduledDate)))];
      const from = last ? addDays(last.scheduledDate > todayIST() ? last.scheduledDate : todayIST(), 1) : addDays(todayIST(), 1);
      const dates = datesOnWeekdays(from, target - visits.length, days.length ? days : PATTERNS.MWF);
      const time = last ? last.scheduledTime : '10:00';
      await store.insertVisits(dates.map((d, i) => buildVisit(caseObj, visits.length + i + 1, d, time, user, `Added when sessions were increased to ${target}`)));
    } else if (visits.length > target) {
      const extra = visits.filter((v) => v.visitNumber > target);
      const started = extra.find((v) => !NOT_STARTED.includes(v.status) && v.status !== 'reschedule_requested' && v.status !== 'cancelled');
      if (started) throw new VisitError(`Visit ${started.visitNumber} has already started, so sessions can't be reduced below ${started.visitNumber}`);
      await store.deleteVisits(extra.map((v) => v.id));
    }
    return store.listVisitsForCase(caseObj.id);
  }

  // Taking or being assigned a case confirms its not-yet-started visits (decision 2);
  // un-assigning puts them back to "scheduled". Started visits keep their physio.
  async function syncAssignment(caseId, physio, user) {
    const visits = await store.listVisitsForCase(caseId);
    for (const v of visits) {
      if (!NOT_STARTED.includes(v.status) && v.status !== 'reschedule_requested') continue;
      const changed = v.assignedPhysio !== (physio || null);
      v.assignedPhysio = physio || null;
      // A pending reschedule keeps its status; the approve/decline decision sets it from the
      // physio assigned at that point.
      if (v.status !== 'reschedule_requested') {
        const next = physio ? 'confirmed' : 'scheduled';
        if (v.status !== next || changed) {
          v.status = next;
          v.statusHistory.push(historyEntry(next, user, { note: physio ? `Confirmed for ${physio} (case taken/assigned)` : 'Physio removed from case' }));
        }
      }
      if (changed || v.status !== 'reschedule_requested') await store.saveVisit(v);
    }
  }

  // PhysioWay coordinators work on every shared visit; their own system decides which physio goes.
  function assertAssignedPhysio(visit, user) {
    if (user.role !== 'external_physio' && visit.assignedPhysio !== user.username) {
      throw new VisitError('Only the physio assigned to this visit can update it', 403);
    }
  }

  // The physio's own progress through the visit.
  async function advance(visitId, step, user, { coords } = {}) {
    const allowedFrom = PHYSIO_STEPS[step];
    if (!allowedFrom) throw new VisitError('Unknown step');
    const visit = await load(visitId);
    // The old on-the-way / arrived steps stay with an assigned physio (not used by PhysioWay).
    if (visit.assignedPhysio !== user.username) throw new VisitError('Only the physio assigned to this visit can update it', 403);
    if (visit.status === 'reschedule_requested') throw new VisitError('This visit is waiting for a reschedule decision');
    if (!allowedFrom.includes(visit.status)) throw new VisitError(`Can't go from "${visit.status}" to "${step}"`);
    if (step !== 'confirmed' && visit.scheduledDate > todayIST()) {
      throw new VisitError(`This visit is booked for ${visit.scheduledDate}; it can't be started early`);
    }
    let location = null;
    if (step === 'arrived' && coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lng)
      && Math.abs(coords.lat) <= 90 && Math.abs(coords.lng) <= 180) {
      location = { lat: Number(coords.lat.toFixed(6)), lng: Number(coords.lng.toFixed(6)), accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null };
    }
    visit.status = step;
    visit.statusHistory.push(historyEntry(step, user, location ? { coords: location } : {}));
    return store.saveVisit(visit);
  }

  // Visit didn't happen. Physio (for their own visit) or Sales/Doctor, always with a reason.
  async function stop(visitId, outcome, user, reason) {
    if (!['cancelled', 'no_show'].includes(outcome)) throw new VisitError('Unknown outcome');
    const visit = await load(visitId);
    if (!isStaff(user)) {
      if (outcome === 'cancelled') throw new VisitError('Please ask CLP to cancel a visit', 403);
      assertAssignedPhysio(visit, user);
    }
    if (FINAL.includes(visit.status) || visit.status === 'completed') throw new VisitError('This visit is already closed');
    if (visit.status === 'in_session') throw new VisitError('The session has started; finish it instead of cancelling');
    if (outcome === 'no_show' && NOT_STARTED.includes(visit.status) && visit.scheduledDate > todayIST()) {
      throw new VisitError("A future visit can't be marked as a no-show");
    }
    const why = cleanReason(reason, true);
    visit.status = outcome;
    visit.cancellationReason = why;
    visit.rescheduleRequest = null;
    visit.statusHistory.push(historyEntry(outcome, user, { reason: why }));
    return store.saveVisit(visit);
  }

  // Physio asks for a new date/time (decision 3); Sales/Doctor decide.
  async function requestReschedule(visitId, user, { newDate, newTime, reason }) {
    const visit = await load(visitId);
    assertAssignedPhysio(visit, user);
    if (!NOT_STARTED.includes(visit.status)) throw new VisitError('Only a visit that has not started can be rescheduled');
    if (!isDate(newDate) || newDate < todayIST()) throw new VisitError('Please choose a valid date from today onwards');
    if (!isTime(newTime)) throw new VisitError('Please choose a valid time');
    const why = cleanReason(reason, true);
    visit.rescheduleRequest = { newDate, newTime, reason: why, requestedBy: user.username, requestedAt: new Date().toISOString(), previousStatus: visit.status };
    visit.status = 'reschedule_requested';
    visit.statusHistory.push(historyEntry('reschedule_requested', user, { reason: why, note: `Asked to move to ${newDate} ${newTime}` }));
    return store.saveVisit(visit);
  }

  async function decideReschedule(visitId, user, { approve, note }) {
    if (!isStaff(user)) throw new VisitError('Only Sales or a Doctor can decide on a reschedule', 403);
    const visit = await load(visitId);
    if (visit.status !== 'reschedule_requested' || !visit.rescheduleRequest) throw new VisitError('There is no pending reschedule request');
    const req = visit.rescheduleRequest;
    const why = cleanReason(note, false);
    if (approve) {
      visit.statusHistory.push(historyEntry('rescheduled', user, { note: `Moved from ${visit.scheduledDate} ${visit.scheduledTime} to ${req.newDate} ${req.newTime}`, reason: why || req.reason }));
      visit.scheduledDate = req.newDate;
      visit.scheduledTime = req.newTime;
      visit.rescheduleReason = req.reason;
    } else {
      visit.statusHistory.push(historyEntry('reschedule_declined', user, { reason: why }));
    }
    visit.status = visit.assignedPhysio ? 'confirmed' : 'scheduled';
    visit.rescheduleRequest = null;
    return store.saveVisit(visit);
  }

  // Sales/Doctor move a visit directly, or rebook a cancelled / no-show visit.
  async function editSchedule(visitId, user, { date, time, reason }) {
    if (!isStaff(user)) throw new VisitError('Only Sales or a Doctor can change a visit time', 403);
    const visit = await load(visitId);
    const rebooking = ['cancelled', 'no_show'].includes(visit.status);
    if (!rebooking && !NOT_STARTED.includes(visit.status) && visit.status !== 'reschedule_requested') {
      throw new VisitError('This visit has already started');
    }
    if (!isDate(date) || date < todayIST()) throw new VisitError('Please choose a valid date from today onwards');
    if (!isTime(time)) throw new VisitError('Please choose a valid time');
    const why = cleanReason(reason, false);
    visit.statusHistory.push(historyEntry(rebooking ? 'rebooked' : 'rescheduled', user, { note: `Moved from ${visit.scheduledDate} ${visit.scheduledTime} to ${date} ${time}`, reason: why }));
    visit.scheduledDate = date;
    visit.scheduledTime = time;
    visit.rescheduleRequest = null;
    if (rebooking) visit.cancellationReason = null;
    visit.status = visit.assignedPhysio ? 'confirmed' : 'scheduled';
    return store.saveVisit(visit);
  }

  // The visit a set of session notes belongs to: the one given (if it's this case's and finished),
  // otherwise this physio's finished visit on the case that is still waiting for notes.
  // Visits a session can still be recorded against (not closed, cancelled or no-show), earliest first.
  const OPEN_FOR_NOTES = ['scheduled', 'confirmed', 'reschedule_requested', 'on_the_way', 'arrived', 'in_session', 'completed'];
  function openVisitsInOrder(visits) {
    return visits
      .filter((v) => OPEN_FOR_NOTES.includes(v.status))
      .sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime) || a.visitNumber - b.visitNumber);
  }

  // The visit a set of session notes belongs to:
  //   1. the visit given (from "Finish session & write notes"), if it's this case's and open;
  //   2. otherwise a visit the physio has finished but not written notes for;
  //   3. otherwise (notes recorded from the case card, visit steps not used) the case's next open
  //      visit -- so the session always uses up one visit and the two counts stay equal.
  async function findVisitForNotes(caseId, visitId, user) {
    const visits = await store.listVisitsForCase(caseId);
    const open = openVisitsInOrder(visits);
    if (visitId) {
      const given = open.find((v) => v.id === visitId);
      if (given) return given;
    }
    return open.find((v) => v.status === 'completed' && v.assignedPhysio === user.username)
      || open.find((v) => v.status === 'completed')
      || open[0]
      || null;
  }

  // Called after session notes are saved: closes the visit they belong to. A visit whose steps
  // weren't used gets a note saying so, so its timeline stays honest.
  async function markNotesSubmitted(caseId, visitId, sessionId, user, note) {
    const visit = (await store.listVisitsForCase(caseId)).find((v) => v.id === visitId);
    if (!visit || !OPEN_FOR_NOTES.includes(visit.status)) return null;
    if (visit.status !== 'completed') {
      visit.statusHistory.push(historyEntry('completed', user, { note: note || 'Session recorded from the case card; the visit steps (on the way, arrived, started) were not used' }));
    }
    visit.status = 'notes_submitted';
    visit.rescheduleRequest = null;
    visit.statusHistory.push(historyEntry('notes_submitted', user, { sessionId }));
    return store.saveVisit(visit);
  }

  // Repairs cases where sessions were recorded without closing a visit (before this was linked):
  // closes one open visit per unlinked session, earliest first. Returns true if anything changed.
  async function reconcileCase(caseObj) {
    const visits = await store.listVisitsForCase(caseObj.id);
    const linked = new Set(visits.flatMap((v) => (v.statusHistory || []).filter((h) => h.step === 'notes_submitted').map((h) => h.sessionId)));
    const unlinked = (caseObj.sessions || []).filter((s) => !linked.has(s.id)).sort((a, b) => a.sessionNumber - b.sessionNumber);
    let changed = false;
    for (const session of unlinked) {
      const next = openVisitsInOrder(await store.listVisitsForCase(caseObj.id))[0];
      if (!next) break;
      await markNotesSubmitted(caseObj.id, next.id, session.id, { username: session.physioUsername || 'system' });
      changed = true;
    }
    return changed;
  }

  // Visits in a date range, with a warning on any physio's visits that overlap.
  async function listSchedule({ fromDate, days, username }) {
    const from = isDate(fromDate) ? fromDate : todayIST();
    const span = Math.min(Math.max(parseInt(days, 10) || 1, 1), 31);
    const list = await store.listVisitsBetween(from, addDays(from, span - 1), username || null);
    const toMin = (t) => parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
    for (const v of list) v.overlapWarning = false;
    // Only visits still to happen can clash; finished or called-off ones can't.
    const active = list.filter((v) => v.assignedPhysio && !['cancelled', 'no_show', 'completed', 'notes_submitted'].includes(v.status));
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (a.assignedPhysio !== b.assignedPhysio || a.scheduledDate !== b.scheduledDate) continue;
        if (Math.abs(toMin(a.scheduledTime) - toMin(b.scheduledTime)) < (a.durationMinutes || DEFAULT_DURATION)) {
          a.overlapWarning = true;
          b.overlapWarning = true;
        }
      }
    }
    return { from, days: span, today: todayIST(), visits: list };
  }

  // Per-case summary for the case cards: next appointment and how the visits stand.
  function summarize(visits) {
    const today = todayIST();
    const open = visits
      .filter((v) => NOT_STARTED.includes(v.status) || ['reschedule_requested', 'on_the_way', 'arrived', 'in_session'].includes(v.status))
      .sort((a, b) => (a.scheduledDate + a.scheduledTime).localeCompare(b.scheduledDate + b.scheduledTime));
    const next = open[0] || null;
    return {
      total: visits.length,
      done: visits.filter((v) => ['completed', 'notes_submitted'].includes(v.status)).length,
      cancelled: visits.filter((v) => v.status === 'cancelled').length,
      noShow: visits.filter((v) => v.status === 'no_show').length,
      pendingReschedule: visits.filter((v) => v.status === 'reschedule_requested').length,
      overdue: open.filter((v) => v.scheduledDate < today).length,
      nextVisit: next && { id: next.id, visitNumber: next.visitNumber, date: next.scheduledDate, time: next.scheduledTime, status: next.status },
    };
  }

  async function summariesForCases(caseIds) {
    const all = await store.listVisitsForCases(caseIds);
    const byCase = new Map(caseIds.map((id) => [id, []]));
    for (const v of all) if (byCase.has(v.caseId)) byCase.get(v.caseId).push(v);
    return new Map([...byCase].map(([id, list]) => [id, summarize(list)]));
  }

  return {
    validateScheduleInput,
    createSchedule,
    resizeSchedule,
    syncAssignment,
    advance,
    stop,
    requestReschedule,
    decideReschedule,
    editSchedule,
    findVisitForNotes,
    reconcileCase,
    deleteForCase: async (caseId) => store.deleteVisits((await store.listVisitsForCase(caseId)).map((v) => v.id)),
    markNotesSubmitted,
    listSchedule,
    listForCase: (caseId) => store.listVisitsForCase(caseId),
    summariesForCases,
    todayIST,
  };
}

module.exports = { createVisitService, VisitError, PATTERNS };
