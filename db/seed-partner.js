// Usage: node db/seed-partner.js <username> <password> <"Display Name"> <patientId1,patientId2,...>
// Creates or updates one partner account in Postgres. Leave the patient-id list empty for
// an account that can see every physiotherapy appointment (no per-client restriction).
require('dotenv').config();
const { isConfigured } = require('../lib/db');
const partners = require('../lib/partners-pg');

async function main() {
  if (!isConfigured()) {
    console.error('DATABASE_URL is not set — this script only works against Postgres.');
    process.exit(1);
  }
  const [username, password, name, patientIdsRaw] = process.argv.slice(2);
  if (!username || !password || !name) {
    console.error('Usage: node db/seed-partner.js <username> <password> <"Display Name"> [patientId1,patientId2,...]');
    process.exit(1);
  }
  const allowedPatientIds = (patientIdsRaw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  await partners.createPartner({ username, password, name, allowedPatientIds });
  console.log(`Partner "${username}" saved. Scoped to: ${allowedPatientIds.length ? allowedPatientIds.join(', ') : 'ALL physiotherapy appointments (no restriction)'}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
