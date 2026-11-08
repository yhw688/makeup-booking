const bcrypt = require("bcrypt");
const { DateTime } = require("luxon");
const { openDatabase } = require("../../db/database");
const { createApp } = require("../../lib/app");
const db = openDatabase(":memory:");
const date = DateTime.now()
  .setZone("America/New_York")
  .plus({ days: 3 })
  .toISODate();
db.prepare("INSERT INTO availability VALUES(?,?,?,0)").run(
  date,
  "09:00",
  "17:00",
);
const config = {
  SESSION_SECRET: "browser-test-secret-that-is-never-for-production",
  ADMIN_USERNAME: "test-artist",
  ADMIN_PASSWORD_HASH: bcrypt.hashSync("browser-test-password", 4),
  APP_ORIGIN: "http://127.0.0.1:3137",
};
const app = createApp({
  db,
  config,
  send: async () => {
    throw new Error("Email disabled in browser tests");
  },
});
const server = app.listen(3137, "127.0.0.1");
process.on("SIGTERM", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
