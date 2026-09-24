const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const datePicker = document.getElementById('date-picker');
const dateDisplayStr = document.getElementById('date-display-str');
const prevDateBtn = document.getElementById('prev-date-btn');
const nextDateBtn = document.getElementById('next-date-btn');
const todayBtn = document.getElementById('today-btn');

const listEl = document.getElementById('appointments-list');
const emptyState = document.getElementById('empty-state');
const whoEl = document.getElementById('who');
const userRoleBadge = document.getElementById('user-role-badge');
const avatarInitials = document.getElementById('avatar-initials');
const modeBadge = document.getElementById('mode-badge');
const modeText = document.getElementById('mode-text');
const logoutBtn = document.getElementById('logout-btn');
const simDoctorBtn = document.getElementById('sim-doctor-btn');
const simPatientBtn = document.getElementById('sim-patient-btn');
const demoTools = document.getElementById('demo-tools');

const statTotal = document.getElementById('stat-total');
const statMyVisits = document.getElementById('stat-my-visits');
const statUnassigned = document.getElementById('stat-unassigned');

const searchInput = document.getElementById('search-input');
const filterChips = document.querySelectorAll('.chip');
const mobNavItems = document.querySelectorAll('.mob-nav-item');

const lookupForm = document.getElementById('lookup-form');
const lookupInput = document.getElementById('lookup-input');
const lookupResult = document.getElementById('lookup-result');
const lookupError = document.getElementById('lookup-error');

// Feedback Modal Elements
const feedbackModal = document.getElementById('feedback-modal');
const feedbackForm = document.getElementById('feedback-form');
const closeFeedbackModal = document.getElementById('close-feedback-modal');
const btnCancelFb = document.getElementById('btn-cancel-fb');
const fbCaseId = document.getElementById('fb-case-id');
const fbPatientId = document.getElementById('fb-patient-id');
const fbQuestions = document.getElementById('fb-questions');
const fbConfirm = document.getElementById('fb-confirm');
const fbError = document.getElementById('fb-error');

// Allot Modal Elements
const allotModal = document.getElementById('allot-modal');
const allotForm = document.getElementById('allot-form');
const closeAllotModal = document.getElementById('close-allot-modal');
const btnCancelAllot = document.getElementById('btn-cancel-allot');
const allotPatientId = document.getElementById('allot-patient-id');
const allotPatientName = document.getElementById('allot-patient-name');
const allotPatientMobile = document.getElementById('allot-patient-mobile');
const allotPatientAddress = document.getElementById('allot-patient-address');
const allotPatientCity = document.getElementById('allot-patient-city');
const allotPatientPcode = document.getElementById('allot-patient-pcode');
const allotSymptoms = document.getElementById('allot-symptoms');
const allotCount = document.getElementById('allot-count');
const allotPhysio = document.getElementById('allot-physio');

let pollTimer = null;
let currentUser = null;
let currentUserRole = 'external_physio';
let currentUserName = '';
let team = []; // [{username, name, role}]
let rawCases = [];
let activeFilter = 'open'; // 'open', 'mine', 'all', 'completed'
let activeQuery = '';


// toISOString() converts to UTC before formatting -- in any timezone ahead of UTC (e.g. IST,
// UTC+5:30), local midnight on day X becomes day X-1 in UTC, so slicing the date back out
// silently rounds down to the previous day. That made "next day" a no-op (advance a day
// locally, then get rounded straight back to the same date) and made "today" occasionally
// wrong right after local midnight. Use local date components instead, never UTC.
function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return toLocalDateStr(new Date());
}

function formatDateDisplay(dateStr) {
  const t = todayStr();
  if (dateStr === t) return 'Today';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function adjustDate(days) {
  const current = datePicker.value || todayStr();
  const d = new Date(current + 'T00:00:00');
  d.setDate(d.getDate() + days);
  datePicker.value = toLocalDateStr(d);
  dateDisplayStr.textContent = formatDateDisplay(datePicker.value);
  loadAppointments().catch(() => {});
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') {
    showLogin();
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function roleLabel(role) {
  if (role === 'sales') return 'Sales Team';
  if (role === 'clp_doctor') return 'CLP Doctor';
  return 'PhysioWay';
}

// Phone bottom bar: the two tab buttons mirror the first two filter chips, so they need the
// same role-specific wording (Sales never has "My Cases").
function updateMobileNavLabels(openLabel, mineLabel) {
  const openSpan = document.querySelector('#mob-nav-all span');
  const mineSpan = document.querySelector('#mob-nav-mine span');
  if (openSpan) openSpan.textContent = openLabel;
  if (mineSpan) mineSpan.textContent = mineLabel;
}

// Puts the filter chips in the given order (the same buttons are shared by every role).
function orderFilterChips(order) {
  const container = filterChips[0] && filterChips[0].parentElement;
  if (!container) return;
  for (const key of order) {
    const chip = [...filterChips].find((c) => c.dataset.filter === key);
    if (chip) container.appendChild(chip);
  }
}

// Keeps the filter chips and the phone bottom bar pointing at the same list.
function setActiveFilter(filter) {
  activeFilter = filter;
  filterChips.forEach((c) => c.classList.toggle('active', c.dataset.filter === filter));
  mobNavItems.forEach((i) => {
    if (i.dataset.filter) i.classList.toggle('active', i.dataset.filter === filter);
  });
}

function updateFilterChipLabels(labels) {
  filterChips.forEach((chip) => {
    const filterKey = chip.dataset.filter;
    if (labels[filterKey]) {
      const span = chip.querySelector('span');
      if (span) {
        span.textContent = labels[filterKey];
      } else {
        chip.textContent = labels[filterKey];
      }
    }
  });
}

function showApp(userObj, liveMode) {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  currentUser = userObj.username;
  currentUserRole = userObj.role || 'external_physio';
  currentUserName = userObj.name || userObj.username;

  whoEl.textContent = currentUserName;
  avatarInitials.textContent = (currentUserName || 'U').charAt(0).toUpperCase();

  if (userRoleBadge) {
    userRoleBadge.textContent = roleLabel(currentUserRole);
    userRoleBadge.className = `role-badge role-${currentUserRole}`;
  }

  const teamSettingsBtn = document.getElementById('team-settings-btn');
  if (teamSettingsBtn) {
    teamSettingsBtn.hidden = !(currentUserRole === 'sales' || currentUserRole === 'clp_doctor');
  }

  // Dynamic Role UI Adaptations
  const bannerTitle = document.getElementById('role-banner-title');
  const bannerSub = document.getElementById('role-banner-sub');
  const dateBar = document.querySelector('.date-bar');
  const lookupSection = document.querySelector('.lookup-section');
  const statCard1 = document.querySelector('.stats-grid .stat-card:nth-child(1) .stat-label');
  const statCard2 = document.querySelector('.stats-grid .stat-card:nth-child(2) .stat-label');
  const statCard3 = document.querySelector('.stats-grid .stat-card:nth-child(3) .stat-label');

  if (dateBar) dateBar.hidden = true;

  // PhysioWay has no Clinicea access: no patient lookup and no enrolling. They only see the
  // cases Sales/Doctors create.
  if (lookupSection) lookupSection.hidden = currentUserRole === 'external_physio';

  if (currentUserRole === 'external_physio') {
    if (bannerTitle) bannerTitle.textContent = 'Physio Care Portal';
    if (bannerSub) bannerSub.textContent = 'See the home-visit cases set up by the clinic, take a case, and record your session notes.';
    if (statCard1) statCard1.textContent = 'Total Cases';
    if (statCard2) statCard2.textContent = 'My Claimed Cases';
    if (statCard3) statCard3.textContent = 'Available Open Cases';

    updateFilterChipLabels({
      open: 'Open Cases (Claimable)',
      mine: 'My Cases',
      all: 'All Cases',
      completed: 'Completed'
    });
    updateMobileNavLabels('Open Cases', 'My Cases');
    orderFilterChips(['all', 'completed', 'open', 'mine']);
    setActiveFilter('all');
  } else {
    // Sales and Doctor do the same job on this screen (enrol patients, watch progress), so they
    // get the same layout and the same words -- only the page title differs.
    const isDoctor = currentUserRole === 'clp_doctor';
    if (bannerTitle) bannerTitle.textContent = isDoctor ? 'Clinical Director Dashboard' : 'Sales Enrolment Portal';
    if (bannerSub) bannerSub.textContent = isDoctor
      ? 'Enrol patients by Clinicea ID, follow every home-visit programme, and review session notes.'
      : 'Search patients by Clinicea ID, set up home visit plans, and monitor physio assignments.';
    if (lookupSection) {
      const mainContent = document.querySelector('.main-content');
      const roleBanner = document.getElementById('role-banner');
      if (mainContent && roleBanner && roleBanner.nextElementSibling !== lookupSection) {
        mainContent.insertBefore(lookupSection, roleBanner.nextElementSibling);
      }
    }
    if (statCard1) statCard1.textContent = 'Total Enrolments';
    if (statCard2) statCard2.textContent = 'Assigned Cases';
    if (statCard3) statCard3.textContent = 'Unassigned Cases';

    // "Assigned" = a physio has taken it and sessions remain; "Unassigned" = no physio yet.
    updateFilterChipLabels({
      all: 'All Enrolments',
      completed: 'Completed',
      mine: 'Assigned Cases',
      open: 'Unassigned Cases'
    });
    updateMobileNavLabels('Unassigned', 'Assigned');
    orderFilterChips(['all', 'completed', 'mine', 'open']);
    setActiveFilter('all');
  }

  // The live site is always on Clinicea, so a badge there says nothing; only flag demo data.
  modeBadge.hidden = Boolean(liveMode);
  modeText.textContent = 'DEMO DATA';
  modeBadge.className = 'mode-badge mock';
  if (demoTools) demoTools.hidden = liveMode;
}

function showLogin() {
  loginScreen.hidden = false;
  appScreen.hidden = true;
  currentUser = null;
  currentUserRole = null;
  currentUserName = null;
  if (pollTimer) clearInterval(pollTimer);
}

function sourceLabel(source) {
  if (source === 'patient-online-booking') return 'Online Booking';
  if (source === 'doctor-booked-in-clinicea') return 'Clinicea Booking';
  return 'Clinicea';
}

function syncLabel(status) {
  if (status === 'pending') return 'Syncing...';
  if (status === 'failed') return 'Saved in CareBridge';
  return 'Synced to Clinicea';
}
function teamMemberName(username) {
  const member = team.find((t) => t.username === username);
  return member ? member.name : username;
}

function assignOptionsHtml(currentAssignee) {
  const options = ['<option value="">-- Open Task (Unassigned) --</option>'];
  const physios = team.filter((m) => m.role === 'external_physio' || !m.role);
  for (const member of physios) {
    const label = member.username === currentUser ? `${member.name} (me)` : member.name;
    const selected = member.username === currentAssignee ? 'selected' : '';
    options.push(`<option value="${member.username}" ${selected}>${label}</option>`);
  }
  return options.join('');
}

// Always called with EVERY case (not the filtered list on screen), so the counters don't
// change when a different filter chip is selected.
function updateStats(casesList) {
  if (statTotal) statTotal.textContent = casesList.length;
  const openCount = casesList.filter((c) => c.status === 'open').length;
  const activeCount = casesList.filter((c) => c.status === 'in_progress').length;
  const myCount = casesList.filter((c) => c.assignedPhysio === currentUser && c.status !== 'completed').length;

  if (currentUserRole === 'sales') {
    if (statMyVisits) statMyVisits.textContent = activeCount;
    if (statUnassigned) statUnassigned.textContent = openCount;
  } else {
    if (statMyVisits) statMyVisits.textContent = myCount;
    if (statUnassigned) statUnassigned.textContent = openCount;
  }
}

function filterAppointments() {
  renderCasesList(rawCases);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// The session assessment questions (lib/feedback-questions.json). The form, the session
// details view and the labels all come from this, so changing the questions needs no code.
let questionnaire = { sections: [] };
let questionLabels = {};
let questionOrder = [];
let questionnaireLoaded = null;

// Answers saved with the first version of the form, so older sessions still read properly.
const LEGACY_LABELS = {
  vitalsStatus: 'Pre-session vitals & condition',
  patientReadiness: 'Patient readiness for therapy',
  mobilityStatus: 'Post-session mobility & range of motion',
  exercisesCompleted: 'Exercises & modalities completed',
  patientCompliance: 'Patient compliance & home exercise adherence',
};

function loadQuestionLabels() {
  if (!questionnaireLoaded) {
    questionnaireLoaded = api('/api/feedback-questions')
      .then((data) => {
        questionnaire = data.questionnaire || { sections: [] };
        questionLabels = { ...LEGACY_LABELS };
        questionOrder = [];
        for (const section of questionnaire.sections || []) {
          for (const q of section.questions) {
            questionLabels[q.id] = q.label;
            questionOrder.push(q.id);
          }
        }
      })
      .catch(() => {
        questionnaireLoaded = null;
      });
  }
  return questionnaireLoaded;
}

function findQuestion(id) {
  for (const section of questionnaire.sections || []) {
    const q = section.questions.find((item) => item.id === id);
    if (q) return q;
  }
  return null;
}

function formatExercise(ex) {
  const dose = [ex.sets && `${ex.sets} set${ex.sets === '1' ? '' : 's'}`, ex.reps && `${ex.reps} reps`].filter(Boolean).join(' x ');
  const extra = [dose, ex.frequency].filter(Boolean).join(', ');
  return extra ? `${ex.name} (${extra})` : ex.name;
}

function formatAnswer(key, value) {
  const q = findQuestion(key);
  if (q && q.type === 'scale_0_10') return `${value} / 10`;
  if (q && q.type === 'date') return new Date(`${value}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  if (q && q.type === 'time') return new Date(`1970-01-01T${value}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (q && q.type === 'exercise_list') return value.map(formatExercise).join('\n');
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

const SYNC_LABELS = {
  synced: 'Synced to Clinicea',
  pending: 'Not yet sent to Clinicea',
  failed: 'Clinicea sync failed',
  simulated: 'Demo mode, not sent',
};

// Which session is open on each case card. Kept outside the cards so the 10-second refresh
// doesn't close the session someone is reading.
const openSessionByCase = new Map();

function answerRows(answers) {
  // Same order as the feedback form; answers to questions no longer in the list go last.
  const rank = (key) => (questionOrder.includes(key) ? questionOrder.indexOf(key) : Infinity);
  return Object.entries(answers || {})
    .sort(([a], [b]) => rank(a) - rank(b))
    .filter(([key, value]) => key !== 'clinicalNotes' && value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => `<div class="session-answer"><span>${escapeHtml(questionLabels[key] || key)}</span><strong>${escapeHtml(formatAnswer(key, value))}</strong></div>`)
    .join('');
}

function sectionTitle(id, fallback) {
  const section = (questionnaire.sections || []).find((sec) => sec.id === id);
  return (section && section.title) || fallback;
}

function sessionDetailHtml(s, allotted) {
  const when = new Date(s.createdAt || s.scheduledDate).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const sync = s.cliniceaSyncStatus || 'pending';
  const before = answerRows(s.beforeAssessment);
  const after = answerRows(s.afterSummary);
  return `
    <div class="session-detail">
      <div class="session-detail-head">
        <strong>Session ${s.sessionNumber} of ${allotted}</strong>
        <span>${escapeHtml(s.physioUsername ? teamMemberName(s.physioUsername) : 'Physio')} - ${escapeHtml(when)}</span>
      </div>
      <div class="session-sync sync-${escapeHtml(sync)}">${escapeHtml(SYNC_LABELS[sync] || sync)}${s.cliniceaSyncError && sync !== 'synced' ? ` <small>(${escapeHtml(s.cliniceaSyncError)})</small>` : ''}</div>
      ${before ? `<div class="session-group"><div class="session-group-title">${escapeHtml(sectionTitle('beforeAssessment', 'Session details'))}</div>${before}</div>` : ''}
      ${after ? `<div class="session-group"><div class="session-group-title">${escapeHtml(sectionTitle('afterSummary', 'Post-session assessment'))}</div>${after}</div>` : ''}
      ${s.clinicalNotes ? `<div class="session-group"><div class="session-group-title">Physio notes</div><p class="session-notes">${escapeHtml(s.clinicalNotes)}</p></div>` : ''}
    </div>
  `;
}

function visitSummaryHtml(item) {
  const vs = item.visitSummary;
  if (!vs || !vs.total) return '';
  const next = vs.nextVisit;
  const parts = [`${vs.done} of ${vs.total} visits done`];
  if (vs.cancelled) parts.push(`${vs.cancelled} cancelled`);
  if (vs.noShow) parts.push(`${vs.noShow} patient not available`);
  const alerts = [];
  if (vs.overdue) alerts.push(`${vs.overdue} overdue`);
  if (vs.pendingReschedule) alerts.push('reschedule requested');
  return `
    <div class="case-next-visit">
      <div>
        <span class="case-next-label">Next visit</span>
        <strong>${next ? `${escapeHtml(new Date(`${next.date}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }))} · ${escapeHtml(prettyTime(next.time))}` : 'None booked'}</strong>
      </div>
      <span class="case-next-meta">${escapeHtml(parts.join(' · '))}${alerts.length ? ` · <span class="case-next-alert">${escapeHtml(alerts.join(', '))}</span>` : ''}</span>
    </div>`;
}

function renderCasesList(casesList) {
  listEl.innerHTML = '';
  emptyState.hidden = casesList.length > 0;

  const canEditAllotment = currentUserRole === 'sales' || currentUserRole === 'clp_doctor';
  const isPhysio = currentUserRole === 'external_physio';
  const canRecordFeedback = currentUserRole === 'external_physio' || currentUserRole === 'clp_doctor';

  for (const item of casesList) {
    const card = document.createElement('div');
    const isMine = item.assignedPhysio === currentUser;
    card.className = `appt-card glass-card ${isMine ? 'is-mine' : ''}`;

    const assignedName = item.assignedPhysio ? teamMemberName(item.assignedPhysio) : 'Unassigned Pool';
    const allotted = item.allottedSessions || 10;
    const completed = item.completedSessions || 0;
    const pct = allotted > 0 ? Math.min(100, Math.round((completed / allotted) * 100)) : 0;
    const statusClass = `status-${item.status || 'open'}`;
    const statusLabel = (item.status || 'open').replace('_', ' ');

    card.innerHTML = `
      <div class="card-header-bar">
        <div class="time-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/></svg>
          <span>${item.id}</span>
        </div>
        <span class="case-status-badge ${statusClass}">${statusLabel}</span>
      </div>

      <div class="patient-info">
        <div class="patient-name">${item.patientName || 'Patient'} <small style="font-size:12px; color:var(--text-muted); font-weight:600">(${item.patientId})</small></div>
        <div class="practitioner-sub">Enrolled by ${teamMemberName(item.createdBy)}</div>
      </div>

      <!-- Symptoms & Clinical Concern Box -->
      ${item.symptomsConcern ? `
        <div class="symptoms-box">
          <strong>Primary Symptoms &amp; Concern</strong>
          <div>${item.symptomsConcern}</div>
        </div>
      ` : ''}

      <!-- Session Allotment & Progress Bar -->
      <div class="session-tracker-box">
        <div class="session-header">
          <span class="session-title">Home-Visit Programme Progress</span>
          <span class="session-counts">Completed <strong>${completed}</strong> of <strong>${allotted}</strong> Sessions</span>
        </div>
        <div class="session-progress-bar">
          <div class="session-progress-fill" style="width: ${pct}%;"></div>
        </div>
        ${canEditAllotment ? `
          <button class="btn-allot-sessions" data-case-id="${item.id}" data-patient-id="${item.patientId || ''}" data-allotted="${allotted}" data-completed="${completed}" data-name="${escapeHtml(item.patientName || 'Patient')}" data-physio="${escapeHtml(item.assignedPhysio || '')}" data-instructions="${escapeHtml(item.instructions || '')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            <span>Edit Allotment</span>
          </button>
        ` : ''}
      </div>

      ${visitSummaryHtml(item)}

      <div class="contact-strip">
        ${item.patientMobile ? `
          <a href="tel:${item.patientMobile}" class="contact-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>Call</span>
          </a>
        ` : ''}
        ${item.address ? `
          <a href="https://maps.google.com/?q=${encodeURIComponent([item.address, item.city, item.pcode].filter(Boolean).join(', '))}" target="_blank" class="contact-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>Map (${item.city || 'Location'})</span>
          </a>
        ` : ''}
      </div>

      ${!isPhysio ? `
      <div class="assign-box assign-readonly">
        <span class="assign-label">Physio</span>
        <span class="assigned-tag">${item.assignedPhysio ? escapeHtml(assignedName) : 'Waiting for a physio to take this case'}</span>
      </div>
      ` : `
      <div class="assign-box">
        <div class="assign-header">
          <span class="assign-label">Assigned Physio</span>
          <span class="assigned-tag" data-assign-tag-for="${item.id}">${isMine ? 'Assigned to You' : assignedName}</span>
        </div>
        <div class="assign-controls">
          ${(isMine && item.status !== 'completed') ? `
            <!-- Hand over: only on your own active case (the server rejects anything else). -->
            <select class="assign-select" data-assign-for="${item.id}" aria-label="Hand this case to another physio">
              ${assignOptionsHtml(item.assignedPhysio)}
            </select>
          ` : ''}
          ${(!item.assignedPhysio || item.status === 'open') ? `
            <button class="btn-claim-case" data-claim-case="${item.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 5 5L20 7"/></svg>
              <span>Take Case</span>
            </button>
          ` : ''}
        </div>
      </div>
      `}

      <!-- Feedback Action Button -->
      ${(canRecordFeedback && item.status !== 'completed' && (!isPhysio || isMine)) ? `
        <div class="feedback-action-strip">
          <button class="btn-open-feedback" data-case-id="${item.id}" data-patient-id="${item.patientId || ''}" data-name="${item.patientName || 'Patient'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Record Session Feedback (Session ${completed + 1} of ${allotted})</span>
          </button>
        </div>
      ` : ''}

      <!-- Session History Timeline Box -->
      <div class="notes-box">
        <div class="notes-label-bar">
          <label>Session Evaluation History &amp; Clinicea Sync</label>
        </div>
        ${(() => {
          const sessions = item.sessions || [];
          if (sessions.length === 0) {
            return `<div class="empty-card" style="padding:12px"><p style="font-size:12px; margin:0">No sessions completed yet for this home-visit programme.</p></div>`;
          }
          const openId = openSessionByCase.get(item.id);
          const openSession = sessions.find((sess) => sess.id === openId);
          return `
            <div class="session-pills">
              ${sessions.map((sess) => `
                <button type="button" class="session-pill ${sess.id === openId ? 'active' : ''}" data-open-session="${escapeHtml(sess.id)}" data-case="${escapeHtml(item.id)}" aria-expanded="${sess.id === openId}">
                  <span class="sync-dot sync-${escapeHtml(sess.cliniceaSyncStatus || 'pending')}" title="${escapeHtml(SYNC_LABELS[sess.cliniceaSyncStatus] || '')}"></span>
                  Session ${sess.sessionNumber}
                </button>
              `).join('')}
            </div>
            ${openSession ? sessionDetailHtml(openSession, allotted) : '<p class="session-hint">Tap a session to see what the physio recorded.</p>'}
          `;
        })()}
      </div>
    `;
    listEl.appendChild(card);
  }

  attachCardEvents();
}

function attachCardEvents() {
  // Session pills: open one session's details; tapping the open one closes it.
  listEl.querySelectorAll('[data-open-session]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const caseId = btn.dataset.case;
      const sessionId = btn.dataset.openSession;
      if (openSessionByCase.get(caseId) === sessionId) openSessionByCase.delete(caseId);
      else openSessionByCase.set(caseId, sessionId);
      renderCasesList(rawCases);
    });
  });

  // Claim Case / Take Case button
  listEl.querySelectorAll('[data-claim-case]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const caseId = btn.dataset.claimCase;
      btn.disabled = true;
      try {
        await api(`/api/cases/${encodeURIComponent(caseId)}/claim`, { method: 'POST' });
        await loadCases();
      } catch (err) {
        alert(`Claim failed: ${err.message}`);
        btn.disabled = false;
      }
    });
  });

  // Assign Case select dropdown
  listEl.querySelectorAll('select[data-assign-for]').forEach((select) => {
    select.addEventListener('change', async () => {
      const caseId = select.dataset.assignFor;
      select.disabled = true;
      try {
        await api(`/api/cases/${encodeURIComponent(caseId)}/assign`, {
          method: 'PUT',
          body: JSON.stringify({ assignedPhysio: select.value || null }),
        });
        await loadCases();
      } catch (err) {
        alert(`Assignment failed: ${err.message}`);
        select.disabled = false;
      }
    });
  });

  // Open Feedback Modal
  listEl.querySelectorAll('.btn-open-feedback').forEach((btn) => {
    btn.addEventListener('click', () => {
      const caseId = btn.dataset.caseId;
      const patientId = btn.dataset.patientId;
      const name = btn.dataset.name;

      if (fbCaseId) fbCaseId.value = caseId;
      if (fbPatientId) fbPatientId.value = patientId;
      document.getElementById('modal-subtitle').textContent = `${name} (${patientId})`;
      const fbVisit = document.getElementById('fb-visit-id');
      if (fbVisit) fbVisit.value = '';
      renderFeedbackForm();
      if (feedbackModal) feedbackModal.hidden = false;
    });
  });

  // Open Edit Allotment Modal
  listEl.querySelectorAll('.btn-allot-sessions').forEach((btn) => {
    btn.addEventListener('click', () => {
      const caseId = btn.dataset.caseId;
      const patientId = btn.dataset.patientId;
      const allotted = btn.dataset.allotted;
      const completed = btn.dataset.completed;
      const name = btn.dataset.name;
      const physio = btn.dataset.physio;
      const instructions = btn.dataset.instructions;

      document.getElementById('edit-allotment-case-id').value = caseId;
      document.getElementById('edit-allotment-patient-name').textContent = `${name} (${patientId})`;
      document.getElementById('edit-allotment-progress-info').textContent = `Completed ${completed} of ${allotted} Sessions`;
      const countInput = document.getElementById('edit-allotment-count');
      countInput.value = allotted;
      countInput.min = completed || 1;
      document.getElementById('edit-allotment-instructions').value = instructions || '';
      document.getElementById('edit-allotment-error').textContent = '';

      // Populate Physio select options
      const physioSelect = document.getElementById('edit-allotment-physio');
      if (physioSelect) {
        physioSelect.innerHTML = '<option value="">-- Open Task (Unassigned Pool) --</option>' +
          teamMembers
            .map((m) => `<option value="${escapeHtml(m.username)}" ${m.username === physio ? 'selected' : ''}>${escapeHtml(m.name)} (${m.role})</option>`)
            .join('');
      }

      const editAllotmentModal = document.getElementById('edit-allotment-modal');
      if (editAllotmentModal) editAllotmentModal.hidden = false;
    });
  });
}

// ---------- Session assessment form (built from the questionnaire) ----------

function todayInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTimeInputValue() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function exerciseRowHtml(q, index) {
  const freq = (q.frequencyOptions || []).map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  return `
    <div class="fq-exercise" data-exercise-row>
      <div class="fq-exercise-head">
        <strong>Exercise ${index + 1}</strong>
        <button type="button" class="text-link fq-remove" data-remove-exercise>Remove</button>
      </div>
      <label class="fq-sub">Exercise name<input type="text" data-ex="name" maxlength="200" placeholder="e.g. Isometric neck" /></label>
      <div class="fq-exercise-grid">
        <label class="fq-sub">Sets<input type="text" data-ex="sets" inputmode="numeric" maxlength="20" /></label>
        <label class="fq-sub">Reps<input type="text" data-ex="reps" maxlength="40" /></label>
      </div>
      <label class="fq-sub">Frequency
        <select data-ex="frequency"><option value="">Select frequency</option>${freq}</select>
      </label>
    </div>`;
}

function questionHtml(q) {
  const name = `fq-${q.id}`;
  const req = q.required ? '<span class="fq-required" aria-hidden="true">*</span>' : '';
  const title = `<div class="fq-label" id="${name}-label">${escapeHtml(q.label)} ${req}</div>`;
  let body = '';
  switch (q.type) {
    case 'date':
      body = `<input type="date" name="${name}" value="${todayInputValue()}" aria-labelledby="${name}-label" />`;
      break;
    case 'time':
      body = `<input type="time" name="${name}" value="${nowTimeInputValue()}" aria-labelledby="${name}-label" />`;
      break;
    case 'number':
      body = `<input type="number" name="${name}" inputmode="numeric" min="${q.min ?? ''}" max="${q.max ?? ''}" value="${q.default ?? ''}" aria-labelledby="${name}-label" />`;
      break;
    case 'scale_0_10':
      body = `
        <div class="fq-scale" role="radiogroup" aria-labelledby="${name}-label">
          ${Array.from({ length: 11 }, (_, n) => `<label class="fq-scale-dot"><input type="radio" name="${name}" value="${n}" /><span>${n}</span></label>`).join('')}
        </div>
        <div class="fq-scale-ends"><span>No pain</span><span>Worst pain</span></div>`;
      break;
    case 'single_choice':
      body = `<div class="fq-options" role="radiogroup" aria-labelledby="${name}-label">${q.options.map((o) => `
        <label class="fq-option"><input type="radio" name="${name}" value="${escapeHtml(o)}" /><span>${escapeHtml(o)}</span></label>`).join('')}</div>`;
      break;
    case 'multi_choice':
      body = `<div class="fq-options" role="group" aria-labelledby="${name}-label">${q.options.map((o) => `
        <label class="fq-option"><input type="checkbox" name="${name}" value="${escapeHtml(o)}" /><span>${escapeHtml(o)}</span></label>`).join('')}
        ${q.allowOther ? `
          <label class="fq-option"><input type="checkbox" name="${name}" value="__other" data-other-toggle /><span>Other</span></label>
          <input type="text" class="fq-other" data-other-for="${name}" maxlength="200" placeholder="Describe other" hidden />` : ''}
      </div>`;
      break;
    case 'textarea':
      body = `<textarea name="${name}" rows="3" maxlength="4000" aria-labelledby="${name}-label"></textarea>`;
      break;
    case 'exercise_list':
      body = `<div class="fq-exercises" data-exercises-for="${name}">${exerciseRowHtml(q, 0)}</div>
        <button type="button" class="fq-add" data-add-exercise="${q.id}">+ Add exercise</button>`;
      break;
    default:
      body = `<input type="text" name="${name}" aria-labelledby="${name}-label" />`;
  }
  return `<div class="fq" data-question="${escapeHtml(q.id)}">${title}${body}</div>`;
}

function renderFeedbackForm() {
  if (!fbQuestions) return;
  fbQuestions.innerHTML = (questionnaire.sections || []).map((section) => `
    <section class="fq-section">
      <div class="fb-section-title"><span>${escapeHtml(section.title)}</span></div>
      ${section.description ? `<p class="fq-section-desc">${escapeHtml(section.description)}</p>` : ''}
      ${section.questions.map(questionHtml).join('')}
    </section>`).join('');
  if (fbConfirm) fbConfirm.checked = false;
  const confirmText = document.getElementById('fb-confirm-text');
  if (confirmText) confirmText.textContent = questionnaire.confirmation || 'I confirm these details are correct.';
  if (fbError) fbError.textContent = '';
  const card = feedbackModal && feedbackModal.querySelector('.modal-card');
  if (card) card.scrollTop = 0;
}

function renumberExercises(container) {
  container.querySelectorAll('[data-exercise-row] .fq-exercise-head strong').forEach((el, i) => {
    el.textContent = `Exercise ${i + 1}`;
  });
}

// One set of listeners on the form container handles every question, however many there are.
if (fbQuestions) {
  fbQuestions.addEventListener('change', (e) => {
    const input = e.target;
    if (input.matches('[data-other-toggle]')) {
      const other = fbQuestions.querySelector(`[data-other-for="${input.name}"]`);
      if (other) {
        other.hidden = !input.checked;
        if (input.checked) other.focus();
      }
    }
    // "None" (exclusiveOption) and the other options can't both be ticked.
    if (input.type === 'checkbox' && input.checked) {
      const q = findQuestion(input.name.replace(/^fq-/, ''));
      if (q && q.exclusiveOption) {
        fbQuestions.querySelectorAll(`input[name="${input.name}"]`).forEach((box) => {
          if (box === input) return;
          if (input.value === q.exclusiveOption || box.value === q.exclusiveOption) box.checked = false;
        });
      }
    }
  });

  fbQuestions.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-exercise]');
    if (add) {
      const q = findQuestion(add.dataset.addExercise);
      const container = fbQuestions.querySelector(`[data-exercises-for="fq-${q.id}"]`);
      container.insertAdjacentHTML('beforeend', exerciseRowHtml(q, container.children.length));
      container.lastElementChild.querySelector('input').focus();
      return;
    }
    const remove = e.target.closest('[data-remove-exercise]');
    if (remove) {
      const container = remove.closest('.fq-exercises');
      remove.closest('[data-exercise-row]').remove();
      if (!container.children.length) {
        const q = findQuestion(container.dataset.exercisesFor.replace(/^fq-/, ''));
        container.insertAdjacentHTML('beforeend', exerciseRowHtml(q, 0));
      }
      renumberExercises(container);
    }
  });
}

function readAnswer(q) {
  const name = `fq-${q.id}`;
  switch (q.type) {
    case 'scale_0_10': {
      const picked = fbQuestions.querySelector(`input[name="${name}"]:checked`);
      return picked ? Number(picked.value) : undefined;
    }
    case 'single_choice': {
      const picked = fbQuestions.querySelector(`input[name="${name}"]:checked`);
      return picked ? picked.value : undefined;
    }
    case 'multi_choice': {
      const values = [];
      fbQuestions.querySelectorAll(`input[name="${name}"]:checked`).forEach((box) => {
        if (box.value === '__other') {
          const text = fbQuestions.querySelector(`[data-other-for="${name}"]`).value.trim();
          if (text) values.push(`Other: ${text}`);
        } else {
          values.push(box.value);
        }
      });
      return values;
    }
    case 'exercise_list':
      return [...fbQuestions.querySelectorAll(`[data-exercises-for="${name}"] [data-exercise-row]`)]
        .map((row) => ({
          name: row.querySelector('[data-ex="name"]').value.trim(),
          sets: row.querySelector('[data-ex="sets"]').value.trim(),
          reps: row.querySelector('[data-ex="reps"]').value.trim(),
          frequency: row.querySelector('[data-ex="frequency"]').value,
        }))
        .filter((ex) => ex.name);
    case 'number': {
      const raw = fbQuestions.querySelector(`[name="${name}"]`).value;
      return raw === '' ? undefined : Number(raw);
    }
    default: {
      const el = fbQuestions.querySelector(`[name="${name}"]`);
      return el ? el.value.trim() : undefined;
    }
  }
}

function isEmptyAnswer(v) {
  return v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

// Returns { payload } or { error, element } for the first unanswered required question.
function collectFeedback() {
  const payload = { confirmed: Boolean(fbConfirm && fbConfirm.checked) };
  for (const section of questionnaire.sections || []) {
    payload[section.id] = {};
    for (const q of section.questions) {
      const value = readAnswer(q);
      if (q.required && isEmptyAnswer(value)) {
        return { error: `Please answer "${q.label}"`, element: fbQuestions.querySelector(`[data-question="${q.id}"]`) };
      }
      if (!isEmptyAnswer(value)) payload[section.id][q.id] = value;
    }
  }
  if (!payload.confirmed) {
    return { error: 'Please tick the confirmation before saving.', element: fbConfirm && fbConfirm.closest('.fq-confirm') };
  }
  return { payload };
}

if (closeFeedbackModal) closeFeedbackModal.addEventListener('click', () => (feedbackModal.hidden = true));
if (btnCancelFb) btnCancelFb.addEventListener('click', () => (feedbackModal.hidden = true));

if (feedbackForm) {
  feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const caseId = fbCaseId.value;
    const submitBtn = feedbackForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const { payload, error, element } = collectFeedback();
    const fbVisit = document.getElementById('fb-visit-id');
    if (payload && fbVisit && fbVisit.value) payload.visitId = fbVisit.value;
    if (error) {
      if (fbError) fbError.textContent = error;
      if (element) {
        element.classList.add('fq-missing');
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => element.classList.remove('fq-missing'), 2500);
      }
      submitBtn.disabled = false;
      return;
    }
    if (fbError) fbError.textContent = '';

    try {
      await api(`/api/cases/${encodeURIComponent(caseId)}/feedback`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      feedbackModal.hidden = true;
      await loadCases();
      alert('Session assessment saved.');
    } catch (err) {
      if (fbError) fbError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

if (closeAllotModal) closeAllotModal.addEventListener('click', () => (allotModal.hidden = true));
if (btnCancelAllot) btnCancelAllot.addEventListener('click', () => (allotModal.hidden = true));

if (allotForm) {
  allotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patientId = allotPatientId.value;
    const patientName = allotPatientName.value;
    const patientMobile = allotPatientMobile.value;
    const address = allotPatientAddress.value;
    const city = allotPatientCity.value;
    const pcode = allotPatientPcode.value;
    const symptomsConcern = allotSymptoms.value.trim();
    const allottedSessions = parseInt(allotCount.value, 10) || 10;
    const instructions = document.getElementById('allot-notes')?.value.trim() || '';
    const startDate = document.getElementById('allot-start-date')?.value || new Date().toISOString().split('T')[0];
    const startTime = document.getElementById('allot-start-time')?.value || '10:00';
    const pattern = document.getElementById('allot-pattern')?.value || 'MWF';

    const submitBtn = allotForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await api('/api/cases', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          patientName,
          patientMobile,
          address,
          city,
          pcode,
          symptomsConcern,
          allottedSessions,
          instructions,
          startDate,
          startTime,
          pattern,
        }),
      });

      allotModal.hidden = true;
      await loadCases();
      alert(`Patient ${patientName} (${patientId}) enrolled successfully as a Home-Visit Case with a ${allottedSessions}-visit ${pattern} schedule!`);
    } catch (err) {
      alert(`Case enrollment failed: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// Patient Lookup Form
if (lookupForm) {
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = lookupInput.value.trim();
    if (!query) return;

    lookupError.textContent = '';
    lookupResult.hidden = true;
    const submitBtn = lookupForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const data = await api(`/api/patients/lookup?id=${encodeURIComponent(query)}`);
      const p = data.patient;
      lookupResult.hidden = false;
      lookupResult.innerHTML = `
        <div class="patient-lookup-card">
          <div class="lookup-patient-name">${escapeHtml(p.name)} <span class="patient-id-tag">${escapeHtml(p.id)}</span></div>
          <div class="lookup-patient-details">
            <span><svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${escapeHtml(p.mobile || 'No mobile')}</span>
            <span><svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ${escapeHtml(p.address || 'No address')}</span>
            ${p.bloodGroup ? `<span><svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg> Blood Group: ${escapeHtml(p.bloodGroup)}</span>` : ''}
          </div>
          ${p.notes ? `<div class="lookup-notes"><strong>Notes:</strong> ${escapeHtml(p.notes)}</div>` : ''}
          <button class="pill-btn btn-enroll-now" style="margin-top:10px">Enrol in Home-Visit Case</button>
        </div>
      `;

      lookupResult.querySelector('.btn-enroll-now').addEventListener('click', () => {
        allotPatientId.value = p.id;
        allotPatientName.value = p.name;
        allotPatientMobile.value = p.mobile || '';
        allotPatientAddress.value = p.address || '';
        allotPatientCity.value = '';
        allotPatientPcode.value = '';
        allotSymptoms.value = p.symptomsConcern || p.notes || '';
        allotCount.value = 10;
        const startDateInput = document.getElementById('allot-start-date');
        if (startDateInput) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          startDateInput.min = todayInputValue();
          startDateInput.value = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
        }
        document.getElementById('allot-modal-subtitle').textContent = `Enroll ${p.name} (${p.id})`;
        allotModal.hidden = false;
      });
    } catch (err) {
      lookupError.textContent = err.message || 'Patient not found';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function loadTeam() {
  const data = await api('/api/team');
  team = data.team;
  const allotPhysioSelect = document.getElementById('allot-physio');
  if (allotPhysioSelect) {
    const physios = team.filter((m) => m.role === 'external_physio' || !m.role);
    allotPhysioSelect.innerHTML = '<option value="">-- Open Task (Unassigned Pool) --</option>' +
      physios.map((m) => `<option value="${m.username}">${m.name}</option>`).join('');
  }
}

// For Sales/Doctor the second chip means "in progress" (assigned to any physio), not
// "assigned to me" -- nobody assigns cases to a Sales account, so 'mine' would always be empty.
function serverFilterFor(filter) {
  if (filter === 'mine' && currentUserRole !== 'external_physio') return 'active';
  return filter;
}

async function loadCases() {
  await loadQuestionLabels();
  const [data, all] = await Promise.all([
    api(`/api/cases?status=${encodeURIComponent(serverFilterFor(activeFilter))}&query=${encodeURIComponent(activeQuery)}`),
    api('/api/cases?status=all'),
  ]);
  rawCases = data.cases;
  updateStats(all.cases);
  renderCasesList(rawCases);
  await loadTodayVisits();
}

// ---------- Visits (schedule, lifecycle, monitoring) ----------

let visitsDays = 1; // 1 = Today, 7 = Next 7 days
const openTimelines = new Set(); // visit ids whose timeline is expanded (kept across refreshes)

const VISIT_STATUS = {
  scheduled: { label: 'Waiting for a physio', tone: 'muted' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  on_the_way: { label: 'On the way', tone: 'progress' },
  arrived: { label: 'Arrived', tone: 'progress' },
  in_session: { label: 'In session', tone: 'progress' },
  completed: { label: 'Notes due', tone: 'warn' },
  notes_submitted: { label: 'Done', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
  no_show: { label: 'Patient not available', tone: 'bad' },
  reschedule_requested: { label: 'Reschedule requested', tone: 'warn' },
};

const HISTORY_LABELS = {
  scheduled: 'Booked',
  confirmed: 'Confirmed',
  on_the_way: 'On the way',
  arrived: 'Arrived',
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

// The one button a physio sees for their visit's next step.
const NEXT_STEP = {
  confirmed: { step: 'on_the_way', label: "I'm on my way" },
  on_the_way: { step: 'arrived', label: "I've arrived" },
  arrived: { step: 'in_session', label: 'Start session' },
  in_session: { step: 'completed', label: 'Finish session & write notes' },
  completed: { step: 'notes', label: 'Write session notes' },
};

const NOT_STARTED = ['scheduled', 'confirmed'];
const CLOSED = ['notes_submitted', 'cancelled', 'no_show'];

function nowTimeIST() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

function minutesOf(t) {
  return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3, 5), 10);
}

function prettyDate(dateStr, today) {
  const d = new Date(`${dateStr}T00:00:00`);
  const label = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  if (dateStr === today) return `Today · ${label}`;
  const tomorrow = new Date(`${today}T00:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.getTime() === tomorrow.getTime()) return `Tomorrow · ${label}`;
  return label;
}

function prettyTime(t) {
  return new Date(`1970-01-01T${t}:00`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Things Sales/Doctor should look at, worked out from the schedule itself.
function visitFlags(v, today) {
  const flags = [];
  const active = !CLOSED.includes(v.status) && v.status !== 'completed';
  if (active && v.scheduledDate < today) flags.push({ key: 'overdue', label: 'Overdue' });
  if (NOT_STARTED.includes(v.status) && v.scheduledDate === today && minutesOf(nowTimeIST()) > minutesOf(v.scheduledTime) + 15) {
    flags.push({ key: 'late', label: 'Not started yet' });
  }
  if (!v.assignedPhysio && active) flags.push({ key: 'unassigned', label: 'No physio' });
  if (v.status === 'completed') flags.push({ key: 'notes', label: 'Notes not submitted' });
  if (v.status === 'reschedule_requested') flags.push({ key: 'reschedule', label: 'Needs your decision' });
  if (v.overlapWarning) flags.push({ key: 'overlap', label: 'Overlaps another visit' });
  return flags;
}

function timelineHtml(v) {
  const items = (v.statusHistory || []).map((h) => {
    const when = new Date(h.timestamp).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const where = h.coords
      ? ` · <a href="https://maps.google.com/?q=${h.coords.lat},${h.coords.lng}" target="_blank" rel="noopener">check-in location${h.coords.accuracy ? ` (±${h.coords.accuracy} m)` : ''}</a>`
      : '';
    const extra = [h.note, h.reason && `Reason: ${h.reason}`].filter(Boolean).map(escapeHtml).join(' · ');
    return `<li><strong>${escapeHtml(HISTORY_LABELS[h.step] || h.step)}</strong> <span>${escapeHtml(when)} · ${escapeHtml(teamMemberName(h.user) || h.user || '')}</span>${where}${extra ? `<div class="visit-tl-extra">${extra}</div>` : ''}</li>`;
  }).join('');
  const open = openTimelines.has(v.id) ? ' open' : '';
  return `<details class="visit-timeline" data-timeline="${escapeHtml(v.id)}"${open}><summary>Timeline</summary><ol>${items}</ol></details>`;
}

function visitActionsHtml(v, today) {
  const id = escapeHtml(v.id);
  const staff = currentUserRole === 'sales' || currentUserRole === 'clp_doctor';
  const mine = v.assignedPhysio === currentUser;
  const buttons = [];

  if (mine && !staff || (mine && currentUserRole === 'clp_doctor')) {
    const next = NEXT_STEP[v.status];
    if (next && (v.scheduledDate <= today || v.status === 'completed')) {
      buttons.push(`<button type="button" class="btn-primary visit-btn" data-visit-step="${next.step}" data-visit-id="${id}" data-case-id="${escapeHtml(v.caseId)}">${next.label}</button>`);
    }
    if (NOT_STARTED.includes(v.status)) {
      buttons.push(`<button type="button" class="btn-secondary visit-btn" data-visit-modal="request" data-visit-id="${id}">Ask to reschedule</button>`);
    }
    if (['confirmed', 'on_the_way', 'arrived'].includes(v.status) && v.scheduledDate <= today) {
      buttons.push(`<button type="button" class="btn-secondary visit-btn" data-visit-modal="no_show" data-visit-id="${id}">Patient not available</button>`);
    }
  }

  if (staff) {
    if (v.status === 'reschedule_requested') {
      buttons.push(`<button type="button" class="btn-primary visit-btn" data-visit-decision="approve" data-visit-id="${id}">Approve new time</button>`);
      buttons.push(`<button type="button" class="btn-secondary visit-btn" data-visit-modal="decline" data-visit-id="${id}">Decline</button>`);
    }
    if (NOT_STARTED.includes(v.status) || ['cancelled', 'no_show', 'reschedule_requested'].includes(v.status)) {
      const label = ['cancelled', 'no_show'].includes(v.status) ? 'Rebook' : 'Change date/time';
      buttons.push(`<button type="button" class="btn-secondary visit-btn" data-visit-modal="edit" data-visit-id="${id}">${label}</button>`);
    }
  }

  if ((staff || mine) && !CLOSED.includes(v.status) && !['completed', 'in_session'].includes(v.status)) {
    buttons.push(`<button type="button" class="text-link visit-cancel" data-visit-modal="cancel" data-visit-id="${id}">Cancel visit</button>`);
  }
  return buttons.join('');
}

let visitsById = new Map();

function renderVisits(data) {
  const container = document.getElementById('today-visits-list');
  const flagsEl = document.getElementById('visits-flags');
  if (!container) return;
  const list = data.visits || [];
  const today = data.today;
  visitsById = new Map(list.map((v) => [v.id, v]));
  const staff = currentUserRole === 'sales' || currentUserRole === 'clp_doctor';

  // Summary of what needs attention (Sales/Doctor).
  if (flagsEl) {
    const counts = {};
    for (const v of list) for (const fl of visitFlags(v, today)) counts[fl.label] = (counts[fl.label] || 0) + 1;
    const entries = Object.entries(counts);
    flagsEl.hidden = !staff || entries.length === 0;
    flagsEl.innerHTML = entries.map(([label, n]) => `<span class="visit-flag">${escapeHtml(label)}: ${n}</span>`).join('');
  }

  if (list.length === 0) {
    container.innerHTML = `<p class="visits-empty">${visitsDays === 1 ? 'No visits today.' : 'No visits in the next 7 days.'}</p>`;
    return;
  }

  const byDate = new Map();
  for (const v of list) {
    if (!byDate.has(v.scheduledDate)) byDate.set(v.scheduledDate, []);
    byDate.get(v.scheduledDate).push(v);
  }

  container.innerHTML = [...byDate].map(([date, dayVisits]) => `
    <div class="visits-day">
      ${visitsDays > 1 ? `<h4 class="visits-day-title">${escapeHtml(prettyDate(date, today))}</h4>` : ''}
      ${dayVisits.map((v) => {
        const status = VISIT_STATUS[v.status] || { label: v.status, tone: 'muted' };
        const flags = visitFlags(v, today);
        const req = v.rescheduleRequest;
        const mapUrl = `https://maps.google.com/?q=${encodeURIComponent(v.address || '')}`;
        return `
          <article class="visit-card${flags.length ? ' has-flags' : ''}${v.assignedPhysio === currentUser ? ' is-mine' : ''}">
            <div class="visit-card-head">
              <span class="visit-time">${escapeHtml(prettyTime(v.scheduledTime))}</span>
              <div class="visit-who">
                <strong>${escapeHtml(v.patientName)}</strong>
                <span>Visit ${v.visitNumber}${staff ? ` · ${escapeHtml(v.assignedPhysio ? teamMemberName(v.assignedPhysio) : 'No physio yet')}` : ''}</span>
              </div>
              <span class="visit-status tone-${status.tone}">${escapeHtml(status.label)}</span>
            </div>
            ${v.address ? `<div class="visit-address">${escapeHtml(v.address)}</div>` : ''}
            ${flags.length && staff ? `<div class="visit-flags-row">${flags.map((fl) => `<span class="visit-flag flag-${fl.key}">${escapeHtml(fl.label)}</span>`).join('')}</div>` : ''}
            ${req ? `<div class="visit-request">Asked to move to <strong>${escapeHtml(prettyDate(req.newDate, today))}, ${escapeHtml(prettyTime(req.newTime))}</strong> · ${escapeHtml(req.reason || '')}</div>` : ''}
            ${v.cancellationReason && ['cancelled', 'no_show'].includes(v.status) ? `<div class="visit-request">Reason: ${escapeHtml(v.cancellationReason)}</div>` : ''}
            <div class="visit-actions">
              ${v.patientMobile ? `<a class="contact-btn" href="tel:${escapeHtml(v.patientMobile)}">Call</a>` : ''}
              ${v.address ? `<a class="contact-btn" href="${mapUrl}" target="_blank" rel="noopener">Map</a>` : ''}
              ${visitActionsHtml(v, today)}
            </div>
            ${timelineHtml(v)}
          </article>`;
      }).join('')}
    </div>`).join('');
}

async function loadTodayVisits() {
  const container = document.getElementById('today-visits-list');
  if (!container) return;
  try {
    const data = await api(`/api/visits/schedule?days=${visitsDays}`);
    renderVisits(data);
  } catch (err) {
    container.innerHTML = `<p class="error">Couldn't load visits: ${escapeHtml(err.message)}</p>`;
  }
}

function getPosition() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null), // location is a record only -- never blocks the check-in
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

function openNotesForVisit(visit) {
  fbCaseId.value = visit.caseId;
  const fbVisit = document.getElementById('fb-visit-id');
  if (fbVisit) fbVisit.value = visit.id;
  document.getElementById('modal-subtitle').textContent = `${visit.patientName} · Visit ${visit.visitNumber}`;
  renderFeedbackForm();
  if (feedbackModal) feedbackModal.hidden = false;
}

// ----- the small visit window (reschedule / change time / cancel / no-show / decline) -----
const VISIT_MODAL_MODES = {
  request: { title: 'Ask to reschedule', when: true, reason: 'Why does it need to move?', reasonRequired: true, submit: 'Send request' },
  edit: { title: 'Change date/time', when: true, reason: 'Note (optional)', reasonRequired: false, submit: 'Save' },
  cancel: { title: 'Cancel visit', when: false, reason: 'Why is it cancelled?', reasonRequired: true, submit: 'Cancel visit' },
  no_show: { title: 'Patient not available', when: false, reason: 'What happened?', reasonRequired: true, submit: 'Save' },
  decline: { title: 'Decline reschedule', when: false, reason: 'Note for the physio (optional)', reasonRequired: false, submit: 'Decline' },
};
let visitModalState = null;

function openVisitModal(mode, visit) {
  const cfg = VISIT_MODAL_MODES[mode];
  visitModalState = { mode, visit };
  document.getElementById('visit-modal-title').textContent = cfg.title;
  document.getElementById('visit-modal-subtitle').textContent = `${visit.patientName} · Visit ${visit.visitNumber} · ${visit.scheduledDate} ${visit.scheduledTime}`;
  document.getElementById('visit-form-when').hidden = !cfg.when;
  const date = document.getElementById('visit-form-date');
  const time = document.getElementById('visit-form-time');
  date.value = visit.scheduledDate;
  date.min = todayInputValue();
  time.value = visit.scheduledTime;
  document.getElementById('visit-form-reason-label').textContent = cfg.reason;
  document.getElementById('visit-form-reason').value = '';
  document.getElementById('visit-form-submit').textContent = cfg.submit;
  document.getElementById('visit-form-error').textContent = '';
  document.getElementById('visit-modal').hidden = false;
  (cfg.when ? date : document.getElementById('visit-form-reason')).focus();
}

function closeVisitModal() {
  document.getElementById('visit-modal').hidden = true;
  visitModalState = null;
}

async function refreshAfterVisitChange() {
  await Promise.all([loadTodayVisits(), loadCases().catch(() => {})]);
}

const visitForm = document.getElementById('visit-form');
if (visitForm) {
  document.getElementById('close-visit-modal').addEventListener('click', closeVisitModal);
  document.getElementById('visit-form-cancel').addEventListener('click', closeVisitModal);
  visitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!visitModalState) return;
    const { mode, visit } = visitModalState;
    const cfg = VISIT_MODAL_MODES[mode];
    const errorEl = document.getElementById('visit-form-error');
    const date = document.getElementById('visit-form-date').value;
    const time = document.getElementById('visit-form-time').value;
    const reason = document.getElementById('visit-form-reason').value.trim();
    if (cfg.when && (!date || !time)) { errorEl.textContent = 'Please choose a date and time.'; return; }
    if (cfg.reasonRequired && !reason) { errorEl.textContent = 'Please give a reason.'; return; }

    const submitBtn = document.getElementById('visit-form-submit');
    submitBtn.disabled = true;
    try {
      const id = encodeURIComponent(visit.id);
      if (mode === 'request') await api(`/api/visits/${id}/reschedule-request`, { method: 'POST', body: JSON.stringify({ newDate: date, newTime: time, reason }) });
      if (mode === 'edit') await api(`/api/visits/${id}/schedule`, { method: 'PUT', body: JSON.stringify({ date, time, reason }) });
      if (mode === 'cancel') await api(`/api/visits/${id}/step`, { method: 'POST', body: JSON.stringify({ step: 'cancelled', reason }) });
      if (mode === 'no_show') await api(`/api/visits/${id}/step`, { method: 'POST', body: JSON.stringify({ step: 'no_show', reason }) });
      if (mode === 'decline') await api(`/api/visits/${id}/reschedule-decision`, { method: 'POST', body: JSON.stringify({ approve: false, note: reason }) });
      closeVisitModal();
      await refreshAfterVisitChange();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// One set of listeners for every visit card.
const visitsListEl = document.getElementById('today-visits-list');
if (visitsListEl) {
  visitsListEl.addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('[data-timeline]');
    if (!d) return;
    if (d.open) openTimelines.add(d.dataset.timeline); else openTimelines.delete(d.dataset.timeline);
  }, true);

  visitsListEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-visit-step], [data-visit-modal], [data-visit-decision]');
    if (!btn) return;
    const visit = visitsById.get(btn.dataset.visitId);
    if (!visit) return;

    if (btn.dataset.visitModal) {
      openVisitModal(btn.dataset.visitModal, visit);
      return;
    }

    btn.disabled = true;
    try {
      if (btn.dataset.visitDecision === 'approve') {
        await api(`/api/visits/${encodeURIComponent(visit.id)}/reschedule-decision`, { method: 'POST', body: JSON.stringify({ approve: true }) });
      } else if (btn.dataset.visitStep === 'notes') {
        openNotesForVisit(visit);
        return;
      } else {
        const step = btn.dataset.visitStep;
        const coords = step === 'arrived' ? await getPosition() : null;
        await api(`/api/visits/${encodeURIComponent(visit.id)}/step`, { method: 'POST', body: JSON.stringify({ step, coords }) });
        if (step === 'completed') openNotesForVisit({ ...visit, status: 'completed' });
      }
      await refreshAfterVisitChange();
    } catch (err) {
      alert(err.message || 'Could not update the visit');
    } finally {
      btn.disabled = false;
    }
  });
}

document.querySelectorAll('.visits-range-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    visitsDays = parseInt(btn.dataset.days, 10) || 1;
    document.querySelectorAll('.visits-range-btn').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    loadTodayVisits();
  });
});

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadCases().catch(() => {});
  }, 10000);
}

// Search & Filter event listeners
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    activeQuery = e.target.value;
    loadCases().catch(() => {});
  });
}

filterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    setActiveFilter(chip.dataset.filter || 'all');
    loadCases().catch(() => {});
  });
});

mobNavItems.forEach((item) => {
  item.addEventListener('click', () => {
    // Refresh has no filter: reload the current list instead of switching to "All".
    if (!item.dataset.filter) {
      loadCases().catch(() => {});
      return;
    }
    setActiveFilter(item.dataset.filter);
    loadCases().catch(() => {});
  });
});

// Quick Demo Roles Pills (1-click login). Only shown in demo mode, and the server only has the
// /api/dev/demo-login route in demo mode, so this never works against the live site.
document.querySelectorAll('.btn-demo-login').forEach((btn) => {
  btn.addEventListener('click', async () => {
    loginError.textContent = '';
    try {
      const data = await api('/api/dev/demo-login', { method: 'POST', body: JSON.stringify({ username: btn.dataset.user }) });
      showApp(data, false);
      await loadTeam();
      await loadCases();
      startPolling();
    } catch (err) {
      loginError.textContent = err.message;
    }
  });
});

// Password Show/Hide Eye Toggle
document.querySelectorAll('.btn-toggle-pw').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const input = document.getElementById(targetId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.innerHTML = isPassword
      ? `<svg class="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`
      : `<svg class="eye-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  });
});

// Auth View Tabs & Switching
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const registerForm = document.getElementById('register-form');
const forgotForm = document.getElementById('forgot-form');
const linkForgotPw = document.getElementById('link-forgot-pw');
const btnBackToLogin = document.getElementById('btn-back-to-login');

function showAuthTab(tab) {
  if (tabLogin) tabLogin.classList.toggle('active', tab === 'login');
  if (tabRegister) tabRegister.classList.toggle('active', tab === 'register');
  if (loginForm) loginForm.hidden = tab !== 'login';
  if (registerForm) registerForm.hidden = tab !== 'register';
  if (forgotForm) forgotForm.hidden = tab !== 'forgot';
}

if (tabLogin) tabLogin.addEventListener('click', () => showAuthTab('login'));
if (tabRegister) tabRegister.addEventListener('click', () => showAuthTab('register'));
if (linkForgotPw) linkForgotPw.addEventListener('click', () => showAuthTab('forgot'));
if (btnBackToLogin) btnBackToLogin.addEventListener('click', () => showAuthTab('login'));

if (simDoctorBtn) simDoctorBtn.addEventListener('click', () => simulateBooking('doctor', simDoctorBtn));
if (simPatientBtn) simPatientBtn.addEventListener('click', () => simulateBooking('patient', simPatientBtn));

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    showApp(data, Boolean(data.liveMode));
    await loadTeam();
    await loadCases();
    startPolling();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

(async function init() {
  try {
    const me = await api('/api/me');
    const demoPill = document.getElementById('demo-accounts-pill');
    if (demoPill) demoPill.hidden = Boolean(me.liveMode);
    if (me.user) {
      showApp(me.user, me.liveMode);
      await loadTeam();
      await loadCases();
      startPolling();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
})();

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout API warning:', err);
    } finally {
      showLogin();
      window.location.reload();
    }
  });
}

// Edit Allotment Modal Listeners
const editAllotmentModal = document.getElementById('edit-allotment-modal');
const closeEditAllotmentModalBtn = document.getElementById('close-edit-allotment-modal');
const cancelEditAllotmentBtn = document.getElementById('cancel-edit-allotment');
const editAllotmentForm = document.getElementById('edit-allotment-form');
const editAllotmentError = document.getElementById('edit-allotment-error');

function closeEditAllotmentModal() {
  if (editAllotmentModal) editAllotmentModal.hidden = true;
}

if (closeEditAllotmentModalBtn) closeEditAllotmentModalBtn.addEventListener('click', closeEditAllotmentModal);
if (cancelEditAllotmentBtn) cancelEditAllotmentBtn.addEventListener('click', closeEditAllotmentModal);

if (editAllotmentForm) {
  editAllotmentForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (editAllotmentError) editAllotmentError.textContent = '';
    const caseId = document.getElementById('edit-allotment-case-id').value;
    const count = parseInt(document.getElementById('edit-allotment-count').value, 10);
    const physio = document.getElementById('edit-allotment-physio').value;
    const instructions = document.getElementById('edit-allotment-instructions').value;

    try {
      await api(`/api/cases/${encodeURIComponent(caseId)}/allotment`, {
        method: 'PATCH',
        body: JSON.stringify({
          allottedSessions: count,
          assignedPhysio: physio || null,
          instructions: instructions || '',
        }),
      });
      closeEditAllotmentModal();
      await loadCases();
    } catch (err) {
      if (editAllotmentError) editAllotmentError.textContent = err.message;
    }
  });
}

// Profile & Account Settings Modal Listeners
const profileModal = document.getElementById('profile-modal');
const closeProfileModal = document.getElementById('close-profile-modal');
const profileSettingsBtn = document.getElementById('profile-settings-btn');
const profileEditForm = document.getElementById('profile-edit-form');
const profName = document.getElementById('prof-name');
const profEmail = document.getElementById('prof-email');
const profPhone = document.getElementById('prof-phone');
const profilePasswordForm = document.getElementById('profile-password-form');
const profOldPass = document.getElementById('prof-old-pass');
const profNewPass = document.getElementById('prof-new-pass');
const btnDeleteAccount = document.getElementById('btn-delete-account');

if (profileSettingsBtn) {
  profileSettingsBtn.addEventListener('click', () => {
    if (profName) profName.value = currentUserName || '';
    if (profileModal) profileModal.hidden = false;
  });
}

if (closeProfileModal) {
  closeProfileModal.addEventListener('click', () => {
    if (profileModal) profileModal.hidden = true;
  });
}

if (profileEditForm) {
  profileEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = profName.value.trim();
    const email = profEmail.value.trim();
    const phone = profPhone.value.trim();
    try {
      const result = await api('/api/me/profile', {
        method: 'PUT',
        body: JSON.stringify({ name, email, phone }),
      });
      currentUserName = result.user.name;
      if (whoEl) whoEl.textContent = currentUserName;
      if (avatarInitials) avatarInitials.textContent = (currentUserName || 'U').charAt(0).toUpperCase();
      if (profileModal) profileModal.hidden = true;
      alert('Profile details updated successfully!');
    } catch (err) {
      alert(`Failed to update profile: ${err.message}`);
    }
  });
}

if (profilePasswordForm) {
  profilePasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassword = profOldPass.value;
    const newPassword = profNewPass.value;
    try {
      await api('/api/me/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      profOldPass.value = '';
      profNewPass.value = '';
      if (profileModal) profileModal.hidden = true;
      alert('Password changed successfully!');
    } catch (err) {
      alert(`Password change failed: ${err.message}`);
    }
  });
}

if (btnDeleteAccount) {
  btnDeleteAccount.addEventListener('click', async () => {
    const confirmDelete = confirm(`Are you sure you want to PERMANENTLY delete your account (${currentUser})? This action cannot be undone.`);
    if (!confirmDelete) return;

    try {
      await api('/api/me', { method: 'DELETE' });
      if (profileModal) profileModal.hidden = true;
      alert('Your account has been deleted.');
      showLogin();
    } catch (err) {
      alert(`Account deletion failed: ${err.message}`);
    }
  });
}

// ---------- Team Accounts Management Modal (Sales & CLP Doctor Only) ----------
const teamModal = document.getElementById('team-modal');
const closeTeamModal = document.getElementById('close-team-modal');
const teamSettingsBtn = document.getElementById('team-settings-btn');
const teamSearchInput = document.getElementById('team-search-input');
const teamMembersList = document.getElementById('team-members-list');
const btnAddTeamMember = document.getElementById('btn-add-team-member');

const teamEditModal = document.getElementById('team-edit-modal');
const closeTeamEditModal = document.getElementById('close-team-edit-modal');
const btnCancelTeamEdit = document.getElementById('btn-cancel-team-edit');
const teamEditForm = document.getElementById('team-edit-form');
const editTeamUsername = document.getElementById('edit-team-username');
const editTeamName = document.getElementById('edit-team-name');
const editTeamRole = document.getElementById('edit-team-role');
const editTeamEmail = document.getElementById('edit-team-email');
const editTeamPhone = document.getElementById('edit-team-phone');
const editTeamPassword = document.getElementById('edit-team-password');

const teamCreateModal = document.getElementById('team-create-modal');
const closeTeamCreateModal = document.getElementById('close-team-create-modal');
const btnCancelTeamCreate = document.getElementById('btn-cancel-team-create');
const teamCreateForm = document.getElementById('team-create-form');
const createTeamName = document.getElementById('create-team-name');
const createTeamUsername = document.getElementById('create-team-username');
const createTeamPassword = document.getElementById('create-team-password');
const createTeamRole = document.getElementById('create-team-role');
const createTeamEmail = document.getElementById('create-team-email');
const createTeamPhone = document.getElementById('create-team-phone');
const teamCreateError = document.getElementById('team-create-error');

function renderTeamList() {
  if (!teamMembersList) return;
  const query = (teamSearchInput ? teamSearchInput.value : '').toLowerCase().trim();
  let filtered = team;
  if (query) {
    filtered = team.filter((m) =>
      (m.name || '').toLowerCase().includes(query) ||
      (m.username || '').toLowerCase().includes(query) ||
      (m.email || '').toLowerCase().includes(query) ||
      (m.role || '').toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    teamMembersList.innerHTML = `<div class="empty-card" style="padding:20px"><p>No team accounts matching search.</p></div>`;
    return;
  }

  teamMembersList.innerHTML = filtered.map((member) => `
    <div class="team-member-card">
      <div class="team-member-info">
        <div class="team-member-name-row">
          <span class="team-member-name">${member.name}</span>
          <span class="team-member-username">@${member.username}</span>
          <span class="role-badge role-${member.role || 'external_physio'}">${roleLabel(member.role)}</span>
        </div>
        <div class="team-member-contact">
          <span><svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> ${escapeHtml(member.email || 'No email set')}</span>
          <span><svg class="icon-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg> ${escapeHtml(member.phone || 'No phone set')}</span>
        </div>
      </div>
      <div class="team-card-actions">
        <button type="button" class="btn-icon-action btn-edit-team-member" data-username="${member.username}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>Edit Profile</span>
        </button>
        <button type="button" class="btn-icon-action danger btn-delete-team-member" data-username="${member.username}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          <span>Delete</span>
        </button>
      </div>
    </div>
  `).join('');

  teamMembersList.querySelectorAll('.btn-edit-team-member').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uname = btn.dataset.username;
      const member = team.find((t) => t.username === uname);
      if (!member) return;
      editTeamUsername.value = member.username;
      editTeamName.value = member.name || '';
      editTeamRole.value = member.role || 'external_physio';
      editTeamEmail.value = member.email || '';
      editTeamPhone.value = member.phone || '';
      editTeamPassword.value = '';
      document.getElementById('team-edit-subtitle').textContent = `Modify details for @${member.username}`;
      if (teamEditModal) teamEditModal.hidden = false;
    });
  });

  teamMembersList.querySelectorAll('.btn-delete-team-member').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const uname = btn.dataset.username;
      if (uname === currentUser) {
        alert("You cannot delete your active account from team manager. Use 'My Profile' settings.");
        return;
      }
      const confirmDel = confirm(`Are you sure you want to PERMANENTLY delete team account @${uname}?`);
      if (!confirmDel) return;
      try {
        await api(`/api/team/${encodeURIComponent(uname)}`, { method: 'DELETE' });
        alert(`Account @${uname} has been deleted.`);
        await loadTeam();
        renderTeamList();
      } catch (err) {
        alert(`Delete error: ${err.message}`);
      }
    });
  });
}

if (teamSettingsBtn) {
  teamSettingsBtn.addEventListener('click', async () => {
    await loadTeam();
    renderTeamList();
    if (teamModal) teamModal.hidden = false;
  });
}

if (closeTeamModal) closeTeamModal.addEventListener('click', () => (teamModal.hidden = true));
if (teamSearchInput) teamSearchInput.addEventListener('input', () => renderTeamList());

if (btnAddTeamMember) {
  btnAddTeamMember.addEventListener('click', () => {
    if (teamCreateForm) teamCreateForm.reset();
    if (teamCreateError) teamCreateError.textContent = '';
    if (teamCreateModal) teamCreateModal.hidden = false;
  });
}

if (closeTeamCreateModal) closeTeamCreateModal.addEventListener('click', () => (teamCreateModal.hidden = true));
if (btnCancelTeamCreate) btnCancelTeamCreate.addEventListener('click', () => (teamCreateModal.hidden = true));

if (teamCreateForm) {
  teamCreateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (teamCreateError) teamCreateError.textContent = '';
    const name = createTeamName.value.trim();
    const username = createTeamUsername.value.trim();
    const password = createTeamPassword.value;
    const role = createTeamRole.value;
    const email = createTeamEmail.value.trim();
    const phone = createTeamPhone.value.trim();

    if (!name || !username || !password) {
      if (teamCreateError) teamCreateError.textContent = 'Please fill in Name, Username, and Password';
      return;
    }
    if (password.length < 6) {
      if (teamCreateError) teamCreateError.textContent = 'Password must be at least 6 characters long';
      return;
    }

    const submitBtn = teamCreateForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api('/api/team', {
        method: 'POST',
        body: JSON.stringify({ name, username, password, role, email, phone }),
      });
      alert(`Team member @${username} created successfully!`);
      if (teamCreateModal) teamCreateModal.hidden = true;
      await loadTeam();
      renderTeamList();
    } catch (err) {
      if (teamCreateError) teamCreateError.textContent = err.message || 'Failed to create team member';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

if (closeTeamEditModal) closeTeamEditModal.addEventListener('click', () => (teamEditModal.hidden = true));
if (btnCancelTeamEdit) btnCancelTeamEdit.addEventListener('click', () => (teamEditModal.hidden = true));

if (teamEditForm) {
  teamEditForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uname = editTeamUsername.value;
    const name = editTeamName.value.trim();
    const role = editTeamRole.value;
    const email = editTeamEmail.value.trim();
    const phone = editTeamPhone.value.trim();
    const password = editTeamPassword.value;

    const submitBtn = teamEditForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api(`/api/team/${encodeURIComponent(uname)}`, {
        method: 'PUT',
        body: JSON.stringify({ name, role, email, phone, password: password || undefined }),
      });
      if (teamEditModal) teamEditModal.hidden = true;
      alert(`Account @${uname} updated successfully!`);
      await loadTeam();
      renderTeamList();
    } catch (err) {
      alert(`Update failed: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
    }
  });
}
