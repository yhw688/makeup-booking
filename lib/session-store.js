const session = require("express-session");
class SQLiteStore extends session.Store {
  constructor(db, now = Date.now) {
    super();
    this.db = db;
    this.now = now;
  }
  get(sid, cb) {
    try {
      const row = this.db
        .prepare("SELECT * FROM sessions WHERE sid=? AND expires_at>?")
        .get(sid, this.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (err) {
      cb(err);
    }
  }
  set(sid, data, cb = () => {}) {
    try {
      this.db
        .prepare("DELETE FROM sessions WHERE expires_at<=?")
        .run(this.now());
      this.db
        .prepare("INSERT OR REPLACE INTO sessions VALUES(?,?,?)")
        .run(
          sid,
          JSON.stringify(data),
          data.expiresAt || this.now() + data.cookie.originalMaxAge,
        );
      cb();
    } catch (err) {
      cb(err);
    }
  }
  destroy(sid, cb = () => {}) {
    try {
      this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid);
      cb();
    } catch (err) {
      cb(err);
    }
  }
}
module.exports = SQLiteStore;
