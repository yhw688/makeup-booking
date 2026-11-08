require("dotenv").config();
const { openDatabase } = require("./db/database");
const { processJobs } = require("./lib/jobs");
const { deliver } = require("./utils/mailer");
const db = openDatabase(process.env.DB_PATH || "./db/bookings.db");
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
(async () => {
  do {
    await processJobs(db, deliver);
    if (process.argv.includes("--once") || stopped) break;
    await new Promise((r) => setTimeout(r, 15000));
  } while (!stopped);
  db.close();
})().catch(() => {
  console.error(JSON.stringify({ event: "worker_failed" }));
  db.close();
  process.exitCode = 1;
});
