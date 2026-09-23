// Local persistent cache of appointments, kept in sync with Clinicea via webhooks (in)
// and direct API calls (out, for notes). File-backed JSON — fine for demo/small-clinic scale;
// swap for a real database before this handles serious volume or concurrent writers.

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function ensureDb() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ appointments: {}, syncState: {} }, null, 2));
}

function read() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function write(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function upsertAppointment(appt) {
  const data = read();
  const existing = data.appointments[appt.AppointmentID] || {};
  data.appointments[appt.AppointmentID] = {
    ...existing,
    ...appt,
    notes: appt.notes !== undefined ? appt.notes : existing.notes || '',
    notesSyncStatus: existing.notesSyncStatus || 'synced',
    updatedAt: new Date().toISOString(),
  };
  write(data);
  return data.appointments[appt.AppointmentID];
}

function markDeleted(appointmentId) {
  const data = read();
  if (data.appointments[appointmentId]) {
    data.appointments[appointmentId].deleted = true;
    data.appointments[appointmentId].updatedAt = new Date().toISOString();
    write(data);
  }
}

function getAll() {
  const data = read();
  return Object.values(data.appointments).filter((a) => !a.deleted);
}

function getByDate(dateStr) {
  return getAll().filter((a) => (a.AppointmentStartDateTime || '').slice(0, 10) === dateStr);
}

function setNotes(appointmentId, notes, syncStatus) {
  const data = read();
  const appt = data.appointments[appointmentId];
  if (!appt) return null;
  appt.notes = notes;
  appt.notesSyncStatus = syncStatus;
  appt.notesUpdatedAt = new Date().toISOString();
  write(data);
  return appt;
}

function setAssignedTo(appointmentId, assignedTo) {
  const data = read();
  const appt = data.appointments[appointmentId];
  if (!appt) return null;
  appt.assignedTo = assignedTo || null;
  appt.updatedAt = new Date().toISOString();
  write(data);
  return appt;
}

function isEmpty() {
  return Object.keys(read().appointments).length === 0;
}

function markNotified(appointmentId) {
  const data = read();
  const appt = data.appointments[appointmentId];
  if (!appt) return;
  appt.notifiedNewBooking = true;
  write(data);
}

function getSyncState(key) {
  const data = read();
  return (data.syncState || {})[key] || null;
}

function setSyncState(key, value) {
  const data = read();
  data.syncState = data.syncState || {};
  data.syncState[key] = value;
  write(data);
}

module.exports = {
  upsertAppointment,
  markDeleted,
  getAll,
  getByDate,
  setNotes,
  setAssignedTo,
  isEmpty,
  markNotified,
  getSyncState,
  setSyncState,
};
