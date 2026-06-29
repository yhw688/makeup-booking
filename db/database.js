// db/database.js
// SQLite database using better-sqlite3 (production-ready synchronous API).
// In local dev, data persists to ./db/bookings.json (simple JSON store as fallback).

const fs   = require('fs');
const path = require('path');

const DB_FILE = path.resolve(process.env.DB_PATH || './db/bookings.json');
const dir     = path.dirname(DB_FILE);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// ── Simple JSON-backed store (works without native modules) ───────────────────
function load() {
  if (!fs.existsSync(DB_FILE)) return { appointments: [], seq: 0 };
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return { appointments: [], seq: 0 }; }
}

function save(store) {
  fs.writeFileSync(DB_FILE, JSON.stringify(store, null, 2));
}

const db = {
  insertAppointment({ name, email, date, service, message }) {
    const store = load();
    store.seq += 1;
    const now = new Date().toISOString();
    const row = { id: store.seq, name, email, date, service, message: message || null, status: 'pending', created_at: now };
    store.appointments.push(row);
    save(store);
    return row;
  },

  getAllAppointments() {
    return load().appointments.slice().reverse();
  },

  getAppointmentById(id) {
    return load().appointments.find(a => a.id === Number(id)) || null;
  },

  updateStatus(id, status) {
    const store = load();
    const idx   = store.appointments.findIndex(a => a.id === Number(id));
    if (idx === -1) return false;
    store.appointments[idx].status = status;
    save(store);
    return true;
  },
};

module.exports = db;
