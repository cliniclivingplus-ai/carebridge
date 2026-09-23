// Email (Resend) and SMS (Twilio) notifications. Both are safe to call with no config --
// they log and no-op rather than throw, so the rest of the app never has to check whether
// a channel is set up before calling it.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'CareBridge <onboarding@resend.dev>';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';

// Hard kill switch: nothing actually sends unless this is explicitly "true", regardless of
// whether RESEND_API_KEY / Twilio creds are configured. Keeps every test/dev run from
// accidentally emailing or texting anyone while this is still being built out. Flip this to
// "true" only when you're ready for real notifications to go out.
const NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED === 'true';

function emailConfigured() {
  return Boolean(RESEND_API_KEY);
}

function smsConfigured() {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
}

async function sendEmail(to, subject, text) {
  if (!to) return;
  if (!NOTIFICATIONS_ENABLED) {
    console.log(`[notify:email] DRY RUN (NOTIFICATIONS_ENABLED is not "true") to=${to} subject="${subject}"`);
    return;
  }
  if (!emailConfigured()) {
    console.log(`[notify:email] (not configured, skipped) to=${to} subject="${subject}"`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[notify:email] failed to=${to}: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`[notify:email] error to=${to}:`, err.message);
  }
}

async function sendSms(to, body) {
  if (!to) return;
  if (!NOTIFICATIONS_ENABLED) {
    console.log(`[notify:sms] DRY RUN (NOTIFICATIONS_ENABLED is not "true") to=${to} body="${body}"`);
    return;
  }
  if (!smsConfigured()) {
    console.log(`[notify:sms] (not configured, skipped) to=${to} body="${body}"`);
    return;
  }
  try {
    const params = new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: to, Body: body });
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    if (!res.ok) {
      const respBody = await res.text().catch(() => '');
      console.error(`[notify:sms] failed to=${to}: ${res.status} ${respBody}`);
    }
  } catch (err) {
    console.error(`[notify:sms] error to=${to}:`, err.message);
  }
}

// Notifies every team member who has an email/phone on file. Failures for one recipient
// don't block the others -- Promise.allSettled, not a chain that stops on first error.
async function notifyTeamOfNewBooking(team, appt) {
  const when = new Date(appt.start).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const subject = `New physiotherapy booking: ${appt.patientName || 'a patient'} — ${when}`;
  const body = [
    `A new physiotherapy home-visit appointment was booked in Clinicea:`,
    ``,
    `Patient: ${appt.patientName || '—'}`,
    `When: ${when}`,
    `Service: ${appt.service || '—'}`,
    `Mobile: ${appt.patientMobile || '—'}`,
    ``,
    `Open CareBridge to claim or assign this visit.`,
  ].join('\n');

  const tasks = [];
  for (const member of team) {
    if (member.email) tasks.push(sendEmail(member.email, subject, body));
    if (member.phone) tasks.push(sendSms(member.phone, body));
  }
  await Promise.allSettled(tasks);
}

function isEnabled() {
  return NOTIFICATIONS_ENABLED;
}

module.exports = { emailConfigured, smsConfigured, isEnabled, sendEmail, sendSms, notifyTeamOfNewBooking };
