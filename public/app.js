const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const datePicker = document.getElementById('date-picker');
const listEl = document.getElementById('appointments-list');
const emptyState = document.getElementById('empty-state');
const whoEl = document.getElementById('who');
const modeBadge = document.getElementById('mode-badge');
const logoutBtn = document.getElementById('logout-btn');
const simDoctorBtn = document.getElementById('sim-doctor-btn');
const simPatientBtn = document.getElementById('sim-patient-btn');
const demoTools = document.getElementById('demo-tools');

let pollTimer = null;
let currentUser = null;
let team = []; // [{username, name}]

function todayStr() {
  return new Date().toISOString().slice(0, 10);
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
  modeBadge.textContent = liveMode ? 'Live Clinicea data' : 'Mock demo data';
  modeBadge.className = `badge ${liveMode ? 'live' : 'mock'}`;
  // The simulate-booking endpoint doesn't exist at all once live (see app.js server-side) --
  // hide the panel so there's nothing to click that would just 404.
  demoTools.hidden = liveMode;
}

function showLogin() {
  loginScreen.hidden = false;
  appScreen.hidden = true;
  if (pollTimer) clearInterval(pollTimer);
}

function sourceLabel(source) {
  if (source === 'patient-online-booking') return 'Booked online by patient';
  if (source === 'doctor-booked-in-clinicea') return 'Booked by doctor in Clinicea';
  return 'Clinicea';
}

function syncLabel(status) {
  if (status === 'pending') return 'Syncing to Clinicea…';
  if (status === 'failed') return 'Sync failed – will retry on next save';
  return 'Synced to Clinicea';
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

function renderAppointments(appointments) {
  const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;

  listEl.innerHTML = '';
  emptyState.hidden = appointments.length > 0;
  for (const appt of appointments) {
    const card = document.createElement('div');
    card.className = 'appt-card';
    const start = new Date(appt.start);
    const end = new Date(appt.end);
    const timeStr = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    card.innerHTML = `
      <div class="appt-top">
        <span class="appt-time">${timeStr} · ${appt.patientName}</span>
        <span class="appt-service">${appt.service}</span>
      </div>
      <div class="appt-meta">
        Practitioner: ${appt.practitioner || '—'}<br/>
        Mobile: ${appt.patientMobile || '—'}<br/>
        Address: ${appt.address || '—'}<br/>
        <span class="source-tag">${sourceLabel(appt.source)}</span>
      </div>
      <div class="assign-row">
        <label>Assigned to</label>
        <select data-assign-for="${appt.id}">${assignOptionsHtml(appt.assignedTo)}</select>
        <span class="assign-status" data-assign-status-for="${appt.id}"></span>
      </div>
      <div class="appt-notes">
        <label>Session notes</label>
        <textarea data-id="${appt.id}">${appt.notes || ''}</textarea>
        <div class="notes-actions">
          <span class="sync-badge ${appt.notesSyncStatus}" data-sync-for="${appt.id}">${syncLabel(appt.notesSyncStatus)}</span>
          <span class="save-status" data-status-for="${appt.id}"></span>
          <button class="save-btn" data-save-for="${appt.id}">Save notes</button>
        </div>
      </div>
    `;
    listEl.appendChild(card);
  }

  if (focusedId) {
    const el = listEl.querySelector(`textarea[data-id="${focusedId}"]`);
    if (el) el.focus();
  }

  listEl.querySelectorAll('select[data-assign-for]').forEach((select) => {
    select.addEventListener('change', async () => {
      const id = select.dataset.assignFor;
      const statusEl = listEl.querySelector(`[data-assign-status-for="${id}"]`);
      select.disabled = true;
      statusEl.textContent = 'Saving...';
      try {
        await api(`/api/appointments/${encodeURIComponent(id)}/assign`, {
          method: 'PUT',
          body: JSON.stringify({ assignedTo: select.value || null }),
        });
        statusEl.textContent = 'Saved ✓';
        setTimeout(() => (statusEl.textContent = ''), 2000);
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
      } finally {
        select.disabled = false;
      }
    });
  });

  listEl.querySelectorAll('.save-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveFor;
      const textarea = listEl.querySelector(`textarea[data-id="${id}"]`);
      const statusEl = listEl.querySelector(`[data-status-for="${id}"]`);
      const syncEl = listEl.querySelector(`[data-sync-for="${id}"]`);
      btn.disabled = true;
      statusEl.textContent = 'Saving...';
      syncEl.textContent = syncLabel('pending');
      syncEl.className = 'sync-badge pending';
      try {
        const result = await api(`/api/appointments/${encodeURIComponent(id)}/notes`, {
          method: 'PUT',
          body: JSON.stringify({ notes: textarea.value }),
        });
        statusEl.textContent = 'Saved ✓';
        syncEl.textContent = syncLabel(result.notesSyncStatus);
        syncEl.className = `sync-badge ${result.notesSyncStatus}`;
        setTimeout(() => (statusEl.textContent = ''), 2000);
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        syncEl.textContent = syncLabel('failed');
        syncEl.className = 'sync-badge failed';
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
  const data = await api(`/api/appointments?date=${date}`);
  modeBadge.textContent = data.liveMode ? 'Live Clinicea data' : 'Mock demo data';
  modeBadge.className = `badge ${data.liveMode ? 'live' : 'mock'}`;
  demoTools.hidden = data.liveMode;
  renderAppointments(data.appointments);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadAppointments().catch(() => {});
  }, 4000);
}

async function simulateBooking(source, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Sending webhook to dashboard...';
  try {
    await api('/api/dev/simulate-booking', { method: 'POST', body: JSON.stringify({ source }) });
    await loadAppointments();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

simDoctorBtn.addEventListener('click', () => simulateBooking('doctor', simDoctorBtn));
simPatientBtn.addEventListener('click', () => simulateBooking('patient', simPatientBtn));

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

datePicker.addEventListener('change', () => {
  loadAppointments().catch((err) => alert(err.message));
});

(async function init() {
  datePicker.value = todayStr();
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
