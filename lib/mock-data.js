// Mock appointments shaped like Clinicea's real /appointments/getAppointmentsByDate response.
// Mixes physiotherapy and non-physiotherapy so the filtering step has something to prove.

let appointments = [
  {
    AppointmentID: 'apt-1001',
    AppointmentStartDateTime: '2026-09-21T09:00:00',
    AppointmentEndDateTime: '2026-09-21T09:45:00',
    AppointmentServiceName: 'Physiotherapy - Home Visit',
    AppointmentServiceCategory: 'Physiotherapy',
    AppointmentPractionerName: 'Dr. Rao',
    PatientID: 'pat-501',
    PatientName: 'Anitha Kumar',
    PatientMobileNo: '9876500001',
    Address1: '12 Lake View Road',
    City: 'Bengaluru',
    PCode: '560034',
    AppointmentStatus: 1,
    notes: '',
  },
  {
    AppointmentID: 'apt-1002',
    AppointmentStartDateTime: '2026-09-21T11:00:00',
    AppointmentEndDateTime: '2026-09-21T11:30:00',
    AppointmentServiceName: 'General Consultation',
    AppointmentServiceCategory: 'Consultation',
    AppointmentPractionerName: 'Dr. Mehta',
    PatientID: 'pat-502',
    PatientName: 'Ravi Shankar',
    PatientMobileNo: '9876500002',
    Address1: '44 MG Road',
    City: 'Bengaluru',
    PCode: '560001',
    AppointmentStatus: 1,
    notes: '',
  },
  {
    AppointmentID: 'apt-1003',
    AppointmentStartDateTime: '2026-09-21T14:00:00',
    AppointmentEndDateTime: '2026-09-21T14:45:00',
    AppointmentServiceName: 'Post-Surgery Physiotherapy',
    AppointmentServiceCategory: 'Physiotherapy',
    AppointmentPractionerName: 'Dr. Rao',
    PatientID: 'pat-503',
    PatientName: 'Salma Farooq',
    PatientMobileNo: '9876500003',
    Address1: '7 Palm Grove Apartments',
    City: 'Bengaluru',
    PCode: '560068',
    AppointmentStatus: 1,
    notes: 'First session done, patient reports reduced knee pain.',
  },
  {
    AppointmentID: 'apt-1004',
    AppointmentStartDateTime: '2026-09-21T16:30:00',
    AppointmentEndDateTime: '2026-09-21T17:00:00',
    AppointmentServiceName: 'Dental Cleaning',
    AppointmentServiceCategory: 'Dental',
    AppointmentPractionerName: 'Dr. Iyer',
    PatientID: 'pat-504',
    PatientName: 'Joseph Thomas',
    PatientMobileNo: '9876500004',
    Address1: '9 Church Street',
    City: 'Bengaluru',
    PCode: '560025',
    AppointmentStatus: 1,
    notes: '',
  },
];

function getAppointmentsByDate() {
  return appointments;
}

function updateNotes(appointmentId, notes) {
  const appt = appointments.find((a) => a.AppointmentID === appointmentId);
  if (!appt) return null;
  appt.notes = notes;
  return appt;
}

module.exports = { getAppointmentsByDate, updateNotes };
