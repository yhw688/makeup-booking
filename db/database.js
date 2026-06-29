/*db/database.js is the data layer of the application —
 it reads and writes booking records to a JSON file, 
 acting as a lightweight database that stores client appointment records, service types, booking dates, and customer messages. */

/* appointments.js calls insertAppointment()
        ↓
load() opens bookings.json
        ↓
Assigns new ID, timestamps, sets status to pending
        ↓
Pushes new booking into the appointments array
        ↓
save() writes everything back to bookings.json
        ↓
Returns the saved booking to appointments.js */

/*
database.js 自己什么都不会主动做，它只是等待被调用。只有当 appointments.js 需要它的时候，它才发挥作用：

有新预约进来 → appointments.js 调用 db.insertAppointment()
有人查询预约 → appointments.js 调用 db.getAllAppointments()
有人更新状态 → appointments.js 调用 db.updateStatus() */

// db/database.js
// SQLite database using better-sqlite3

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './db/bookings.db';

// Ensure the db/ directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Open the database
const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create the appointments table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    service     TEXT    NOT NULL,
    message     TEXT,
    status      TEXT    NOT NULL DEFAULT 'pending',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

const dbHelper = {
  insertAppointment({ name, email, date, service, message }) {
    const stmt = db.prepare(`
      INSERT INTO appointments (name, email, date, service, message)
      VALUES (@name, @email, @date, @service, @message)
    `);
    const result = stmt.run({ name, email, date, service, message: message || null });
    return this.getAppointmentById(result.lastInsertRowid);
  },

  getAllAppointments() {
    return db.prepare(`
      SELECT * FROM appointments ORDER BY created_at DESC
    `).all();
  },

  getAppointmentById(id) {
    return db.prepare(`
      SELECT * FROM appointments WHERE id = ?
    `).get(id) || null;
  },

  updateStatus(id, status) {
    const result = db.prepare(`
      UPDATE appointments SET status = ? WHERE id = ?
    `).run(status, id);
    return result.changes > 0;
  },
};

module.exports = dbHelper;