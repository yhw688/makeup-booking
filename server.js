// server.js
// Entry point — Express server wiring everything together.

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const appointmentsRouter = require('./routes/appointments');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());                          // allow cross-origin requests from the front-end
app.use(express.json());                  // parse JSON bodies
app.use(express.urlencoded({ extended: true })); // parse HTML form bodies

// ── Serve static front-end ────────────────────────────────────────────────────
// Place your index.html, style.css, and images in the /public folder.
app.use(express.static(path.join(__dirname, 'public')));

// ── REST API routes ───────────────────────────────────────────────────────────
app.use('/api/appointments', appointmentsRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Catch-all: serve index.html for any non-API route ─────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✨ OrlandoYHMakeup server running → http://localhost:${PORT}`);
});

module.exports = app; // exported for testing
