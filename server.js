// Local development entry point. On Vercel, api/index.js exports the same app
// without calling listen() -- Vercel's runtime handles the HTTP server itself.
const { app, seedStoreIfEmpty } = require('./app');
const db = require('./lib/db');
const clinicea = require('./lib/clinicea-client');

const PORT = process.env.PORT || 3000;

seedStoreIfEmpty().then(() => {
  app.listen(PORT, () => {
    console.log(`CareBridge running at http://localhost:${PORT}`);
    console.log(`Data store: ${db.isConfigured() ? 'Postgres' : 'local JSON file'}`);
    console.log(`Clinicea API: ${clinicea.isLiveMode() ? 'LIVE' : 'MOCK (no CLINICEA_API_KEY set)'}`);
  });
});
