# Clinicea Physiotherapy Partner Dashboard — Project Plan

## 1. Goal

An external physiotherapy company is partnering with the clinic to provide home-visit
physiotherapy. Their staff need to:
- See **only** physiotherapy appointments (not the clinic's full appointment list)
- See **only** the specific client(s) they've been assigned, not every physio patient
- Add session notes after a home visit, which must land back in Clinicea automatically

Appointments can originate two ways, and both must flow through automatically with no
manual re-entry:
- A doctor/receptionist books the appointment directly inside Clinicea
- A patient books it themselves via Clinicea's online booking

The solution is a small custom web dashboard (not direct Clinicea logins for the partner)
that talks to Clinicea via its API and webhooks. Direct Clinicea access was considered and
rejected as the primary approach because Clinicea's permission system can restrict by
*module* (EMR, Appointments, Billing) but not by *appointment type* or by *individual patient*
— a scoped API key + custom dashboard is the only way to guarantee "only physiotherapy
appointments for this one client."

## 2. Clinicea reference

- **API docs**: https://help.clinicea.com/en/article/how-to-use-the-api-1egs4c7/
- **Webhook docs**: https://help.clinicea.com/en/article/getting-started-with-webhooks-1sq4sw8/
- **Swagger / live API spec**: https://api.clinicea.com/swagger/ui (v3)
- **API FAQ**: https://help.clinicea.com/en/article/clinicea-api-faq-for-online-booking-appointment-integration-196weec/
- **Sandbox login** (from the FAQ): `Stanford_Sandbox_Admin` / `c87e28`
- **Postman collection**: linked from the FAQ article — has sample requests/responses

### Authentication
- API key generated at: Clinicea → Tools → Organization → Preferences → Integrations → Clinicea API
- Sent as a header: `api_key: <key>`
- Keys can be scoped to an **API Role** (e.g. the `ExternalClinician` role) and marked
  **Limited** rather than Full Access — use a scoped key for this integration, not the
  org's main key.

### Endpoints actually used by this app
| Purpose | Endpoint |
|---|---|
| Pull appointments for a date (seed/fallback) | `GET /api/v3/appointments/getAppointmentsByDate` |
| Push a physio's session note back to Clinicea | `PUT /api/v3/appointments/updateAppointment` (`notes` field) |

Other endpoints noted during research but not used here: `createOnlineAppointmentv2`
(online booking widget itself), `patientVisits/createEncounterFull` (full clinical
encounter notes, a heavier alternative to the simple appointment `notes` field if the
partner ever needs structured clinical documentation instead of a free-text note).

### Webhooks (push instead of poll)
Configured at: Clinicea → Tools → Organization → Integrations → Webhooks
Register one entry per (feature, operation) pair:

| Feature | Operation | URL to register |
|---|---|---|
| Appointment | Add | `https://<host>/webhooks/clinicea/<WEBHOOK_SECRET>/appointment/add` |
| Appointment | Edit | `https://<host>/webhooks/clinicea/<WEBHOOK_SECRET>/appointment/edit` |
| Appointment | Cancel | `https://<host>/webhooks/clinicea/<WEBHOOK_SECRET>/appointment/cancel` |
| Appointment | Delete | `https://<host>/webhooks/clinicea/<WEBHOOK_SECRET>/appointment/delete` |

Clinicea does **not** document a payload schema and does **not** sign its webhook
requests. Two mitigations built in:
- `lib/webhook-normalize.js` defensively reads several possible field-name shapes —
  adjust once a real payload has been captured (e.g. via webhook.site).
- `WEBHOOK_SECRET` is embedded in the URL path itself; a request with the wrong secret
  gets a 404 (not a 401, so the route's existence isn't revealed).

### Clinicea Roles/Permissions (for the API key's role, `ExternalClinician`)
For a genuinely view-only role, every Add/Edit/Delete/Copy/Switch permission under EMR
should be OFF; the only "view" permission (`View Past Activities`) can stay ON since it's
additive read access, not an edit right. Full breakdown of each permission's effect is in
the conversation history / see Clinicea's own permission descriptions in-app.

Also confirm there is **no Organization/Admin section** exposed to this role — that's
where API keys, staff lists, and billing/subscription info live, and it must not be
visible to an external party.

## 3. Data flow

### Doctor books directly in Clinicea
1. Staff creates the appointment in Clinicea's Calendar (service = Physiotherapy)
2. Clinicea saves it, then fires the **Appointment/Add** webhook
3. This app's webhook handler normalizes the payload and upserts it into the store
4. Dashboard (polls every few seconds) shows it — if physiotherapy **and** the patient is
   one this partner account is scoped to

### Patient books online themselves
1. Patient uses Clinicea's own Online Booking widget
2. That call goes through Clinicea's own `createOnlineAppointmentv2` — not this app
3. From here on, identical to the doctor-booked path (step 2 onward above) — same webhook,
   same code path. No separate logic needed for "who booked it."

### Physio writes a note
1. Physio opens the dashboard, sees their scoped appointment list, writes a note, clicks Save
2. Saved to the local store immediately (optimistic), status = `pending`
3. App calls Clinicea's `updateAppointment` to push the note
4. On success: status flips to `synced`. On failure: status flips to `failed`, note is kept
   locally (not lost), visible in the UI as needing a retry.

## 4. Access control model

- **Appointment-type filtering**: `PHYSIO_SERVICE_FILTER` env var — substring match
  against `AppointmentServiceName`/`AppointmentServiceCategory`. Applied to every read.
- **Per-client scoping**: each partner account has an `allowedPatientIds` list. Empty list
  = no restriction (for an internal/staff account); non-empty = only those patients.
  Enforced on **both** the appointment list endpoint and the notes-write endpoint (so a
  scoped user can't write a note for a patient outside their list even by guessing an
  appointment ID directly against the API) — this was tested and confirmed with a 403.
- **The Clinicea API key itself** should be the scoped `ExternalClinician`/Limited key,
  not the org's full-access key, as defense in depth beneath the dashboard's own scoping.

## 5. Local demo (works today, no API key needed)

Runs entirely on mock data when `CLINICEA_API_KEY` is unset — same code path as
production, just swaps the Clinicea client for canned data. Useful for showing the
end-to-end flow (including "Simulate: doctor books" / "Simulate: patient books" buttons
that fire the exact same code a real webhook would) before real credentials exist.

```bash
cd /d/clinicea
npm install
cp .env.example .env
npm start
# open http://localhost:3000
```

Demo login: `physio_jane` / `demo123` (scoped to one mock patient, `pat-501`).

## 6. Production architecture

| Layer | Choice | Why |
|---|---|---|
| Hosting | Render (web service, `render.yaml` blueprint) | Simple managed deploy, HTTPS + public URL included, matches the app's scale |
| Database | Managed Postgres (Render-provisioned via the same blueprint) | Reliable, handles concurrent writes, replaces the local JSON file |
| Sessions | `connect-pg-simple` (DB-backed) in production | Default in-memory session store doesn't survive restarts or multiple instances |
| Auth | bcrypt-hashed passwords in `partners` table | No more plain-text demo passwords once live |
| Domain | Render's free subdomain for now; custom domain later | No code changes needed to add one later |

The app auto-detects which mode to run in: no `DATABASE_URL` → local JSON-file store
(dev); `DATABASE_URL` set → Postgres (production). This was verified working after the
refactor — same login/scoping/webhook-simulation flow tested successfully in file mode.

### Key files
- `render.yaml` — one-file deploy blueprint (web service + Postgres + env vars)
- `db/schema.sql` — table definitions (`partners`, `appointments`, `session`)
- `db/migrate.js` — runs schema.sql against `DATABASE_URL` (`npm run db:migrate`)
- `db/seed-partner.js` — create/update a partner account without hand-writing SQL:
  `npm run db:seed-partner -- <username> <password> "<Display Name>" <patientId1,patientId2>`
- `lib/store.js` / `lib/store-pg.js` — same interface, file-backed vs Postgres-backed
- `lib/partners.js` / `lib/partners-pg.js` — same interface, plain-text vs bcrypt+Postgres
- `lib/clinicea-client.js` — real Clinicea API calls vs mock data, based on `CLINICEA_API_KEY`
- `lib/webhook-normalize.js` — defensive payload parsing for Clinicea's undocumented webhook shape

## 7. Deployment checklist

1. [ ] Commit this code to git and push to a GitHub repo (needs your GitHub account)
2. [ ] Create a Render account, "New → Blueprint", point it at that repo — it reads
       `render.yaml` and provisions the web service + Postgres database together
3. [ ] In Render's dashboard, set the real `CLINICEA_API_KEY` (left blank in the blueprint
       on purpose — never auto-generated or committed to git)
4. [ ] Confirm the deploy succeeded and note the public URL Render gives you
5. [ ] In Clinicea, register the 4 webhook URLs using that public URL + the
       `WEBHOOK_SECRET` Render auto-generated (visible in Render's environment variables tab)
6. [ ] Create real partner accounts: `npm run db:seed-partner -- ...` (run this against
       production — either via Render's shell, or locally with `DATABASE_URL` pointed at
       the production database)
7. [ ] Capture one real webhook payload (e.g. via webhook.site first, or by inspecting
       logs after the first real booking) and adjust `lib/webhook-normalize.js` if the
       field names differ from what's assumed
8. [ ] Confirm the `ExternalClinician` API role has no Organization/Admin visibility, and
       that its EMR permissions are locked to view-only (see Section 2)
9. [ ] (Later, optional) Point a real subdomain at the Render service — no code changes needed

## 8. Open decisions / things to revisit

- **Notes granularity**: currently using the simple `notes` field on `updateAppointment`.
  If the partner needs structured clinical documentation instead of free text, switch to
  `patientVisits/createEncounterFull` — bigger change, not yet built.
- **Multiple physios per partner company**: already supported (one `partners` row per
  person, each with their own `allowedPatientIds`) — just needs real accounts seeded.
- **Password reset / account management UI**: currently only via `db:seed-partner` script
  (developer-run). A self-service or admin UI hasn't been built.
- **Rate limiting / abuse protection** on the login and webhook endpoints hasn't been
  added yet — worth doing before this handles real traffic.
