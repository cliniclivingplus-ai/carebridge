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

// GET /api/v3/appointments/getChanges -- confirmed against the live API that this returns
// appointments regardless of date (e.g. querying with a recent lastSyncDTime returned an
// appointment days in the future), each tagged DataStatusValue: "Added"/"Modified"/"Deleted".
// This is what makes "notify me even if it's booked for next month" possible without
// scanning every future date individually.
async function getAppointmentChangesSince(lastSyncIso) {
  if (!isLiveMode()) {
    return mock.getAppointmentChangesSince(lastSyncIso);
  }
  const params = new URLSearchParams({ lastSyncDTime: lastSyncIso.slice(0, 10), pageNo: '1', pageSize: '100' });
  const data = await cliniceaFetch(`/api/v3/appointments/getChanges?${params}`);
  const list = Array.isArray(data) ? data : data.Items || data.Result || [];
  return list.map((raw) => ({ ...mapLiveAppointment(raw), dataStatus: raw.DataStatusValue || 'Added' }));
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
    // Clinicea's internal patient GUID -- what patient-level APIs (e.g. createEncounterFull) need.
    CliniceaPatientID: raw.ID || '',
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

// Writing into a patient's EMR is irreversible, and this call has not yet been verified against
// the live API, so it stays off until CLINICEA_ENCOUNTER_SYNC=true is set after a sandbox test.
function isEncounterSyncEnabled() {
  return isLiveMode() && process.env.CLINICEA_ENCOUNTER_SYNC === 'true';
}

// POST /api/v3/patientVisits/createEncounterFull -- per the v3 Swagger spec the payload is a
// JSON body (DTOEncounterUpload): patid = Clinicea's internal patient ID (the patient record's
// `ID`, NOT the File Number), encdtm = encounter datetime, srvname = service, note = free text.
// Response is DOEMRRetValue, which reports failures via SavingErrorCode/SavingErrorText.
async function addPatientEncounter(cliniceaPatientId, encounterNotes, { encounterDate, serviceName } = {}) {
  if (!cliniceaPatientId) throw new Error('Case has no Clinicea internal patient ID');
  const body = {
    patid: cliniceaPatientId,
    encdtm: encounterDate || new Date().toISOString(),
    srvname: serviceName || 'Physiotherapy Home Visit',
    note: encounterNotes,
  };
  const result = await cliniceaFetch('/api/v3/patientVisits/createEncounterFull', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (result && (result.SavingErrorCode || result.SavingErrorText)) {
    throw new Error(`Clinicea rejected encounter: ${result.SavingErrorText || result.SavingErrorCode}`);
  }
  return { encounterId: (result && (result.EncounterID || result.ID)) || null };
}

module.exports = {
  isLiveMode,
  getAppointmentsByDate,
  getAppointmentChangesSince,
  updateAppointmentNotes,
  getPatientByUniqueId,
  addPatientEncounter,
  isEncounterSyncEnabled,
};
