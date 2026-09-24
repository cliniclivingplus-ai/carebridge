// Builds the PDF session report that is attached to the patient's record in Clinicea.
// Content comes straight from the session form (lib/feedback-questions.json), so the report
// always matches what the physio actually filled in.
const PDFDocument = require('pdfkit');
const questionnaire = require('./feedback-questions.json');

const TEAL = '#0f766e';
const MUTED = '#64748b';
const TEXT = '#0f172a';
const RULE = '#e2e8f0';

function formatExercise(ex) {
  const dose = [ex.sets && `${ex.sets} set${ex.sets === '1' ? '' : 's'}`, ex.reps && `${ex.reps} reps`].filter(Boolean).join(' x ');
  const extra = [dose, ex.frequency].filter(Boolean).join(', ');
  return extra ? `${ex.name} (${extra})` : ex.name;
}

function formatAnswer(q, value) {
  if (q && q.type === 'scale_0_10') return `${value} / 10`;
  if (q && q.type === 'exercise_list') return value.map(formatExercise).join('\n');
  if (q && q.type === 'date') {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function isBlank(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

// session: a saved session; parentCase: its case; physioName: display name of the physio.
function buildSessionReport(session, parentCase, physioName) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Home-visit session ${session.sessionNumber}`, Author: 'CareBridge' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const labelWidth = 190;

    const rule = () => {
      doc.moveDown(0.4);
      doc.strokeColor(RULE).lineWidth(1).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
      doc.moveDown(0.6);
    };

    // Header
    doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(18).text('Physiotherapy Home-Visit Session Report', left, doc.y, { width });
    doc.fillColor(MUTED).font('Helvetica').fontSize(10)
      .text(`Session ${session.sessionNumber} of ${parentCase.allottedSessions} · Recorded via CareBridge (PhysioWay)`, { width });
    rule();

    // Who / when
    const facts = [
      ['Patient', parentCase.patientName],
      ['Clinicea file no.', parentCase.patientId],
      ['Physiotherapist', physioName || session.physioUsername],
      ['Case', parentCase.id],
      ['Recorded', new Date(session.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })],
    ];
    for (const [label, value] of facts) {
      const y = doc.y;
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, left, y, { width: labelWidth });
      doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(10).text(String(value || '-'), left + labelWidth, y, { width: width - labelWidth });
      doc.moveDown(0.3);
    }
    if (parentCase.symptomsConcern) {
      const y = doc.y;
      doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Reason for referral', left, y, { width: labelWidth });
      doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(parentCase.symptomsConcern, left + labelWidth, y, { width: width - labelWidth });
    }

    // Every answered question, section by section, in form order
    for (const section of questionnaire.sections) {
      const answers = session[section.id] || {};
      const rows = section.questions.filter((q) => !isBlank(answers[q.id]));
      const known = new Set(section.questions.map((q) => q.id));
      const legacy = Object.entries(answers).filter(([k, v]) => !known.has(k) && !isBlank(v));
      if (!rows.length && !legacy.length) continue;

      rule();
      doc.fillColor(TEAL).font('Helvetica-Bold').fontSize(12).text(section.title, left, doc.y, { width });
      doc.moveDown(0.5);
      const printRow = (label, value) => {
        const y = doc.y;
        doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, left, y, { width: labelWidth - 10 });
        const labelBottom = doc.y;
        doc.fillColor(TEXT).font('Helvetica').fontSize(10).text(value, left + labelWidth, y, { width: width - labelWidth });
        doc.y = Math.max(doc.y, labelBottom);
        doc.moveDown(0.35);
      };
      for (const q of rows) printRow(q.label, formatAnswer(q, answers[q.id]));
      for (const [k, v] of legacy) printRow(k, formatAnswer(null, v));
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing below the bottom margin would start a new page, so lift the margin for the footer.
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(`CareBridge · ${parentCase.id} · Session ${session.sessionNumber}`, left, doc.page.height - 36, { width, align: 'center', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

module.exports = { buildSessionReport };
