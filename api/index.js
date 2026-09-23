// Vercel serverless entry point. Vercel's Node runtime invokes an exported Express
// app directly as the request handler -- no app.listen() here, Vercel owns that.
const { app } = require('../app');

module.exports = app;
