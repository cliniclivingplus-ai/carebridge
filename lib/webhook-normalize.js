// Clinicea's webhook payload shape isn't documented, so this normalizer is defensive:
// it accepts the appointment fields either at the top level or nested under common
// wrapper keys, and fills in what it can. Log unrecognized payloads in production and
// adjust this mapping once you see a real one.

function pickAppointment(body) {
  if (!body) return {};
  return body.Appointment || body.Data || body.data || body;
}

function normalizeAppointment(body) {
  const a = pickAppointment(body);
  return {
    AppointmentID: a.AppointmentID || a.appointmentID || a.ID,
    AppointmentStartDateTime: a.AppointmentStartDateTime || a.appointmentStartDateTime,
    AppointmentEndDateTime: a.AppointmentEndDateTime || a.appointmentEndDateTime,
    AppointmentServiceName: a.AppointmentServiceName || a.appointmentServiceName || '',
    AppointmentServiceCategory: a.AppointmentServiceCategory || a.appointmentServiceCategory || '',
    AppointmentPractionerName: a.AppointmentPractionerName || a.appointmentPractionerName || '',
    AppointmentStatus: a.AppointmentStatus,
    PatientID: a.PatientID || a.patientID,
    PatientName: a.PatientName || a.patientName || '',
    PatientMobileNo: a.PatientMobileNo || a.patientMobileNo || '',
    Address1: a.Address1 || '',
    City: a.City || '',
    PCode: a.PCode || '',
    source: a.source || 'clinicea-webhook',
  };
}

module.exports = { normalizeAppointment };
