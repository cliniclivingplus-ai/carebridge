// Checks a submitted session assessment against lib/feedback-questions.json and returns a clean
// copy: only known questions, only allowed options, required answers present. The form is built
// from the same file, so this rejects anything the form itself couldn't have produced.
const questionnaire = require('./feedback-questions.json');

const MAX_TEXT = 4000;

class FeedbackError extends Error {}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

function cleanText(q, v) {
  if (typeof v !== 'string') throw new FeedbackError(`"${q.label}" must be text`);
  const s = v.trim();
  if (s.length > MAX_TEXT) throw new FeedbackError(`"${q.label}" is too long`);
  return s;
}

function cleanAnswer(q, v) {
  switch (q.type) {
    case 'date': {
      const s = cleanText(q, v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new FeedbackError(`"${q.label}" is not a valid date`);
      return s;
    }
    case 'time': {
      const s = cleanText(q, v);
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new FeedbackError(`"${q.label}" is not a valid time`);
      return s;
    }
    case 'number': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new FeedbackError(`"${q.label}" must be a number`);
      if ((q.min !== undefined && n < q.min) || (q.max !== undefined && n > q.max)) {
        throw new FeedbackError(`"${q.label}" must be between ${q.min} and ${q.max}`);
      }
      return n;
    }
    case 'scale_0_10': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10) throw new FeedbackError(`"${q.label}" must be a whole number from 0 to 10`);
      return n;
    }
    case 'single_choice': {
      const s = cleanText(q, v);
      if (!q.options.includes(s)) throw new FeedbackError(`"${q.label}" has an unknown option`);
      return s;
    }
    case 'multi_choice': {
      if (!Array.isArray(v)) throw new FeedbackError(`"${q.label}" must be a list`);
      const out = [];
      for (const item of v) {
        const s = cleanText(q, item);
        const isOther = q.allowOther && /^Other: .+/.test(s);
        if (!q.options.includes(s) && !isOther) throw new FeedbackError(`"${q.label}" has an unknown option`);
        if (!out.includes(s)) out.push(s);
      }
      if (q.exclusiveOption && out.includes(q.exclusiveOption) && out.length > 1) {
        throw new FeedbackError(`"${q.label}": "${q.exclusiveOption}" can't be combined with other options`);
      }
      return out;
    }
    case 'textarea':
    case 'text':
      return cleanText(q, v);
    case 'exercise_list': {
      if (!Array.isArray(v)) throw new FeedbackError(`"${q.label}" must be a list`);
      return v
        .map((ex) => ({
          name: typeof ex?.name === 'string' ? ex.name.trim().slice(0, 200) : '',
          sets: typeof ex?.sets === 'string' || typeof ex?.sets === 'number' ? String(ex.sets).trim().slice(0, 20) : '',
          reps: typeof ex?.reps === 'string' || typeof ex?.reps === 'number' ? String(ex.reps).trim().slice(0, 40) : '',
          frequency: typeof ex?.frequency === 'string' ? ex.frequency.trim() : '',
        }))
        .filter((ex) => ex.name)
        .map((ex) => {
          if (ex.frequency && !(q.frequencyOptions || []).includes(ex.frequency)) {
            throw new FeedbackError(`"${q.label}": unknown frequency "${ex.frequency}"`);
          }
          return ex;
        });
    }
    default:
      throw new FeedbackError(`Unsupported question type ${q.type}`);
  }
}

// body: { beforeAssessment: {...}, afterSummary: {...}, confirmed: true }
function validateFeedback(body) {
  if (!body || body.confirmed !== true) {
    throw new FeedbackError('Please confirm the patient and session time, and that you personally completed this session');
  }
  const result = {};
  for (const section of questionnaire.sections) {
    const submitted = (body[section.id] && typeof body[section.id] === 'object') ? body[section.id] : {};
    const clean = {};
    for (const q of section.questions) {
      const raw = submitted[q.id];
      let value = isBlank(raw) ? undefined : cleanAnswer(q, raw);
      if (isBlank(value)) value = undefined;
      if (q.required && value === undefined) throw new FeedbackError(`Please answer "${q.label}"`);
      if (value !== undefined) clean[q.id] = value;
    }
    result[section.id] = clean;
  }

  const before = result.beforeAssessment || {};
  // Session date/time as entered by the physio, interpreted as India time (where visits happen).
  const sessionDateTime = before.sessionDate && before.sessionTime
    ? new Date(`${before.sessionDate}T${before.sessionTime}:00+05:30`).toISOString()
    : new Date().toISOString();

  return {
    beforeAssessment: result.beforeAssessment || {},
    afterSummary: result.afterSummary || {},
    clinicalNotes: (result.afterSummary && result.afterSummary.clinicalNotes) || '',
    sessionDateTime,
  };
}

module.exports = { validateFeedback, FeedbackError, questionnaire };
