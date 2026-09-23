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
const simOwnClientBtn = document.getElementById('sim-own-client-btn');
const simOtherClientBtn = document.getElementById('sim-other-client-btn');

let pollTimer = null;

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

async function loadAppointments() {
  const date = datePicker.value || todayStr();
  const data = await api(`/api/appointments?date=${date}`);
  modeBadge.textContent = data.liveMode ? 'Live Clinicea data' : 'Mock demo data';
  modeBadge.className = `badge ${data.liveMode ? 'live' : 'mock'}`;
  renderAppointments(data.appointments);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadAppointments().catch(() => {});
  }, 4000);
}

async function simulateBooking(forOwnClient, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Sending webhook to dashboard...';
  try {
    const result = await api('/api/dev/simulate-booking', {
      method: 'POST',
      body: JSON.stringify({ source: 'doctor', forOwnClient }),
    });
    await loadAppointments();
    if (!forOwnClient) {
      alert(
        `Booking created in Clinicea for "${result.appointment.patientName}" — but since that's not your assigned client, it will NOT show up in your list. Check below to confirm.`
      );
    }
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

simOwnClientBtn.addEventListener('click', () => simulateBooking(true, simOwnClientBtn));
simOtherClientBtn.addEventListener('click', () => simulateBooking(false, simOtherClientBtn));

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  try {
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    datePicker.value = todayStr();
    showApp(data.username, false);
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
    showApp(me.user.username, me.liveMode);
    await loadAppointments();
    startPolling();
  } else {
    showLogin();
  }
})();
