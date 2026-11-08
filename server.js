require("dotenv").config();
const { openDatabase } = require("./db/database");
const { createApp } = require("./lib/app");
const db = openDatabase(process.env.DB_PATH || "./db/bookings.db");
const app = createApp({ db });
const server = app.listen(process.env.PORT || 3000, () =>
  console.info(JSON.stringify({ event: "server_started" })),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
