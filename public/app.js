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

let pollTimer = null;
let currentUser = null;
let team = []; // [{username, name}]
let rawAppointments = [];
let activeFilter = 'all'; // 'all', 'mine', 'unassigned'
let activeQuery = '';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
  datePicker.value = d.toISOString().slice(0, 10);
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

function showApp(username, liveMode) {
  loginScreen.hidden = true;
  appScreen.hidden = false;
  whoEl.textContent = username;
  avatarInitials.textContent = (username || 'U').charAt(0).toUpperCase();
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
  if (status === 'failed') return 'Sync Failed';
  return 'Synced';
}

function teamMemberName(username) {
  const member = team.find((t) => t.username === username);
  return member ? member.name : username;
}

function assignOptionsHtml(currentAssignee) {
  const options = ['<option value="">Unassigned</option>'];
  for (const member of team) {
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

  // Filter chips
  if (activeFilter === 'mine') {
    list = list.filter((a) => a.assignedTo === currentUser);
  } else if (activeFilter === 'unassigned') {
    list = list.filter((a) => !a.assignedTo);
  }

  // Search query
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

  for (const appt of appointments) {
    const card = document.createElement('div');
    const isMine = appt.assignedTo === currentUser;
    card.className = `appt-card glass-card ${isMine ? 'is-mine' : ''}`;
    
    const start = new Date(appt.start);
    const end = new Date(appt.end);
    const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const assignedName = appt.assignedTo ? teamMemberName(appt.assignedTo) : 'Unassigned';

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
        <div class="assign-controls">
          <select class="assign-select" data-assign-for="${appt.id}">
            ${assignOptionsHtml(appt.assignedTo)}
          </select>
          <button class="btn-assign-self" data-assign-me-for="${appt.id}">Claim Visit</button>
        </div>
      </div>

      <div class="notes-box">
        <div class="notes-label-bar">
          <label>Session Notes</label>
          <span class="sync-status-badge ${appt.notesSyncStatus}" data-sync-for="${appt.id}">${syncLabel(appt.notesSyncStatus)}</span>
        </div>
        <textarea data-id="${appt.id}" placeholder="Record visit observations, ROM, exercises, or progress...">${appt.notes || ''}</textarea>
        <div class="notes-actions">
          <div class="quick-templates">
            <button class="tmpl-chip" data-tmpl-for="${appt.id}" data-text="Completed 45m home session. Good ROM progress.">Good ROM</button>
            <button class="tmpl-chip" data-tmpl-for="${appt.id}" data-text="Physio exercise routine 3x10 completed. Pain minimal.">Exercises Done</button>
            <button class="tmpl-chip" data-tmpl-for="${appt.id}" data-text="Follow-up session required next week.">Follow-up</button>
          </div>
          <button class="btn-save-notes" data-save-for="${appt.id}">
            <span>Save &amp; Sync</span>
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

async function loadTeam() {
  const data = await api('/api/team');
  team = data.team;
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
      lookupResult.innerHTML = `
        <div class="lookup-result-name">${p.name || 'Unknown name'}</div>
        <div class="lookup-result-row"><strong>Mobile:</strong> ${p.mobile || '—'}</div>
        <div class="lookup-result-row"><strong>Address:</strong> ${p.address || '—'}</div>
        <div class="lookup-result-row"><strong>Blood group:</strong> ${p.bloodGroup || '—'}</div>
        <div class="lookup-result-row"><strong>Allergies:</strong> ${p.allergies || '—'}</div>
        <div class="lookup-result-row"><strong>Notes:</strong> ${p.notes || '—'}</div>
      `;
      lookupResult.hidden = false;
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
    currentUser = data.username;
    datePicker.value = todayStr();
    showApp(data.username, false);
    await loadTeam();
    await loadAppointments();
    startPolling();
  } catch (err) {
    loginError.textContent = err.message;
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showLogin();
});

(async function init() {
  datePicker.value = todayStr();
  dateDisplayStr.textContent = 'Today';
  const me = await api('/api/me');
  if (me.user) {
    currentUser = me.user.username;
    showApp(me.user.username, me.liveMode);
    await loadTeam();
    await loadAppointments();
    startPolling();
  } else {
    showLogin();
  }
})();
