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
const fbApptId = document.getElementById('fb-appt-id');
const fbPatientId = document.getElementById('fb-patient-id');
const fbPainRange = document.getElementById('fb-pain-range');
const fbPainVal = document.getElementById('fb-pain-val');
const fbExercises = document.getElementById('fb-exercises');
const fbNotes = document.getElementById('fb-notes');

// Allot Modal Elements
const allotModal = document.getElementById('allot-modal');
const allotForm = document.getElementById('allot-form');
const closeAllotModal = document.getElementById('close-allot-modal');
const btnCancelAllot = document.getElementById('btn-cancel-allot');
const allotPatientId = document.getElementById('allot-patient-id');
const allotCount = document.getElementById('allot-count');

let pollTimer = null;
let currentUser = null;
let currentUserRole = 'external_physio';
let currentUserName = '';
let team = []; // [{username, name, role}]
let rawAppointments = [];
let activeFilter = 'all'; // 'all', 'mine', 'unassigned'
let activeQuery = '';

// Active selections for feedback form
let selectedMobility = 'Improved';
let selectedCompliance = 'Excellent';

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
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function roleLabel(role) {
  if (role === 'sales') return 'Sales Team';
  if (role === 'clp_doctor') return 'CLP Doctor';
  return 'PhysioWay';
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

  modeText.textContent = liveMode ? 'LIVE CLINICEA' : 'MOCK DEMO';
  modeBadge.className = `mode-badge ${liveMode ? 'live' : 'mock'}`;
  if (demoTools) demoTools.hidden = liveMode;
}

function showLogin() {
  loginScreen.hidden = false;
  appScreen.hidden = true;
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
  const options = ['<option value="">Unassigned</option>'];
  // Only list external physiotherapists (Jane, Raj, Meera) in the Assigned Physio dropdown
  const physios = team.filter((m) => m.role === 'external_physio' || !m.role);
  for (const member of physios) {
    const label = member.username === currentUser ? `${member.name} (me)` : member.name;
    const selected = member.username === currentAssignee ? 'selected' : '';
    options.push(`<option value="${member.username}" ${selected}>${label}</option>`);
  }
  return options.join('');
}

function updateStats(appointments) {
  statTotal.textContent = appointments.length;
  const myCount = appointments.filter((a) => a.assignedTo === currentUser).length;
  const unassignedCount = appointments.filter((a) => !a.assignedTo).length;
  statMyVisits.textContent = myCount;
  statUnassigned.textContent = unassignedCount;
}

function filterAppointments() {
  let list = rawAppointments;

  if (activeFilter === 'mine') {
    list = list.filter((a) => a.assignedTo === currentUser);
  } else if (activeFilter === 'unassigned') {
    list = list.filter((a) => !a.assignedTo);
  }

  if (activeQuery) {
    const q = activeQuery.toLowerCase();
    list = list.filter((a) =>
      (a.patientName || '').toLowerCase().includes(q) ||
      (a.patientMobile || '').toLowerCase().includes(q) ||
      (a.address || '').toLowerCase().includes(q) ||
      (a.service || '').toLowerCase().includes(q)
    );
  }

  renderAppointmentsList(list);
}

function renderAppointmentsList(appointments) {
  const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;

  listEl.innerHTML = '';
  emptyState.hidden = appointments.length > 0;

  const canEditAllotment = currentUserRole === 'sales' || currentUserRole === 'clp_doctor';
  const isPhysio = currentUserRole === 'external_physio';
  const canRecordFeedback = currentUserRole === 'external_physio' || currentUserRole === 'clp_doctor';

  for (const appt of appointments) {
    const card = document.createElement('div');
    const isMine = appt.assignedTo === currentUser;
    card.className = `appt-card glass-card ${isMine ? 'is-mine' : ''}`;
    
    const start = new Date(appt.start);
    const end = new Date(appt.end);
    const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const assignedName = appt.assignedTo ? teamMemberName(appt.assignedTo) : 'Unassigned';

    // Session tracker calculations
    const plan = appt.patientPlan || { allottedSessions: 0, completedSessions: 0, remainingSessions: 0 };
    const allotted = plan.allottedSessions || 0;
    const completed = plan.completedSessions || 0;
    const pct = allotted > 0 ? Math.min(100, Math.round((completed / allotted) * 100)) : 0;

    card.innerHTML = `
      <div class="card-header-bar">
        <div class="time-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${timeStr}</span>
        </div>
        <span class="service-pill">${appt.service || 'Physiotherapy'}</span>
      </div>

      <div class="patient-info">
        <div class="patient-name">${appt.patientName || 'Patient'}</div>
        <div class="practitioner-sub">Practitioner: ${appt.practitioner || 'Unassigned'}</div>
      </div>

      <!-- Session Allotment & Progress Bar -->
      <div class="session-tracker-box">
        <div class="session-header">
          <span class="session-title">Session Tracker</span>
          <span class="session-counts">${allotted > 0 ? `Completed <strong>${completed}</strong> of <strong>${allotted}</strong>` : 'No plan allotted yet'}</span>
        </div>
        ${allotted > 0 ? `
          <div class="session-progress-bar">
            <div class="session-progress-fill" style="width: ${pct}%;"></div>
          </div>
        ` : ''}
        ${canEditAllotment ? `
          <button class="btn-allot-sessions" data-patient-id="${appt.patientId || ''}" data-allotted="${allotted}" data-name="${appt.patientName || 'Patient'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>
            <span>${allotted > 0 ? 'Edit Session Allotment' : 'Allot Sessions (Sales / Doctor)'}</span>
          </button>
        ` : ''}
      </div>

      <div class="contact-strip">
        ${appt.patientMobile ? `
          <a href="tel:${appt.patientMobile}" class="contact-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            <span>Call</span>
          </a>
        ` : ''}
        ${appt.address ? `
          <a href="https://maps.google.com/?q=${encodeURIComponent(appt.address)}" target="_blank" class="contact-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            <span>Map</span>
          </a>
        ` : ''}
        <span class="source-badge">${sourceLabel(appt.source)}</span>
      </div>

      <div class="assign-box">
        <div class="assign-header">
          <span class="assign-label">Assigned Physio</span>
          <span class="assigned-tag" data-assign-tag-for="${appt.id}">${isMine ? 'Assigned to You' : assignedName}</span>
        </div>
        ${isPhysio ? `
          <div class="assign-controls">
            <select class="assign-select" data-assign-for="${appt.id}">
              ${assignOptionsHtml(appt.assignedTo)}
            </select>
            <button class="btn-assign-self" data-assign-me-for="${appt.id}">Claim Visit</button>
          </div>
        ` : ''}
      </div>

      <!-- Feedback Questionnaire Action Button -->
      ${canRecordFeedback ? `
        <div class="feedback-action-strip">
          <button class="btn-open-feedback" data-appt-id="${appt.id}" data-patient-id="${appt.patientId || ''}" data-name="${appt.patientName || 'Patient'}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Record Visit Feedback &amp; Questionnaire</span>
          </button>
        </div>
      ` : ''}

      <!-- Clinicea Notes & Session History Box -->
      <div class="notes-box">
        <div class="notes-label-bar">
          <label>Clinicea Notes &amp; Session History</label>
          <span class="sync-status-badge ${appt.notesSyncStatus}" data-sync-for="${appt.id}">${syncLabel(appt.notesSyncStatus)}</span>
        </div>
        ${(() => {
          const history = (appt.patientPlan && appt.patientPlan.history && Array.isArray(appt.patientPlan.history))
            ? appt.patientPlan.history
            : [];
          if (history.length === 0) return '';
          return `
            <div class="history-timeline">
              <div class="history-title-bar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
                <span>Past Visit Feedback History (${history.length} Session${history.length > 1 ? 's' : ''})</span>
              </div>
              <div class="history-list">
                ${history.slice().reverse().map((h) => `
                  <div class="history-item">
                    <div class="history-item-header">
                      <span class="session-tag">Session ${h.sessionNumber || '1'} of ${h.totalAllotted || allotted || '5'}</span>
                      <span class="history-author">Logged by ${teamMemberName(h.loggedBy)} ${h.timestamp ? '• ' + new Date(h.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                    </div>
                    <div class="history-metrics">
                      <span class="metric-pill pain-pill">Pain: ${h.painLevel || 'N/A'}/10</span>
                      <span class="metric-pill">Mobility: ${h.mobilityStatus || 'N/A'}</span>
                      <span class="metric-pill">Compliance: ${h.patientCompliance || 'N/A'}</span>
                    </div>
                    ${h.exercisesCompleted ? `<div class="history-detail"><strong>Exercises:</strong> ${h.exercisesCompleted}</div>` : ''}
                    ${h.clinicalNotes ? `<div class="history-notes">"${h.clinicalNotes}"</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        })()}
        <textarea data-id="${appt.id}" placeholder="Record visit observations, ROM, exercises, or progress...">${appt.notes || ''}</textarea>
        <div class="notes-actions">
          <div class="quick-templates">
            <button class="tmpl-chip" data-tmpl-for="${appt.id}" data-text="Completed 45m home session. Good ROM progress.">Good ROM</button>
            <button class="tmpl-chip" data-tmpl-for="${appt.id}" data-text="Physio exercise routine 3x10 completed. Pain minimal.">Exercises Done</button>
            <button class="tmpl-chip" data-tmpl-for="${appt.id}" data-text="Follow-up session required next week.">Follow-up</button>
          </div>
          <button class="btn-save-notes" data-save-for="${appt.id}">
            <span>Save Notes</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 5 5L20 7"/></svg>
          </button>
        </div>
      </div>
    `;
    listEl.appendChild(card);
  }

  if (focusedId) {
    const el = listEl.querySelector(`textarea[data-id="${focusedId}"]`);
    if (el) el.focus();
  }

  attachCardEvents();
}

function attachCardEvents() {
  // Quick template insertion
  listEl.querySelectorAll('.tmpl-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tmplFor;
      const textarea = listEl.querySelector(`textarea[data-id="${id}"]`);
      if (textarea) {
        const existing = textarea.value.trim();
        textarea.value = existing ? `${existing} ${btn.dataset.text}` : btn.dataset.text;
        textarea.focus();
      }
    });
  });

  // Open Allotment Modal
  listEl.querySelectorAll('.btn-allot-sessions').forEach((btn) => {
    btn.addEventListener('click', () => {
      const patientId = btn.dataset.patientId;
      const currentAllotted = btn.dataset.allotted || 5;
      const name = btn.dataset.name;
      if (!patientId) {
        alert('Cannot allot sessions: Patient Clinicea ID is missing.');
        return;
      }
      allotPatientId.value = patientId;
      allotCount.value = currentAllotted > 0 ? currentAllotted : 5;
      document.getElementById('allot-modal-subtitle').textContent = `Set total session count for ${name} (${patientId})`;
      allotModal.hidden = false;
    });
  });

  // Open Feedback Modal
  listEl.querySelectorAll('.btn-open-feedback').forEach((btn) => {
    btn.addEventListener('click', () => {
      const apptId = btn.dataset.apptId;
      const patientId = btn.dataset.patientId;
      const name = btn.dataset.name;

      fbApptId.value = apptId;
      fbPatientId.value = patientId;
      document.getElementById('modal-subtitle').textContent = `Feedback for ${name} (Appt #${apptId})`;

      // Reset form
      fbPainRange.value = 3;
      updatePainBadge(3);
      fbExercises.value = '';
      fbNotes.value = '';

      // Reset chip selectors
      selectedMobility = 'Improved';
      selectedCompliance = 'Excellent';
      updateChipSelectors();

      feedbackModal.hidden = false;
    });
  });

  // Claim Visit / Self Assignment
  listEl.querySelectorAll('.btn-assign-self').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.assignMeFor;
      const select = listEl.querySelector(`select[data-assign-for="${id}"]`);
      if (select && currentUser) {
        select.value = currentUser;
        select.dispatchEvent(new Event('change'));
      }
    });
  });

  // Dropdown Assignment Select
  listEl.querySelectorAll('select[data-assign-for]').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.dataset.assignFor;
      const tagEl = listEl.querySelector(`[data-assign-tag-for="${id}"]`);
      select.disabled = true;
      if (tagEl) tagEl.textContent = 'Updating...';
      try {
        const res = await api(`/api/appointments/${encodeURIComponent(id)}/assign`, {
          method: 'PUT',
          body: JSON.stringify({ assignedTo: select.value || null }),
        });
        const appt = rawAppointments.find((a) => a.id === id);
        if (appt) appt.assignedTo = res.assignedTo;
        updateStats(rawAppointments);
        filterAppointments();
      } catch (err) {
        alert(`Assignment failed: ${err.message}`);
      } finally {
        select.disabled = false;
      }
    });
  });

  // Save Session Notes
  listEl.querySelectorAll('.btn-save-notes').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveFor;
      const textarea = listEl.querySelector(`textarea[data-id="${id}"]`);
      const syncEl = listEl.querySelector(`[data-sync-for="${id}"]`);
      btn.disabled = true;
      syncEl.textContent = syncLabel('pending');
      syncEl.className = 'sync-status-badge pending';
      try {
        const result = await api(`/api/appointments/${encodeURIComponent(id)}/notes`, {
          method: 'PUT',
          body: JSON.stringify({ notes: textarea.value }),
        });
        const appt = rawAppointments.find((a) => a.id === id);
        if (appt) {
          appt.notes = textarea.value;
          appt.notesSyncStatus = result.notesSyncStatus;
        }
        syncEl.textContent = syncLabel(result.notesSyncStatus);
        syncEl.className = `sync-status-badge ${result.notesSyncStatus}`;
      } catch (err) {
        syncEl.textContent = syncLabel('failed');
        syncEl.className = 'sync-status-badge failed';
        alert(`Note save error: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function updatePainBadge(val) {
  const num = parseInt(val, 10);
  let category = 'Mild';
  let className = 'pain-mild';
  if (num >= 7) {
    category = 'Severe';
    className = 'pain-severe';
  } else if (num >= 4) {
    category = 'Moderate';
    className = 'pain-moderate';
  }
  fbPainVal.textContent = `${num} / 10 (${category})`;
  fbPainVal.className = `pain-badge ${className}`;
}

function updateChipSelectors() {
  document.querySelectorAll('.q-chip[data-q="mobility"]').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.val === selectedMobility);
  });
  document.querySelectorAll('.q-chip[data-q="compliance"]').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.val === selectedCompliance);
  });
}

// Modal Listeners
if (fbPainRange) {
  fbPainRange.addEventListener('input', (e) => updatePainBadge(e.target.value));
}

document.querySelectorAll('.q-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const q = chip.dataset.q;
    const val = chip.dataset.val;
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
    const apptId = fbApptId.value;
    const submitBtn = feedbackForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await api(`/api/appointments/${encodeURIComponent(apptId)}/feedback`, {
        method: 'POST',
        body: JSON.stringify({
          painLevel: parseInt(fbPainRange.value, 10),
          mobilityStatus: selectedMobility,
          exercisesCompleted: fbExercises.value.trim(),
          patientCompliance: selectedCompliance,
          clinicalNotes: fbNotes.value.trim(),
        }),
      });

      feedbackModal.hidden = true;
      await loadAppointments();
      alert('Feedback successfully submitted & synced to Clinicea!');
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
    const count = parseInt(allotCount.value, 10);
    const notesEl = document.getElementById('allot-notes');
    const notes = notesEl ? notesEl.value : '';

    const submitBtn = allotForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      await api(`/api/patients/plan/${encodeURIComponent(patientId)}`, {
        method: 'POST',
        body: JSON.stringify({ allottedSessions: count, notes }),
      });

      allotModal.hidden = true;
      await loadAppointments();
      alert('Patient enrolled successfully as an Open Task for PhysioWay!');

      // If lookup input has this patient, re-trigger lookup to refresh lookup card
      if (lookupInput && lookupInput.value.trim().toUpperCase() === patientId.toUpperCase()) {
        lookupForm.dispatchEvent(new Event('submit'));
      }
    } catch (err) {
      alert(`Allotment update failed: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// Quick Demo Login Pills
document.querySelectorAll('.btn-demo-login').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const u = btn.dataset.user;
    const p = btn.dataset.pass;
    document.getElementById('username').value = u;
    document.getElementById('password').value = p;
    loginForm.dispatchEvent(new Event('submit'));
  });
});

async function loadTeam() {
  const data = await api('/api/team');
  team = data.team;
  const allotPhysioSelect = document.getElementById('allot-physio');
  if (allotPhysioSelect) {
    const physios = team.filter((m) => m.role === 'external_physio' || !m.role);
    allotPhysioSelect.innerHTML = '<option value="">Unassigned</option>' +
      physios.map((m) => `<option value="${m.username}">${m.name}</option>`).join('');
  }
}

async function loadAppointments() {
  const date = datePicker.value || todayStr();
  dateDisplayStr.textContent = formatDateDisplay(date);
  const data = await api(`/api/appointments?date=${date}`);
  modeText.textContent = data.liveMode ? 'CLINICEA LIVE' : 'MOCK DEMO';
  modeBadge.className = `mode-badge ${data.liveMode ? 'live' : 'mock'}`;
  if (demoTools) demoTools.hidden = data.liveMode;
  rawAppointments = data.appointments;
  updateStats(rawAppointments);
  filterAppointments();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadAppointments().catch(() => {});
  }, 4000);
}

async function simulateBooking(source, btn) {
  btn.disabled = true;
  try {
    await api('/api/dev/simulate-booking', { method: 'POST', body: JSON.stringify({ source }) });
    await loadAppointments();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

// Event Listeners setup
prevDateBtn.addEventListener('click', () => adjustDate(-1));
nextDateBtn.addEventListener('click', () => adjustDate(1));
todayBtn.addEventListener('click', () => {
  datePicker.value = todayStr();
  dateDisplayStr.textContent = 'Today';
  loadAppointments().catch(() => {});
});

datePicker.addEventListener('change', () => {
  dateDisplayStr.textContent = formatDateDisplay(datePicker.value);
  loadAppointments().catch((err) => alert(err.message));
});

const scanNowBtn = document.getElementById('scan-now-btn');
const scanStatus = document.getElementById('scan-status');
if (scanNowBtn) {
  scanNowBtn.addEventListener('click', async () => {
    scanNowBtn.disabled = true;
    scanStatus.hidden = false;
    scanStatus.textContent = 'Checking Clinicea for new bookings on any date...';
    try {
      const result = await api('/api/scan-now', { method: 'POST' });
      scanStatus.textContent = `Checked ${result.checked} change(s), notified team about ${result.notified} new booking(s).`;
      await loadAppointments();
    } catch (err) {
      scanStatus.textContent = `Error: ${err.message}`;
    } finally {
      scanNowBtn.disabled = false;
      setTimeout(() => (scanStatus.hidden = true), 6000);
    }
  });
}

searchInput.addEventListener('input', (e) => {
  activeQuery = e.target.value;
  filterAppointments();
});

filterChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    filterChips.forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    filterAppointments();
  });
});

mobNavItems.forEach((item) => {
  item.addEventListener('click', () => {
    mobNavItems.forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    if (item.id === 'mob-nav-all') {
      activeFilter = 'all';
      filterChips.forEach((c) => c.classList.toggle('active', c.dataset.filter === 'all'));
      filterAppointments();
    } else if (item.id === 'mob-nav-mine') {
      activeFilter = 'mine';
      filterChips.forEach((c) => c.classList.toggle('active', c.dataset.filter === 'mine'));
      filterAppointments();
    } else if (item.id === 'mob-nav-refresh') {
      loadAppointments().catch(() => {});
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
    datePicker.value = todayStr();
    showApp(data, false);
    await loadTeam();
    await loadAppointments();
    startPolling();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const regError = document.getElementById('reg-error');
  const regSuccess = document.getElementById('reg-success');
  regError.textContent = '';
  regSuccess.textContent = '';
  const name = document.getElementById('reg-name').value;
  const username = document.getElementById('reg-username').value;
  const password = document.getElementById('reg-password').value;
  try {
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, username, password }) });
    regSuccess.textContent = 'Account created successfully! Logging you in...';
    setTimeout(async () => {
      datePicker.value = todayStr();
      showApp(data, false);
      await loadTeam();
      await loadAppointments();
      startPolling();
    }, 800);
  } catch (err) {
    regError.textContent = err.message;
  }
});

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const forgotError = document.getElementById('forgot-error');
  const forgotSuccess = document.getElementById('forgot-success');
  forgotError.textContent = '';
  forgotSuccess.textContent = '';
  const username = document.getElementById('forgot-username').value;
  const newPassword = document.getElementById('forgot-new-password').value;
  try {
    const data = await api('/api/forgot-password', { method: 'POST', body: JSON.stringify({ username, newPassword }) });
    forgotSuccess.textContent = data.message || 'Password updated! Switching to sign in...';
    setTimeout(() => {
      showAuthTab('login');
      document.getElementById('username').value = username;
      document.getElementById('password').value = newPassword;
    }, 1200);
  } catch (err) {
    forgotError.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

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

(async function init() {
  datePicker.value = todayStr();
  dateDisplayStr.textContent = 'Today';
  try {
    const me = await api('/api/me');
    if (me.user) {
      showApp(me.user, me.liveMode);
      await loadTeam();
      await loadAppointments();
      startPolling();
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
})();

