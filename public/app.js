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
const fbPainBefore = document.getElementById('fb-pain-before');
const fbPainBeforeVal = document.getElementById('fb-pain-before-val');
const fbPainAfter = document.getElementById('fb-pain-after');
const fbPainAfterVal = document.getElementById('fb-pain-after-val');
const fbExercises = document.getElementById('fb-exercises');
const fbNotes = document.getElementById('fb-notes');

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

// Active selections for feedback form
let selectedVitals = 'Normal / Stable';
let selectedReadiness = 'Ready for full routine';
let selectedMobility = 'Moderate Improvement';
let selectedCompliance = 'Excellent (Followed HEP daily)';

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
      chip.textContent = labels[filterKey];
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

  if (currentUserRole === 'external_physio') {
    if (bannerTitle) bannerTitle.textContent = 'Physio Care Portal';
    if (bannerSub) bannerSub.textContent = 'Browse open home-visit cases, claim patient assignments, and record session notes.';
    if (statCard1) statCard1.textContent = 'Total Cases';
    if (statCard2) statCard2.textContent = 'My Claimed Cases';
    if (statCard3) statCard3.textContent = 'Available Open Cases';

    updateFilterChipLabels({
      open: '🔓 Open Cases (Claimable)',
      mine: '👤 My Cases',
      all: '📋 All Cases',
      completed: '✅ Completed'
    });
    updateMobileNavLabels('Open Tasks', 'My Cases');
    orderFilterChips(['open', 'mine', 'all', 'completed']);
    setActiveFilter('open');
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
      all: '📌 All Enrolments',
      completed: '✅ Completed',
      mine: '🩺 Assigned Cases',
      open: '⏳ Unassigned Cases'
    });
    updateMobileNavLabels('Unassigned', 'Assigned');
    orderFilterChips(['all', 'completed', 'mine', 'open']);
    setActiveFilter('all');
  }

  modeText.textContent = liveMode ? 'LIVE CLINICEA' : 'MOCK DEMO';
  modeBadge.className = `mode-badge ${liveMode ? 'live' : 'mock'}`;
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
  return 'Synced to Clinicea ✓';
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

// Question id -> label, from lib/feedback-questions.json, so session details show the same
// wording as the feedback form (and follow along when the questions change).
let questionLabels = {};
let questionOrder = [];
let questionLabelsLoaded = null;
function loadQuestionLabels() {
  if (!questionLabelsLoaded) {
    questionLabelsLoaded = api('/api/feedback-questions')
      .then((data) => {
        const q = data.questionnaire || {};
        for (const item of [...(q.beforeAssessment || []), ...(q.afterSummary || [])]) {
          questionLabels[item.id] = String(item.label || item.id).replace(/^\d+\.\s*/, '');
          questionOrder.push(item.id);
        }
      })
      .catch(() => {
        questionLabelsLoaded = null;
      });
  }
  return questionLabelsLoaded;
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
    .map(([key, value]) => `<div class="session-answer"><span>${escapeHtml(questionLabels[key] || key)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join('');
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
        <span>${escapeHtml(s.physioUsername ? teamMemberName(s.physioUsername) : 'Physio')} · ${escapeHtml(when)}</span>
      </div>
      <div class="session-sync sync-${escapeHtml(sync)}">${escapeHtml(SYNC_LABELS[sync] || sync)}${s.cliniceaSyncError && sync !== 'synced' ? ` <small>(${escapeHtml(s.cliniceaSyncError)})</small>` : ''}</div>
      ${before ? `<div class="session-group"><div class="session-group-title">Before the session</div>${before}</div>` : ''}
      ${after ? `<div class="session-group"><div class="session-group-title">After the session</div>${after}</div>` : ''}
      ${s.clinicalNotes ? `<div class="session-group"><div class="session-group-title">Physio notes</div><p class="session-notes">${escapeHtml(s.clinicalNotes)}</p></div>` : ''}
    </div>
  `;
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
          <button class="btn-allot-sessions" data-patient-id="${item.patientId || ''}" data-allotted="${allotted}" data-name="${item.patientName || 'Patient'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            <span>Edit Allotment</span>
          </button>
        ` : ''}
      </div>

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
          <select class="assign-select" data-assign-for="${item.id}">
            ${assignOptionsHtml(item.assignedPhysio)}
          </select>
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
      ${(canRecordFeedback && item.status !== 'completed') ? `
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
      document.getElementById('modal-subtitle').textContent = `Two-part session evaluation for ${name} (${patientId})`;

      // Reset form values
      if (fbPainBefore) fbPainBefore.value = 4;
      if (fbPainAfter) fbPainAfter.value = 3;
      if (fbExercises) fbExercises.value = '';
      if (fbNotes) fbNotes.value = '';

      updatePainBeforeBadge(4);
      updatePainAfterBadge(3);

      selectedVitals = 'Normal / Stable';
      selectedReadiness = 'Ready for full routine';
      selectedMobility = 'Moderate Improvement';
      selectedCompliance = 'Excellent (Followed HEP daily)';
      updateChipSelectors();

      if (feedbackModal) feedbackModal.hidden = false;
    });
  });
}

function updatePainBeforeBadge(val) {
  const num = parseInt(val, 10);
  let category = 'Mild';
  let className = 'pain-mild';
  if (num >= 7) { category = 'Severe'; className = 'pain-severe'; }
  else if (num >= 4) { category = 'Moderate'; className = 'pain-moderate'; }
  if (fbPainBeforeVal) {
    fbPainBeforeVal.textContent = `${num} / 10 (${category})`;
    fbPainBeforeVal.className = `pain-badge ${className}`;
  }
}

function updatePainAfterBadge(val) {
  const num = parseInt(val, 10);
  let category = 'Mild';
  let className = 'pain-mild';
  if (num >= 7) { category = 'Severe'; className = 'pain-severe'; }
  else if (num >= 4) { category = 'Moderate'; className = 'pain-moderate'; }
  if (fbPainAfterVal) {
    fbPainAfterVal.textContent = `${num} / 10 (${category})`;
    fbPainAfterVal.className = `pain-badge ${className}`;
  }
}

function updateChipSelectors() {
  document.querySelectorAll('.q-chip[data-q="vitals"]').forEach((c) => c.classList.toggle('active', c.dataset.val === selectedVitals));
  document.querySelectorAll('.q-chip[data-q="readiness"]').forEach((c) => c.classList.toggle('active', c.dataset.val === selectedReadiness));
  document.querySelectorAll('.q-chip[data-q="mobility"]').forEach((c) => c.classList.toggle('active', c.dataset.val === selectedMobility));
  document.querySelectorAll('.q-chip[data-q="compliance"]').forEach((c) => c.classList.toggle('active', c.dataset.val === selectedCompliance));
}

if (fbPainBefore) fbPainBefore.addEventListener('input', (e) => updatePainBeforeBadge(e.target.value));
if (fbPainAfter) fbPainAfter.addEventListener('input', (e) => updatePainAfterBadge(e.target.value));

document.querySelectorAll('.q-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const q = chip.dataset.q;
    const val = chip.dataset.val;
    if (q === 'vitals') selectedVitals = val;
    if (q === 'readiness') selectedReadiness = val;
    if (q === 'mobility') selectedMobility = val;
    if (q === 'compliance') selectedCompliance = val;
    updateChipSelectors();
  });
});

if (closeFeedbackModal) closeFeedbackModal.addEventListener('click', () => (feedbackModal.hidden = true));
if (btnCancelFb) btnCancelFb.addEventListener('click', () => (feedbackModal.hidden = true));

if (feedbackForm) {
  feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const caseId = fbCaseId.value;
    const submitBtn = feedbackForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const beforeAssessment = {
      painLevelBefore: parseInt(fbPainBefore ? fbPainBefore.value : 4, 10),
      vitalsStatus: selectedVitals,
      patientReadiness: selectedReadiness,
    };

    const afterSummary = {
      painLevelAfter: parseInt(fbPainAfter ? fbPainAfter.value : 3, 10),
      mobilityStatus: selectedMobility,
      exercisesCompleted: fbExercises.value.trim(),
      patientCompliance: selectedCompliance,
      clinicalNotes: fbNotes.value.trim(),
    };

    try {
      await api(`/api/cases/${encodeURIComponent(caseId)}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          beforeAssessment,
          afterSummary,
          clinicalNotes: fbNotes.value.trim(),
        }),
      });

      feedbackModal.hidden = true;
      await loadCases();
      alert('Session evaluation submitted & synced to Clinicea!');
    } catch (err) {
      alert(`Submission error: ${err.message}`);
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
        }),
      });

      allotModal.hidden = true;
      await loadCases();
      alert(`Patient ${patientName} (${patientId}) enrolled successfully as a Home-Visit Case!`);
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
          <div class="lookup-patient-name">${p.name} <span class="patient-id-tag">${p.id}</span></div>
          <div class="lookup-patient-details">
            <span>📞 ${p.mobile || 'No mobile'}</span>
            <span>📍 ${p.address || 'No address'}</span>
            ${p.bloodGroup ? `<span>🩸 Blood Group: ${p.bloodGroup}</span>` : ''}
          </div>
          ${p.notes ? `<div class="lookup-notes"><strong>Notes:</strong> ${p.notes}</div>` : ''}
          <button class="pill-btn btn-enroll-now" style="margin-top:10px">Enroll in Home-Visit Case</button>
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
}

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

if (lookupForm) {
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    lookupError.textContent = '';
    lookupResult.hidden = true;
    const id = lookupInput.value.trim();
    if (!id) return;
    const submitBtn = lookupForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const data = await api(`/api/patients/lookup?id=${encodeURIComponent(id)}`);
      const p = data.patient;
      const plan = data.patientPlan || { enrolled: false, allottedSessions: 0, completedSessions: 0 };
      const isEnrolled = plan.enrolled && plan.allottedSessions > 0;
      const canEditAllotment = currentUserRole === 'sales' || currentUserRole === 'clp_doctor';

      lookupResult.innerHTML = `
        <div class="lookup-card">
          <div class="lookup-result-name">${p.name || 'Unknown name'} <span class="patient-id-tag">(${p.id || id})</span></div>
          <div class="lookup-result-row"><strong>Mobile:</strong> ${p.mobile || '—'}</div>
          <div class="lookup-result-row"><strong>Address:</strong> ${p.address || '—'}</div>
          <div class="lookup-result-row"><strong>Blood group:</strong> ${p.bloodGroup || '—'}</div>
          <div class="lookup-result-row"><strong>Allergies:</strong> ${p.allergies || '—'}</div>
          <div class="lookup-result-row"><strong>Clinicea Notes:</strong> ${p.notes || '—'}</div>

          <div class="lookup-enrolment-strip">
            <div class="enrolment-status ${isEnrolled ? 'status-enrolled' : 'status-not-enrolled'}">
              <span class="enrolment-title">${isEnrolled ? 'Active Home Visit Program' : 'Not Enrolled in Physio Home Visits'}</span>
              <span class="enrolment-details">${isEnrolled ? `Completed <strong>${plan.completedSessions}</strong> of <strong>${plan.allottedSessions}</strong> Sessions` : 'Patient needs session plan allotment'}</span>
            </div>
            ${canEditAllotment ? `
              <button type="button" class="btn-lookup-enroll pill-btn" data-patient-id="${p.id || id}" data-name="${p.name || id}" data-allotted="${plan.allottedSessions || 5}" data-physio="${plan.assignedPhysio || ''}" data-notes="${plan.notes || ''}">
                <span>${isEnrolled ? 'Edit Session Plan & Allotment' : '+ Enroll Patient & Allot Sessions'}</span>
              </button>
            ` : ''}
          </div>
        </div>
      `;
      lookupResult.hidden = false;

      // Attach event listener to the Enroll button in lookup result
      const enrollBtn = lookupResult.querySelector('.btn-lookup-enroll');
      if (enrollBtn) {
        enrollBtn.addEventListener('click', () => {
          const patientId = enrollBtn.dataset.patientId;
          const currentAllotted = enrollBtn.dataset.allotted || 5;
          const currentNotes = enrollBtn.dataset.notes || '';
          const name = enrollBtn.dataset.name;

          allotPatientId.value = patientId;
          allotCount.value = currentAllotted > 0 ? currentAllotted : 5;
          const notesEl = document.getElementById('allot-notes');
          if (notesEl) notesEl.value = currentNotes;

          document.getElementById('allot-modal-subtitle').textContent = `Set total session count for ${name} (${patientId}) (Open Task for PhysioWay)`;
          allotModal.hidden = false;
        });
      }
    } catch (err) {
      lookupError.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

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
          <span>📧 ${member.email || 'No email set'}</span>
          <span>📞 ${member.phone || 'No phone set'}</span>
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
