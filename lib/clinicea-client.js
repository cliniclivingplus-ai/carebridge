const mock = require('./mock-data');

const BASE_URL = process.env.CLINICEA_BASE_URL || 'https://api.clinicea.com';
const API_KEY = process.env.CLINICEA_API_KEY || '';

function isLiveMode() {
  return Boolean(API_KEY);
}

async function cliniceaFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      api_key: API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Clinicea API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

// GET /api/v3/appointments/getAppointmentsByDate
async function getAppointmentsByDate(dateStr) {
  if (!isLiveMode()) {
    return mock.getAppointmentsByDate();
  }
  const params = new URLSearchParams({ appointmentDate: dateStr, pageNo: '0', pageSize: '100' });
  const data = await cliniceaFetch(`/api/v3/appointments/getAppointmentsByDate?${params}`);
  return Array.isArray(data) ? data : data.Items || data.Result || [];
}

// PUT /api/v3/appointments/updateAppointment (notes field)
async function updateAppointmentNotes(appointmentId, notes) {
  if (!isLiveMode()) {
    return mock.updateNotes(appointmentId, notes);
  }
  const params = new URLSearchParams({ appointmentID: appointmentId, notes });
  return cliniceaFetch(`/api/v3/appointments/updateAppointment?${params}`, { method: 'PUT' });
}

module.exports = { isLiveMode, getAppointmentsByDate, updateAppointmentNotes };
