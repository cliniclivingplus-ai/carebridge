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
  const staffName = a.AppointmentPractionerName || a.appointmentPractionerName ||
    [a.StaffFirstName || a.staffFirstName, a.StaffLastName || a.staffLastName].filter(Boolean).join(' ') ||
    a.StaffName || a.staffName || '';

  return {
    AppointmentID: a.AppointmentID || a.appointmentID || a.ID || a.id,
    AppointmentStartDateTime: a.AppointmentStartDateTime || a.appointmentStartDateTime || a.StartDateTime || a.startDateTime,
    AppointmentEndDateTime: a.AppointmentEndDateTime || a.appointmentEndDateTime || a.EndDateTime || a.endDateTime,
    AppointmentServiceName: a.AppointmentServiceName || a.appointmentServiceName || a.ServiceName || a.serviceName || '',
    AppointmentServiceCategory: a.AppointmentServiceCategory || a.appointmentServiceCategory || a.ServiceCategory || a.serviceCategory || '',
    AppointmentPractionerName: staffName,
    AppointmentStatus: a.AppointmentStatus || a.appointmentStatus || a.Status || a.status,
    PatientID: a.PatientID || a.patientID,
    PatientName: a.PatientName || a.patientName || [a.PatientFirstName, a.PatientLastName].filter(Boolean).join(' ') || '',
    PatientMobileNo: a.PatientMobileNo || a.patientMobileNo || a.PatientMobile || a.patientMobile || '',
    Address1: a.Address1 || a.address1 || '',
    City: a.City || a.city || '',
    PCode: a.PCode || a.pcode || '',
    source: a.source || 'clinicea-webhook',
  };
}

module.exports = { normalizeAppointment };
