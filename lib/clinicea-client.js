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

// Real getAppointmentsByDate responses use a flat DTO with different field names than the
// online-booking DTO the Swagger spec's other examples suggested -- confirmed against a live
// call: ID (not AppointmentID), StartDateTime/EndDateTime (no "Appointment" prefix), ServiceName/
// ServiceCategory (no prefix), StaffFirstName+StaffLastName (no AppointmentPractionerName),
// PatientMobile (not PatientMobileNo). No address/pincode fields are included at all -- that
// would need a separate patients/getPatientByID call, not done here.
function mapLiveAppointment(raw) {
  return {
    AppointmentID: raw.ID,
    AppointmentStartDateTime: raw.StartDateTime,
    AppointmentEndDateTime: raw.EndDateTime,
    AppointmentServiceName: raw.ServiceName || '',
    AppointmentServiceCategory: raw.ServiceCategory || '',
    AppointmentPractionerName: [raw.StaffFirstName, raw.StaffLastName].filter(Boolean).join(' '),
    PatientID: raw.PatientID,
    PatientName: raw.PatientName || [raw.PatientFirstName, raw.PatientLastName].filter(Boolean).join(' '),
    PatientMobileNo: raw.PatientMobile || '',
    Address1: '',
    City: '',
    PCode: '',
    source: 'clinicea',
  };
}

// GET /api/v3/appointments/getAppointmentsByDate
async function getAppointmentsByDate(dateStr) {
  if (!isLiveMode()) {
    return mock.getAppointmentsByDate();
  }
  // pageNo starts at 1 (not 0), and pageSize must be >= 10 -- both confirmed against the live API,
  // which otherwise returns a 400 with a plain-text validation message rather than a JSON error.
  const params = new URLSearchParams({ appointmentDate: dateStr, pageNo: '1', pageSize: '100' });
  const data = await cliniceaFetch(`/api/v3/appointments/getAppointmentsByDate?${params}`);
  const list = Array.isArray(data) ? data : data.Items || data.Result || [];
  return list.map(mapLiveAppointment);
}

// PUT /api/v3/appointments/updateAppointment (notes field)
async function updateAppointmentNotes(appointmentId, notes) {
  if (!isLiveMode()) {
    return mock.updateNotes(appointmentId, notes);
  }
  const params = new URLSearchParams({ appointmentID: appointmentId, notes });
  return cliniceaFetch(`/api/v3/appointments/updateAppointment?${params}`, { method: 'PUT' });
}

// GET /api/v3/patients/getPatient -- lookup by "Clinicea unique ID". Confirmed empirically
// against the live API that searchBy is: 0 = File Number, 1 = Unique Number (NRIC/PAN/Passport
// -- what Clinicea's own data model literally calls PatientUniqueIDNumber), 2 = Mobile (requires
// searchOption = country code), 3 = Email. Default to File Number since that's the identifier
// clinic staff actually use day to day; override with PATIENT_ID_SEARCH_BY if "unique ID" is
// meant to be the NRIC/PAN/Passport-style field instead.
const PATIENT_ID_SEARCH_BY = process.env.PATIENT_ID_SEARCH_BY || '0';

function mapLivePatient(raw) {
  return {
    PatientID: raw.FileNo || raw.PatientUniqueIDNumber || '',
    Name: raw.FullName || [raw.FirstName, raw.LastName].filter(Boolean).join(' '),
    Mobile: raw.Mobile ? `${raw.MobileCountryCode || ''} ${raw.Mobile}`.trim() : '',
    Address: [raw.Address1, raw.Address2, raw.City, raw.State, raw.PostalCode].filter(Boolean).join(', '),
    BloodGroup: raw.BloodGroup || '',
    Allergies: Array.isArray(raw.AllAllergies) ? raw.AllAllergies.join(', ') : raw.AllAllergies || '',
    Notes: raw.Notes || '',
  };
}

async function getPatientByUniqueId(idValue) {
  if (!isLiveMode()) {
    return mock.getPatientByUniqueId(idValue);
  }
  const params = new URLSearchParams({ searchBy: PATIENT_ID_SEARCH_BY, searchText: idValue });
  const data = await cliniceaFetch(`/api/v3/patients/getPatient?${params}`);
  const list = Array.isArray(data) ? data : [];
  if (!list[0]) return null;
  return mapLivePatient(list[0]);
}

module.exports = { isLiveMode, getAppointmentsByDate, updateAppointmentNotes, getPatientByUniqueId };
