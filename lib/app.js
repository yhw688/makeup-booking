const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const bcrypt = require("bcrypt");
const crypto = require("node:crypto");
const path = require("node:path");
const SQLiteStore = require("./session-store");
const {
  available,
  requireSlot,
  settings,
  validDate,
  localInstant,
  SERVICES,
  fail,
} = require("./scheduling");
const { enqueue, cancelJobs, processJobs } = require("./jobs");
const { deliver } = require("../utils/mailer");
const wrap = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res, next))
    .catch(next);
function createApp({
  db,
  config = process.env,
  now = Date.now,
  send = deliver,
}) {
  const production = config.NODE_ENV === "production";
  if (
    !config.SESSION_SECRET ||
    config.SESSION_SECRET.length < 32 ||
    !config.ADMIN_USERNAME ||
    !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(
      config.ADMIN_PASSWORD_HASH || "",
    )
  )
    throw new Error(
      "Set SESSION_SECRET (32+ characters), ADMIN_USERNAME, and a bcrypt ADMIN_PASSWORD_HASH.",
    );
  if (
    production &&
    (!config.APP_ORIGIN ||
      !config.APP_ORIGIN.startsWith("https://") ||
      !config.DB_PATH ||
      !config.SENDGRID_API_KEY ||
      !config.FROM_EMAIL ||
      !config.WORKER_SECRET ||
      config.WORKER_SECRET.length < 32)
  )
    throw new Error(
      "Production requires HTTPS APP_ORIGIN, persistent DB_PATH, email configuration and WORKER_SECRET (32+ characters).",
    );
  const app = express();
  app.disable("x-powered-by");
  if (config.TRUST_PROXY === "1") app.set("trust proxy", 1);
  // Existing public HTML uses inline scripts/styles and remote portfolio embeds.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          frameSrc: [
            "https://www.youtube.com",
            "https://www.youtube-nocookie.com",
            "https://drive.google.com",
          ],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    // Same-origin deployment: no cross-origin credential sharing.
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") &&
      req.get("origin") !== (config.APP_ORIGIN || "http://localhost:3000")
    )
      return res
        .status(403)
        .json({ success: false, message: "Origin not allowed." });
    next();
  });
  app.use(
    session({
      name: "yh.sid",
      secret: config.SESSION_SECRET,
      store: new SQLiteStore(db, now),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: production,
        sameSite: "strict",
        maxAge: 8 * 3600000,
      },
    }),
  );
  const limit = (max, windowMs) =>
    rateLimit({
      windowMs,
      limit: max,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        success: false,
        message: "Too many requests. Please try later.",
      },
    });
  const auth = (req, res, next) =>
    req.session.admin && req.session.expiresAt > now()
      ? next()
      : res.status(401).json({ success: false, message: "Please log in." });
  const csrf = (req, res, next) => {
    const expected = req.session.csrf,
      actual = req.get("x-csrf-token");
    if (
      !expected ||
      !actual ||
      Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      return res
        .status(403)
        .json({ success: false, message: "Invalid CSRF token." });
    next();
  };
  app.get("/api/auth/session", (req, res) => {
    req.session.csrf ||= crypto.randomBytes(32).toString("hex");
    res.json({
      success: true,
      authenticated: !!req.session.admin && req.session.expiresAt > now(),
      csrfToken: req.session.csrf,
    });
  });
  app.post(
    "/api/auth/login",
    limit(10, 15 * 60000),
    csrf,
    wrap(async (req, res) => {
      const { username, password } = req.body;
      if (
        typeof username !== "string" ||
        typeof password !== "string" ||
        Buffer.byteLength(password) > 72 ||
        !(await bcrypt.compare(password, config.ADMIN_PASSWORD_HASH)) ||
        username !== config.ADMIN_USERNAME
      )
        return res
          .status(401)
          .json({ success: false, message: "Invalid credentials." });
      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      req.session.admin = true;
      req.session.expiresAt = now() + 8 * 3600000;
      req.session.csrf = crypto.randomBytes(32).toString("hex");
      res.json({ success: true, csrfToken: req.session.csrf });
    }),
  );
  app.post(
    "/api/auth/logout",
    auth,
    csrf,
    wrap(async (req, res) => {
      await new Promise((resolve, reject) =>
        req.session.destroy((e) => (e ? reject(e) : resolve())),
      );
      res
        .clearCookie("yh.sid", {
          httpOnly: true,
          secure: production,
          sameSite: "strict",
        })
        .json({ success: true });
    }),
  );
  app.get("/api/availability", limit(120, 60000), (req, res, next) => {
    try {
      res.json({
        success: true,
        timezone: "America/New_York",
        data: available(db, req.query.date, req.query.service, now()),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post(
    "/api/appointments",
    limit(10, 3600000),
    wrap((req, res) => {
      const { name, email, date, service, starts_at, message = "" } = req.body;
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100 ||
        typeof email !== "string" ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !validDate(date) ||
        !SERVICES.includes(service) ||
        typeof message !== "string" ||
        message.length > 2000
      )
        fail("Please provide a valid name, email, date, service and notes.");
      const a = db
        .transaction(() => {
          const slot = requireSlot(db, date, service, starts_at, now());
          const result = db
            .prepare(
              "INSERT INTO appointments(name,email,date,service,message,starts_at,ends_at,buffer_minutes) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              name.trim(),
              email.trim(),
              date,
              service,
              message,
              slot.starts_at,
              slot.ends_at,
              slot.buffer_minutes,
            );
          const a = db
            .prepare("SELECT * FROM appointments WHERE id=?")
            .get(result.lastInsertRowid);
          enqueue(db, a, "received", now());
          enqueue(db, a, "artist", now());
          return a;
        })
        .immediate();
      res
        .status(201)
        .json({
          success: true,
          message:
            "Request received. Email is queued; your appointment is pending review.",
          data: {
            id: a.id,
            status: a.status,
            starts_at: new Date(a.starts_at).toISOString(),
          },
        });
    }),
  );
  app.use("/api/admin", auth);
  app.get("/api/admin/availability", (req, res) =>
    res.json({
      success: true,
      data: db.prepare("SELECT * FROM availability ORDER BY date").all(),
      settings: settings(db),
    }),
  );
  app.put(
    "/api/admin/settings",
    csrf,
    wrap((req, res) => {
      const { duration_minutes: d, buffer_minutes: b } = req.body;
      if (
        !Number.isInteger(d) ||
        d < 15 ||
        d > 480 ||
        !Number.isInteger(b) ||
        b < 0 ||
        b > 120
      )
        fail("Duration must be 15–480 minutes; buffer 0–120.");
      db.prepare(
        "UPDATE settings SET duration_minutes=?,buffer_minutes=? WHERE id=1",
      ).run(d, b);
      res.json({ success: true });
    }),
  );
  app.put(
    "/api/admin/availability/:date",
    csrf,
    wrap((req, res) => {
      const date = req.params.date,
        {
          start_time = "09:00",
          end_time = "17:00",
          blocked = false,
        } = req.body;
      if (!validDate(date) || typeof blocked !== "boolean")
        fail("Invalid availability.");
      if (localInstant(date, start_time) >= localInstant(date, end_time))
        fail("End must be after start on the same date.");
      db.prepare("INSERT OR REPLACE INTO availability VALUES(?,?,?,?)").run(
        date,
        start_time,
        end_time,
        Number(blocked),
      );
      res.json({
        success: true,
        message:
          "Availability updated. Existing confirmed bookings are retained.",
      });
    }),
  );
  app.get("/api/admin/jobs", (req, res) =>
    res.json({
      success: true,
      data: db
        .prepare(
          "SELECT id,appointment_id,kind,state,attempts,due_at,last_error FROM email_jobs ORDER BY id DESC LIMIT 200",
        )
        .all(),
      worker: db.prepare("SELECT * FROM worker_state WHERE id=1").get() || null,
    }),
  );
  app.get(
    "/api/appointments",
    auth,
    wrap((req, res) => {
      const { status, upcoming } = req.query;
      if (status && !["pending", "confirmed", "cancelled"].includes(status))
        fail("Invalid status.");
      const rows = db
        .prepare("SELECT * FROM appointments ORDER BY date,starts_at,id")
        .all()
        .filter(
          (a) =>
            (!status || a.status === status) &&
            (!upcoming ||
              (a.starts_at !== null &&
                a.starts_at > now() &&
                a.status !== "cancelled")),
        );
      res.json({ success: true, data: rows, count: rows.length });
    }),
  );
  app.use("/api/appointments/:id", (req, res, next) =>
    /^\d+$/.test(req.params.id) &&
    Number.isSafeInteger(Number(req.params.id)) &&
    Number(req.params.id) > 0
      ? next()
      : res.status(400).json({ success: false, message: "Invalid ID." }),
  );
  app.get(
    "/api/appointments/:id",
    auth,
    wrap((req, res) => {
      const a = db
        .prepare("SELECT * FROM appointments WHERE id=?")
        .get(req.params.id);
      if (!a) fail("Appointment not found.", 404);
      res.json({ success: true, data: a });
    }),
  );
  app.patch(
    "/api/appointments/:id/status",
    auth,
    csrf,
    wrap((req, res) => {
      const status = req.body.status;
      if (!["confirmed", "cancelled"].includes(status))
        fail("Choose confirmed or cancelled.");
      const a = db
        .transaction(() => {
          let a = db
            .prepare("SELECT * FROM appointments WHERE id=?")
            .get(req.params.id);
          if (!a) fail("Appointment not found.", 404);
          if (a.status === status) return a;
          if (a.status === "cancelled")
            fail(
              "Cancelled appointments cannot be reopened. Create a new request.",
              409,
            );
          if (status === "confirmed") {
            const iso =
              a.starts_at === null
                ? req.body.starts_at
                : new Date(a.starts_at).toISOString();
            const slot = requireSlot(db, a.date, a.service, iso, now(), a.id);
            db.prepare(
              "UPDATE appointments SET starts_at=?,ends_at=?,buffer_minutes=? WHERE id=?",
            ).run(slot.starts_at, slot.ends_at, slot.buffer_minutes, a.id);
          }
          cancelJobs(db, a.id);
          db.prepare(
            "UPDATE appointments SET status=?,revision=revision+1 WHERE id=?",
          ).run(status, a.id);
          a = db.prepare("SELECT * FROM appointments WHERE id=?").get(a.id);
          enqueue(db, a, status, now());
          if (status === "confirmed")
            enqueue(db, a, "reminder", Math.max(now(), a.starts_at - 86400000));
          return a;
        })
        .immediate();
      res.json({ success: true, data: a });
    }),
  );
  app.post(
    "/api/internal/jobs/run",
    limit(5, 60000),
    wrap(async (req, res) => {
      const expected = config.WORKER_SECRET,
        actual = req.get("authorization");
      const wanted = expected ? `Bearer ${expected}` : "";
      if (
        !wanted ||
        !actual ||
        Buffer.byteLength(actual) !== Buffer.byteLength(wanted) ||
        !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(wanted))
      )
        fail("Unauthorized.", 401);
      await processJobs(db, send, now);
      res.json({ success: true });
    }),
  );
  app.get("/api/health", (req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ success: false, message: "Endpoint not found." }),
  );
  app.use(express.static(path.join(__dirname, "../public")));
  app.get("/", (_req, res) =>
    res.sendFile(path.join(__dirname, "../public/index.html")),
  );
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request_failed",
          method: req.method,
          code: err.code || "INTERNAL",
        }),
      );
    res
      .status(status)
      .json({
        success: false,
        message:
          status >= 500
            ? "Server error. Please try again."
            : err.type === "entity.parse.failed"
              ? "Invalid JSON."
              : err.message,
      });
  });
  return app;
}
module.exports = { createApp };
