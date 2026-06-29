// server.js
// Entry point — Express server wiring everything together.
//server.js is the entry point of the entire backend. It starts the server, 
//configures middleware, serves static files to the browser, and routes API requests to the appropriate handler.

//server.js is the front desk of the entire application — it starts the server, loads secret keys, 
//decides where each request should go, and serves the website to users.

require('dotenv').config(); //get .env file and loads all the variables like SENDGRID_API_KEY、FROM_EMAIL

const express    = require('express'); //express - a framework that helps build a server without writing everything from scratch
const cors       = require('cors'); //allows the browser to make requests to the API from different origins
const path       = require('path'); //helps handle file paths, like finding where your public/ folder is
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
app.use('/api/appointments', appointmentsRouter); //Any request that starts with /api/appointments gets handed off to routes/appointments.js. 
//This is called routing — different requests are handled by different files.

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
