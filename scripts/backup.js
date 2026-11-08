require("dotenv").config();
const Database = require("better-sqlite3");
const target = process.argv[2];
if (!process.env.DB_PATH || !target)
  throw new Error("Set DB_PATH and provide a new backup destination.");
if (require("node:fs").existsSync(target))
  throw new Error("Destination already exists.");
const db = new Database(process.env.DB_PATH, { readonly: true });
db.backup(target)
  .then(() => {
    db.close();
    console.log("Backup complete. Store it securely outside the service disk.");
  })
  .catch(() => {
    db.close();
    process.exitCode = 1;
  });
