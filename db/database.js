const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

function openDatabase(filename) {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL,
      date TEXT NOT NULL, service TEXT NOT NULL, message TEXT,
      status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    `);
    if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version=1").get()) {
      const columns = new Set(
        db.pragma("table_info(appointments)").map((c) => c.name),
      );
      for (const [name, type] of Object.entries({
        starts_at: "INTEGER",
        ends_at: "INTEGER",
        buffer_minutes: "INTEGER",
        revision: "INTEGER NOT NULL DEFAULT 0",
      })) {
        if (!columns.has(name))
          db.exec(`ALTER TABLE appointments ADD COLUMN ${name} ${type}`);
      }
      db.exec(`CREATE TABLE availability(date TEXT PRIMARY KEY, start_time TEXT NOT NULL, end_time TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1)));
        CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), duration_minutes INTEGER NOT NULL CHECK(duration_minutes BETWEEN 15 AND 480), buffer_minutes INTEGER NOT NULL CHECK(buffer_minutes BETWEEN 0 AND 120));
        INSERT INTO settings VALUES(1,90,15);
        CREATE TABLE sessions(sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE email_jobs(id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL REFERENCES appointments(id), kind TEXT NOT NULL, revision INTEGER NOT NULL, due_at INTEGER NOT NULL,
          state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','sent','cancelled','failed')), attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, token TEXT, last_error TEXT, sent_at INTEGER,
          UNIQUE(appointment_id,kind,revision));
        CREATE INDEX jobs_due ON email_jobs(state,due_at);
        CREATE INDEX appointments_schedule ON appointments(status,starts_at,ends_at);
        CREATE TABLE worker_state(id INTEGER PRIMARY KEY CHECK(id=1), last_run INTEGER NOT NULL);
      `);
      db.prepare("INSERT INTO schema_migrations VALUES(1,?)").run(
        new Date().toISOString(),
      );
    }
  }).immediate();
  return db;
}
module.exports = { openDatabase };
