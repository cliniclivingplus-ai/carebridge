// Builds the PDF session report attached to the patient's record in Clinicea.
// It is the complete record of the session: patient, programme, the visit's timeline, every
// question on the session form (answered or not), the physio's declaration and the record IDs.
// Nothing is left out; it simply runs onto more pages when needed.
const PDFDocument = require('pdfkit');
const questionnaire = require('./feedback-questions.json');

const TEAL = '#0f766e';
const MUTED = '#64748b';
const TEXT = '#0f172a';
const RULE = '#e2e8f0';
const NOT_RECORDED = 'Not recorded';

const STEP_LABELS = {
  scheduled: 'Booked',
  confirmed: 'Confirmed',
  on_the_way: 'On the way',
  arrived: 'Arrived at patient',
  in_session: 'Session started',
  completed: 'Session finished',
  notes_submitted: 'Notes submitted',
  cancelled: 'Cancelled',
  no_show: 'Patient not available',
  reschedule_requested: 'Reschedule requested',
  rescheduled: 'Rescheduled',
  reschedule_declined: 'Reschedule declined',
  rebooked: 'Rebooked',
};

const IST = { timeZone: 'Asia/Kolkata' };
function dateTime(iso) {
  if (!iso) return NOT_RECORDED;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', { ...IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function plainDate(ymd) {
  if (!ymd) return NOT_RECORDED;
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function plainTime(hm) {
  if (!hm) return NOT_RECORDED;
  const [h, m] = hm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function minutesBetween(a, b) {
  if (!a || !b) return null;
  const mins = Math.round((new Date(b) - new Date(a)) / 60000);
  return Number.isFinite(mins) && mins >= 0 ? mins : null;
}
function isBlank(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function formatAnswer(q, value) {
  if (isBlank(value)) return NOT_RECORDED;
  switch (q && q.type) {
    case 'scale_0_10': return `${value} / 10`;
    case 'date': return plainDate(value);
    case 'time': return plainTime(value);
    case 'number': return q.id === 'durationMinutes' ? `${value} minutes` : String(value);
    case 'exercise_list':
      return value.map((ex, i) => `${i + 1}. ${ex.name || NOT_RECORDED}\n    Sets: ${ex.sets || NOT_RECORDED} · Reps: ${ex.reps || NOT_RECORDED} · Frequency: ${ex.frequency || NOT_RECORDED}`).join('\n');
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

// session: saved session; parentCase: its case; visit: the visit it belongs to (or null);
// nameOf: username -> display name.
function buildSessionReport(session, parentCase, { visit = null, nameOf = (u) => u || '' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, left: 48, right: 48, bottom: 56 },
      bufferPages: true,
      info: { Title: `Home-visit session ${session.sessionNumber} - ${parentCase.patientName}`, Author: 'CareBridge' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const labelWidth = 185;
    const valueWidth = width - labelWidth;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

    // Start a new page if the next block wouldn't fit, so no row is split across pages.
    function ensureSpace(height) {
      if (doc.y + height > bottomLimit()) doc.addPage();
    }

    function row(label, value, { bold = false } = {}) {
      const text = isBlank(value) ? NOT_RECORDED : String(value);
      doc.font('Helvetica').fontSize(10);
      const hLabel = doc.heightOfString(label, { width: labelWidth - 12 });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      const hValue = doc.heightOfString(text, { width: valueWidth });
      ensureSpace(Math.max(hLabel, hValue) + 6);
      const y = doc.y;
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, left, y, { width: labelWidth - 12 });
      const color = text === NOT_RECORDED ? MUTED : TEXT;
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(text, left + labelWidth, y, { width: valueWidth });
      doc.y = y + Math.max(hLabel, hValue) + 6;
    }

    function section(title, note) {
      ensureSpace(70);
      doc.moveDown(0.5);
      doc.strokeColor(RULE).lineWidth(1).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
      doc.moveDown(0.6);
      doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(12).text(title, left, doc.y, { width });
      if (note) doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text(note, left, doc.y, { width });
      doc.moveDown(0.5);
    }

    // ---- Header ----
    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(18).text('Physiotherapy Home-Visit Session Report', left, doc.y, { width });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
      .text(`Session ${session.sessionNumber} of ${parentCase.allottedSessions} · PhysioWay home visit · Recorded via CareBridge`, { width });

    // ---- Patient ----
    section('Patient');
    row('Patient name', parentCase.patientName, { bold: true });
    row('Clinicea file no.', parentCase.patientId, { bold: true });
    row('Mobile', parentCase.patientMobile);
    row('Address', [parentCase.address, parentCase.city, parentCase.pcode].filter(Boolean).join(', '));

    // ---- Programme ----
    section('Home-visit programme');
    row('Case ID', parentCase.id);
    row('Enrolled by', nameOf(parentCase.createdBy));
    row('Enrolled on', dateTime(parentCase.createdAt));
    row('Sessions allotted', parentCase.allottedSessions);
    row('This session', `${session.sessionNumber} of ${parentCase.allottedSessions}`);
    row('Sessions completed so far', parentCase.completedSessions);
    row('Reason for referral / symptoms', parentCase.symptomsConcern);
    row('Special instructions & care plan', parentCase.instructions);
    row('Physiotherapist', nameOf(session.physioUsername), { bold: true });

    // ---- Visit and its timeline ----
    section('Visit');
    if (!visit) {
      row('Visit', 'Not linked to a scheduled visit (notes were recorded from the case card)');
    } else {
      row('Visit number', visit.visitNumber);
      row('Booked for', `${plainDate(visit.scheduledDate)}, ${plainTime(visit.scheduledTime)}`);
      row('Visit physiotherapist', nameOf(visit.assignedPhysio));
      if (visit.rescheduleReason) row('Rescheduled because', visit.rescheduleReason);
      const at = (step) => {
        const entries = (visit.statusHistory || []).filter((h) => h.step === step);
        return entries.length ? entries[entries.length - 1].timestamp : null;
      };
      const onSite = minutesBetween(at('arrived'), at('completed'));
      const inSession = minutesBetween(at('in_session'), at('completed'));
      row('Time at patient\'s home', onSite === null ? NOT_RECORDED : `${onSite} minutes (arrival to finish)`);
      row('Session length', inSession === null ? NOT_RECORDED : `${inSession} minutes (start to finish)`);

      doc.moveDown(0.3);
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text('Visit timeline', left, doc.y, { width });
      doc.moveDown(0.3);
      // System notes use raw values ("physio_jane", "2026-09-22 at 09:30"); show names and readable dates.
      const readable = (note) => note && note
        .replace(/\b(\d{4}-\d{2}-\d{2})(?: at)? (\d{2}:\d{2})\b/g, (m, d, t) => `${plainDate(d)}, ${plainTime(t)}`)
        .replace(/\b[a-z]+_[a-z]+\b/g, (u) => nameOf(u) || u);
      for (const h of visit.statusHistory || []) {
        const details = [readable(h.note), h.reason && `Reason: ${h.reason}`];
        if (h.coords) {
          details.push(`Check-in location: ${h.coords.lat}, ${h.coords.lng}${h.coords.accuracy ? ` (±${h.coords.accuracy} m)` : ''} - https://maps.google.com/?q=${h.coords.lat},${h.coords.lng}`);
        } else if (h.step === 'arrived') {
          details.push('Check-in location: not shared');
        }
        row(STEP_LABELS[h.step] || h.step, `${dateTime(h.timestamp)} · ${nameOf(h.user)}${details.filter(Boolean).length ? `\n${details.filter(Boolean).join('\n')}` : ''}`);
      }
    }

    // ---- Every question on the session form ----
    for (const sec of questionnaire.sections) {
      const answers = session[sec.id] || {};
      section(sec.title, sec.description);
      for (const q of sec.questions) row(`${q.label}${q.required ? ' *' : ''}`, formatAnswer(q, answers[q.id]));
      // Answers from an older version of the form, kept so nothing recorded is lost.
      const known = new Set(sec.questions.map((q) => q.id));
      for (const [key, v] of Object.entries(answers)) {
        if (!known.has(key) && !isBlank(v)) row(key, formatAnswer(null, v));
      }
    }
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('* required on the session form', left, doc.y, { width });

    // ---- Declaration ----
    section('Physiotherapist declaration');
    const newForm = session.beforeAssessment && session.beforeAssessment.sessionDate;
    row('Declaration', newForm ? questionnaire.confirmation : 'Recorded with an earlier version of the form (no declaration step)');
    row('Confirmed by', nameOf(session.physioUsername));
    row('Submitted', dateTime(session.createdAt));

    // ---- Record details ----
    section('Record details');
    row('CareBridge session ID', session.id);
    row('CareBridge visit ID', visit ? visit.id : 'None');
    row('Report generated', dateTime(new Date().toISOString()));

    // ---- Footer with page numbers ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing below the margin would otherwise start a new page
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(
        `CareBridge · ${parentCase.patientName} (${parentCase.patientId}) · ${parentCase.id} · Session ${session.sessionNumber} · Page ${i - range.start + 1} of ${range.count}`,
        left, doc.page.height - 36, { width, align: 'center', lineBreak: false }
      );
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

module.exports = { buildSessionReport };
