// Usage: node db/seed-partner.js <username> <password> <"Display Name"> [patientId1,patientId2,...] [email] [phone]
// Creates or updates one partner account in Postgres. Leave the patient-id list empty for
// an account that can see every physiotherapy appointment (no per-client restriction).
// Email/phone are optional but needed for that person to receive new-booking notifications.
require('dotenv').config();
const { isConfigured } = require('../lib/db');
const partners = require('../lib/partners-pg');

async function main() {
  if (!isConfigured()) {
    console.error('DATABASE_URL is not set — this script only works against Postgres.');
    process.exit(1);
  }
  const [username, password, name, patientIdsRaw, email, phone] = process.argv.slice(2);
  if (!username || !password || !name) {
    console.error('Usage: node db/seed-partner.js <username> <password> <"Display Name"> [patientId1,patientId2,...] [email] [phone]');
    process.exit(1);
  }
  const allowedPatientIds = (patientIdsRaw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  await partners.createPartner({ username, password, name, allowedPatientIds, email, phone });
  console.log(`Partner "${username}" saved. Scoped to: ${allowedPatientIds.length ? allowedPatientIds.join(', ') : 'ALL physiotherapy appointments (no restriction)'}`);
  console.log(`Notifications: email=${email || '(none)'} phone=${phone || '(none)'}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
