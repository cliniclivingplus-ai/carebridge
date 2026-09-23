# CareBridge — Project Plan
### (PhysioWay ⇄ Clinicea integration)

## 1. Goal

An external physiotherapy company (PhysioWay) is partnering with the clinic to provide home-visit
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
cd /d/Physiowah
npm install
cp .env.example .env
npm start
# open http://localhost:3000
```

Demo login: `physio_jane` / `demo123` (scoped to one mock patient, `pat-501`).

## 6. Production architecture

| Layer | Choice | Why |
|---|---|---|
| Version control | GitHub | Vercel deploys straight from a connected GitHub repo |
| Hosting | Vercel (serverless functions) | No Render/Supabase — Vercel is a single-vendor stack for hosting + Postgres together |
| Database | **Vercel Postgres** (created under the project's Storage tab) | Same standard `pg` driver code works unchanged; no Supabase needed |
| Sessions | `connect-pg-simple` (DB-backed) in production | Vercel functions are stateless between invocations — an in-memory session store wouldn't survive one request to the next, let alone a cold start |
| Auth | bcrypt-hashed passwords in a `partners` table (in the same Vercel Postgres DB) | Chosen over env-var logins since the partner list is expected to grow — a real table scales better than redeploying to add each person |
| Domain | Vercel's free `*.vercel.app` subdomain for now; custom domain later | No code changes needed to add one later |

The app auto-detects which mode to run in: no `DATABASE_URL` → local JSON-file store
(dev); `DATABASE_URL` set → Postgres (production, via Vercel Postgres). Verified working
locally after the Vercel refactor — login, per-client scoping, and webhook simulation all
still function correctly against the new `app.js`/`server.js`/`api/index.js` split.

### Why the code is split into app.js / server.js / api/index.js
Render (the original plan) expected one long-running Node process (`app.listen()`).
Vercel runs **serverless functions** instead — no persistent process, no guarantee the
same instance handles your next request, and everything in memory can vanish between
calls. So the app is split three ways:
- **`app.js`** — the actual Express app (all routes, middleware) with no `listen()` call
- **`server.js`** — local dev only: requires `app.js` and calls `app.listen()`
- **`api/index.js`** — the Vercel entry point: exports the same Express app directly;
  Vercel's Node runtime invokes it per-request without ever calling `listen()`
- **`vercel.json`** — routes `/api/*` and `/webhooks/*` to that function; everything else
  (the login page, `app.js`/`style.css` in `public/`) is served by Vercel's built-in
  static hosting for anything under a top-level `public/` folder, no function invoked at all

One consequence of "stateless between requests": the store-seeding step now runs lazily
inside each route (guarded so concurrent cold starts don't double-seed) rather than once
at startup, since there is no single "startup" on Vercel.

### Key files
- `vercel.json` — routes API/webhook paths to the serverless function
- `api/index.js` — Vercel's function entry point (exports the Express app)
- `app.js` — the actual application logic, shared by both local dev and Vercel
- `db/schema.sql` — table definitions (`partners`, `appointments`, `session`)
- `db/migrate.js` — runs schema.sql against `DATABASE_URL` (`npm run db:migrate`)
- `db/seed-partner.js` — create/update a partner account without hand-writing SQL:
  `npm run db:seed-partner -- <username> <password> "<Display Name>" <patientId1,patientId2>`
- `lib/store.js` / `lib/store-pg.js` — same interface, file-backed vs Postgres-backed
- `lib/partners.js` / `lib/partners-pg.js` — same interface, plain-text vs bcrypt+Postgres
- `lib/clinicea-client.js` — real Clinicea API calls vs mock data, based on `CLINICEA_API_KEY`
- `lib/webhook-normalize.js` — defensive payload parsing for Clinicea's undocumented webhook shape

## 7. Deployment checklist

1. [ ] Push this repo to GitHub (needs your GitHub account)
2. [ ] Create a Vercel account, "Add New → Project", import that GitHub repo
3. [ ] In the Vercel project, go to Storage → Create Database → **Postgres** — this sets
       `DATABASE_URL` automatically, no Supabase involved
4. [ ] In Vercel's project Settings → Environment Variables, set: `CLINICEA_API_KEY` (the
       real scoped key), `SESSION_SECRET` and `WEBHOOK_SECRET` (any long random strings —
       Vercel doesn't auto-generate these the way Render's blueprint did, so generate them
       yourself, e.g. `openssl rand -hex 32`), `CLINICEA_BASE_URL`, `PHYSIO_SERVICE_FILTER`
5. [ ] Run the DB migration against the real database once: `vercel env pull .env` (to get
       the real `DATABASE_URL` locally), then `npm run db:migrate` — Vercel has no
       Render-style "run this before every start" hook, so this is a manual one-time step
       (re-run it after any future schema change)
6. [ ] Deploy, confirm it succeeds, note the `*.vercel.app` URL
7. [ ] In Clinicea, register the 4 webhook URLs using that URL + the `WEBHOOK_SECRET` from
       step 4
8. [ ] Create real partner accounts: `npm run db:seed-partner -- ...` (run locally with
       `DATABASE_URL` pointed at the production database, via `vercel env pull`)
9. [ ] Capture one real webhook payload (e.g. via webhook.site first, or by inspecting
       logs after the first real booking) and adjust `lib/webhook-normalize.js` if the
       field names differ from what's assumed
10. [ ] Confirm the `ExternalClinician` API role has no Organization/Admin visibility, and
        that its EMR permissions are locked to view-only (see Section 2)
11. [ ] (Later, optional) Point a real custom domain at the Vercel project — no code
        changes needed

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
