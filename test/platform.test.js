const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const { openDatabase } = require("../db/database");
const { createApp } = require("../lib/app");
const { available, localInstant } = require("../lib/scheduling");
const { processJobs, enqueue } = require("../lib/jobs");
const { template, deliver } = require("../utils/mailer");
const hash = bcrypt.hashSync("a-test-password-123", 4);
let db, app, agent, token, clock, tmp, sent;
const config = {
  SESSION_SECRET: "x".repeat(48),
  ADMIN_USERNAME: "artist",
  ADMIN_PASSWORD_HASH: hash,
  APP_ORIGIN: "http://localhost:3000",
  WORKER_SECRET: "w".repeat(40),
};
const input = (extra = {}) => ({
  name: "Test Client",
  email: "client@example.invalid",
  date: "2030-06-10",
  service: "event",
  message: "Hello",
  starts_at: "2030-06-10T13:00:00.000Z",
  ...extra,
});
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "makeup-test-"));
  db = openDatabase(path.join(tmp, "test.db"));
  clock = Date.parse("2030-06-01T00:00:00Z");
  sent = [];
  app = createApp({
    db,
    config,
    now: () => clock,
    send: async (...args) => sent.push(args),
  });
  agent = request.agent(app);
  db.prepare("INSERT INTO availability VALUES(?,?,?,0)").run(
    "2030-06-10",
    "09:00",
    "17:00",
  );
});
afterEach(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
async function login() {
  const s = await agent.get("/api/auth/session").expect(200);
  token = s.body.csrfToken;
  const r = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ username: "artist", password: "a-test-password-123" })
    .expect(200);
  token = r.body.csrfToken;
  return r;
}
async function book(extra = {}) {
  return (
    await request(app).post("/api/appointments").send(input(extra)).expect(201)
  ).body.data.id;
}
function status(id, value = "confirmed", extra = {}) {
  return agent
    .patch(`/api/appointments/${id}/status`)
    .set("X-CSRF-Token", token)
    .send({ status: value, ...extra });
}
test("admin APIs deny anonymous access", async () => {
  await request(app).get("/api/appointments").expect(401);
  await request(app).get("/api/appointments/1").expect(401);
  await request(app)
    .patch("/api/appointments/1/status")
    .send({ status: "confirmed" })
    .expect(401);
  await request(app).get("/api/admin/jobs").expect(401);
});
test("login rotates session and CSRF, cookies are HttpOnly SameSite Strict", async () => {
  const pre = await agent.get("/api/auth/session");
  const before = pre.headers["set-cookie"][0];
  await login();
  const s = await agent.get("/api/auth/session").expect(200);
  assert.equal(s.body.authenticated, true);
  assert.match(before, /HttpOnly/);
  assert.match(before, /SameSite=Strict/);
  assert.notEqual(s.body.csrfToken, pre.body.csrfToken);
  await agent.get("/api/appointments").expect(200);
});
test("invalid credentials and oversized bcrypt passwords fail", async () => {
  const s = await agent.get("/api/auth/session");
  for (const password of ["incorrect", "a".repeat(73)])
    await agent
      .post("/api/auth/login")
      .set("X-CSRF-Token", s.body.csrfToken)
      .send({ username: "artist", password })
      .expect(401);
});
test("CSRF required for login and all administrative writes", async () => {
  await agent
    .post("/api/auth/login")
    .send({ username: "artist", password: "wrong" })
    .expect(403);
  await login();
  await agent
    .put("/api/admin/settings")
    .send({ duration_minutes: 30, buffer_minutes: 0 })
    .expect(403);
  await agent.post("/api/auth/logout").expect(403);
});
test("logout revokes server-side session and replay fails", async () => {
  const r = await login();
  const cookie = r.headers["set-cookie"][0].split(";")[0];
  await agent.post("/api/auth/logout").set("X-CSRF-Token", token).expect(200);
  await request(app).get("/api/appointments").set("Cookie", cookie).expect(401);
});
test("session expires after eight hours", async () => {
  await login();
  clock += 8 * 3600000 + 1;
  await agent.get("/api/appointments").expect(401);
});
test("session persists across app restart", async () => {
  const r = await login();
  const cookie = r.headers["set-cookie"][0].split(";")[0];
  const restarted = createApp({ db, config, now: () => clock });
  await request(restarted)
    .get("/api/appointments")
    .set("Cookie", cookie)
    .expect(200);
});
test("login rate limit enforced", async () => {
  const s = await agent.get("/api/auth/session");
  for (let i = 0; i < 10; i++)
    await agent
      .post("/api/auth/login")
      .set("X-CSRF-Token", s.body.csrfToken)
      .send({ username: "artist", password: "bad" })
      .expect(401);
  await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", s.body.csrfToken)
    .send({})
    .expect(429);
});
test("production cookies are Secure and configuration fails closed", async () => {
  assert.throws(() => createApp({ db, config: {} }));
  const prod = createApp({
    db,
    config: {
      ...config,
      NODE_ENV: "production",
      APP_ORIGIN: "https://example.invalid",
      DB_PATH: "/data/db",
      FROM_EMAIL: "sender@example.invalid",
      SENDGRID_API_KEY: "fake",
      TRUST_PROXY: "1",
    },
  });
  const s = await request(prod)
    .get("/api/auth/session")
    .set("X-Forwarded-Proto", "https");
  assert.match(s.headers["set-cookie"][0], /; Secure/);
  assert.ok(s.headers["strict-transport-security"]);
});
test("cross-origin state changes denied, security headers set", async () => {
  await request(app)
    .post("/api/appointments")
    .set("Origin", "https://evil.invalid")
    .send(input())
    .expect(403);
  const r = await request(app).get("/");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["access-control-allow-origin"], undefined);
});
test("oversized and malformed bodies rejected", async () => {
  await request(app)
    .post("/api/appointments")
    .send(input({ message: "x".repeat(17000) }))
    .expect(413);
  await request(app)
    .post("/api/appointments")
    .set("Content-Type", "application/json")
    .send("{")
    .expect(400);
});
test("valid public booking creates pending request and two durable emails", async () => {
  const id = await book();
  const a = db.prepare("SELECT * FROM appointments WHERE id=?").get(id);
  assert.equal(a.status, "pending");
  assert.equal(a.ends_at - a.starts_at, 90 * 60000);
  assert.equal(db.prepare("SELECT count(*) n FROM email_jobs").get().n, 2);
  assert.equal(sent.length, 0);
});
test("invalid customer input rejected without database writes", async () => {
  for (const extra of [
    { email: "bad" },
    { name: "" },
    { service: "unknown" },
    { date: "2030-02-30" },
    { message: {} },
    { name: "a".repeat(101) },
    { starts_at: 123 },
  ])
    await request(app)
      .post("/api/appointments")
      .send(input(extra))
      .expect((r) => assert.ok([400, 409].includes(r.status)));
  assert.equal(db.prepare("SELECT count(*) n FROM appointments").get().n, 0);
});
test("past times, closed dates, and invented slots rejected", async () => {
  for (const extra of [
    { date: "2029-01-01" },
    { date: "2030-06-11" },
    { starts_at: "2030-06-10T13:05:00.000Z" },
  ])
    await request(app).post("/api/appointments").send(input(extra)).expect(409);
  clock = Date.parse("2030-06-10T14:00Z");
  await request(app).post("/api/appointments").send(input()).expect(409);
});
test("public rate limit enforced without duplicate inserts", async () => {
  for (let i = 0; i < 10; i++)
    await request(app).post("/api/appointments").send({}).expect(400);
  await request(app).post("/api/appointments").send(input()).expect(429);
});
test("availability respects blocked dates and settings validation", async () => {
  await login();
  await agent
    .put("/api/admin/availability/2030-06-10")
    .set("X-CSRF-Token", token)
    .send({ blocked: true })
    .expect(200);
  assert.deepEqual(available(db, "2030-06-10", "event", clock), []);
  await request(app).post("/api/appointments").send(input()).expect(409);
  await agent
    .put("/api/admin/settings")
    .set("X-CSRF-Token", token)
    .send({ duration_minutes: 0, buffer_minutes: -1 })
    .expect(400);
  await agent
    .put("/api/admin/availability/2030-06-11")
    .set("X-CSRF-Token", token)
    .send({ start_time: "17:00", end_time: "09:00" })
    .expect(400);
});
test("confirmation atomically reserves a slot and creates one reminder", async () => {
  const id = await book();
  await login();
  await status(id).expect(200);
  await status(id).expect(200);
  const jobs = db
    .prepare("SELECT * FROM email_jobs WHERE kind='reminder'")
    .all();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].due_at, Date.parse(input().starts_at) - 86400000);
  await request(app).post("/api/appointments").send(input()).expect(409);
});
test("simultaneous pending requests allowed, only one can be confirmed", async () => {
  const ids = await Promise.all([book(), book()]);
  await login();
  const results = await Promise.all(ids.map((id) => status(id)));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM appointments WHERE status='confirmed'")
      .get().n,
    1,
  );
});
test("revalidates pending request against availability at confirmation", async () => {
  const id = await book();
  await login();
  db.prepare("UPDATE availability SET blocked=1").run();
  await status(id).expect(409);
  assert.equal(
    db.prepare("SELECT status FROM appointments WHERE id=?").get(id).status,
    "pending",
  );
});
test("buffer prevents overlapping adjacent appointments", async () => {
  const id = await book();
  await login();
  await status(id).expect(200);
  const slots = available(db, "2030-06-10", "event", clock);
  assert.ok(
    slots.every(
      (s) =>
        Date.parse(s.starts_at) >= Date.parse(input().starts_at) + 105 * 60000,
    ),
  );
});
test("confirmed bookings keep original duration and buffer after settings edits", async () => {
  const id = await book();
  await login();
  await status(id).expect(200);
  await agent
    .put("/api/admin/settings")
    .set("X-CSRF-Token", token)
    .send({ duration_minutes: 30, buffer_minutes: 0 })
    .expect(200);
  const a = db.prepare("SELECT * FROM appointments WHERE id=?").get(id);
  assert.equal(a.buffer_minutes, 15);
  assert.equal(a.ends_at - a.starts_at, 5400000);
  assert.ok(
    available(db, a.date, a.service, clock).every(
      (s) => Date.parse(s.starts_at) >= a.ends_at + 15 * 60000,
    ),
  );
});
test("cancellation releases slot, cancels reminder, and cannot reopen", async () => {
  const id = await book();
  await login();
  await status(id).expect(200);
  await status(id, "cancelled").expect(200);
  const reminder = db
    .prepare("SELECT * FROM email_jobs WHERE kind='reminder'")
    .get();
  assert.equal(reminder.state, "cancelled");
  await status(id).expect(409);
  await status(id, "pending").expect(400);
  assert.ok(
    available(db, "2030-06-10", "event", clock).some(
      (s) => s.starts_at === input().starts_at,
    ),
  );
});
test("admin filters, details and ID errors", async () => {
  const id = await book();
  await login();
  await agent.get("/api/appointments/" + id).expect(200);
  await agent.get("/api/appointments/999").expect(404);
  await agent.get("/api/appointments/abc").expect(400);
  const r = await agent
    .get("/api/appointments?status=pending&upcoming=1")
    .expect(200);
  assert.equal(r.body.count, 1);
  await agent.get("/api/appointments?status=bad").expect(400);
});
test("DST gaps and ambiguous times rejected; winter and summer offsets correct", () => {
  assert.throws(() => localInstant("2030-03-10", "02:30"));
  assert.throws(() => localInstant("2030-11-03", "01:30"));
  assert.equal(
    new Date(localInstant("2030-01-10", "09:00")).toISOString(),
    "2030-01-10T14:00:00.000Z",
  );
  assert.equal(
    new Date(localInstant("2030-06-10", "09:00")).toISOString(),
    "2030-06-10T13:00:00.000Z",
  );
});
test("legacy pending records remain date-only until explicitly assigned", async () => {
  const r = db
    .prepare(
      "INSERT INTO appointments(name,email,date,service) VALUES(?,?,?,?)",
    )
    .run("Legacy Test", "legacy@example.invalid", "2030-06-10", "event");
  await login();
  await status(r.lastInsertRowid).expect(400);
  assert.equal(
    db
      .prepare("SELECT starts_at FROM appointments WHERE id=?")
      .get(r.lastInsertRowid).starts_at,
    null,
  );
  await status(r.lastInsertRowid, "confirmed", {
    starts_at: input().starts_at,
  }).expect(200);
});
test("legacy confirmed records block date and never get inferred reminders", () => {
  db.prepare(
    "INSERT INTO appointments(name,email,date,service,status) VALUES(?,?,?,?,'confirmed')",
  ).run("Legacy Test", "legacy@example.invalid", "2030-06-10", "event");
  assert.deepEqual(available(db, "2030-06-10", "event", clock), []);
  assert.equal(db.prepare("SELECT count(*) n FROM email_jobs").get().n, 0);
});
test("migration preserves synthetic legacy data and is repeatable", () => {
  const filename = path.join(tmp, "legacy.db");
  const old = new Database(filename);
  old.exec(
    "CREATE TABLE appointments(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL,date TEXT NOT NULL,service TEXT NOT NULL,message TEXT,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  old
    .prepare(
      "INSERT INTO appointments(name,email,date,service) VALUES(?,?,?,?)",
    )
    .run("Synthetic", "test@example.invalid", "2030-06-10", "event");
  const before = old.prepare("SELECT * FROM appointments").get();
  old.close();
  for (let i = 0; i < 2; i++) {
    const migrated = openDatabase(filename);
    const after = migrated.prepare("SELECT * FROM appointments").get();
    for (const key of Object.keys(before))
      assert.equal(after[key], before[key]);
    assert.equal(after.starts_at, null);
    assert.equal(
      migrated.prepare("SELECT count(*) n FROM schema_migrations").get().n,
      1,
    );
    migrated.close();
  }
});
test("foreign keys preserve job integrity", () => {
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO email_jobs(appointment_id,kind,revision,due_at) VALUES(999,'reminder',0,0)",
      )
      .run(),
  );
});
test("worker sends due received and artist emails, no duplicate on repeated run", async () => {
  await book();
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.length, 2);
  assert.equal(
    db.prepare("SELECT count(*) n FROM email_jobs WHERE state='sent'").get().n,
    2,
  );
});
test("reminder becomes due exactly 24 hours before appointment", async () => {
  const id = await book();
  await login();
  await status(id).expect(200);
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.filter((a) => a[0] === "reminder").length, 0);
  clock = Date.parse(input().starts_at) - 86400000;
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.filter((a) => a[0] === "reminder").length, 1);
});
test("failed delivery retries with exponential backoff, exhausts at five attempts", async () => {
  await book();
  db.prepare("DELETE FROM email_jobs WHERE kind='artist'").run();
  const send = async () => {
    throw Object.assign(new Error("private provider body"), { code: 503 });
  };
  for (let i = 1; i <= 5; i++) {
    const before = clock;
    await processJobs(db, send, () => clock);
    const job = db.prepare("SELECT * FROM email_jobs").get();
    assert.equal(job.attempts, i);
    assert.equal(job.state, i === 5 ? "failed" : "queued");
    assert.equal(job.due_at, before + 60000 * 2 ** (i - 1));
    assert.equal(job.last_error, "HTTP_503");
    clock = job.due_at;
  }
  await processJobs(db, send, () => clock);
  assert.equal(db.prepare("SELECT attempts FROM email_jobs").get().attempts, 5);
});
test("permanent SendGrid error fails immediately and is redacted", async () => {
  await book();
  await processJobs(
    db,
    async () => {
      throw Object.assign(new Error("secret"), { code: 401 });
    },
    () => clock,
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM email_jobs WHERE state='failed' AND attempts=1",
      )
      .get().n,
    2,
  );
});
test("worker recovers expired lease after restart", async () => {
  await book();
  db.prepare(
    "UPDATE email_jobs SET state='processing',attempts=1,lease_until=?,token='old'",
  ).run(clock - 1);
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.length, 2);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM email_jobs WHERE state='sent' AND attempts=2",
      )
      .get().n,
    2,
  );
});
test("overlapping workers cannot claim the same job", async () => {
  await book();
  const second = openDatabase(path.join(tmp, "test.db"));
  try {
    await Promise.all([
      processJobs(
        db,
        async (...a) => {
          sent.push(a);
          await new Promise((r) => setTimeout(r, 5));
        },
        () => clock,
      ),
      processJobs(
        second,
        async (...a) => sent.push(a),
        () => clock,
      ),
    ]);
    assert.equal(sent.length, 2);
    assert.equal(new Set(sent.map((a) => a[2])).size, 2);
  } finally {
    second.close();
  }
});
test("cancelled and past appointments never send reminders", async () => {
  const id = await book();
  await login();
  await status(id).expect(200);
  clock = Date.parse(input().starts_at) + 1;
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.filter((a) => a[0] === "reminder").length, 0);
  assert.equal(
    db.prepare("SELECT state FROM email_jobs WHERE kind='reminder'").get()
      .state,
    "cancelled",
  );
});
test("job uniqueness enforced by database", async () => {
  const id = await book();
  const a = db.prepare("SELECT * FROM appointments WHERE id=?").get(id);
  enqueue(db, a, "received", clock);
  assert.equal(
    db.prepare("SELECT count(*) n FROM email_jobs WHERE kind='received'").get()
      .n,
    1,
  );
});
test("worker endpoint requires bearer secret and executes queue", async () => {
  await book();
  await request(app).post("/api/internal/jobs/run").expect(401);
  await request(app)
    .post("/api/internal/jobs/run")
    .set("Authorization", "Bearer " + config.WORKER_SECRET)
    .expect(200);
  assert.equal(sent.length, 2);
  await login();
  const r = await agent.get("/api/admin/jobs").expect(200);
  assert.equal(r.body.worker.last_run, clock);
});
test("email templates escape customer HTML in all variants", () => {
  for (const kind of [
    "received",
    "confirmed",
    "cancelled",
    "reminder",
    "artist",
  ]) {
    const t = template(kind, {
      ...input(),
      name: "<img src=x onerror=bad>",
      message: "<script>bad</script>",
      starts_at: Date.parse(input().starts_at),
    });
    assert.ok(!t.html.includes("<script>"));
    assert.ok(t.html.includes("&lt;img"));
    assert.ok(t.html.includes("&lt;script&gt;"));
    assert.ok(t.text.includes("<script>"));
  }
});
test("SendGrid adapter uses documented payload and handles failed requests", async () => {
  const a = { ...input(), starts_at: Date.parse(input().starts_at) };
  const options = {
    config: {
      SENDGRID_API_KEY: "test-only",
      FROM_EMAIL: "sender@example.invalid",
    },
    request: async (url, opts) => {
      assert.equal(url, "https://api.sendgrid.com/v3/mail/send");
      const b = JSON.parse(opts.body);
      assert.equal(b.personalizations[0].to[0].email, a.email);
      assert.equal(b.custom_args.job_key, "job");
      assert.equal(b.content.length, 2);
      return { status: 202 };
    },
  };
  await deliver("received", a, "job", options);
  await assert.rejects(
    deliver("received", a, "job", {
      ...options,
      request: async () => ({ status: 429 }),
    }),
    (e) => e.code === 429,
  );
  await assert.rejects(
    deliver("received", a, "job", {
      ...options,
      request: async () => {
        throw new Error("network down");
      },
    }),
  );
});
test("health endpoint probes database and unknown API returns JSON", async () => {
  await request(app).get("/api/health").expect(200);
  const r = await request(app).get("/api/unknown").expect(404);
  assert.equal(r.body.success, false);
});

test("simultaneous confirmations from independent server threads use SQLite locking", async () => {
  const { Worker } = require("node:worker_threads");
  const ids = await Promise.all([book(), book()]);
  const source = `const {parentPort,workerData}=require('node:worker_threads');const {openDatabase}=require(workerData.databaseModule);const {createApp}=require(workerData.appModule);const db=openDatabase(workerData.file);const server=createApp({db,config:workerData.config,now:()=>workerData.clock,send:async()=>{}}).listen(0,'127.0.0.1',()=>parentPort.postMessage(server.address().port));`;
  const workers = [];
  try {
    const clients = await Promise.all(
      [0, 1].map(async () => {
        const worker = new Worker(source, {
          eval: true,
          workerData: {
            file: path.join(tmp, "test.db"),
            databaseModule: require.resolve("../db/database"),
            appModule: require.resolve("../lib/app"),
            config,
            clock,
          },
        });
        workers.push(worker);
        const port = await new Promise((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        });
        const client = request.agent(`http://127.0.0.1:${port}`);
        const s = await client.get("/api/auth/session");
        const result = await client
          .post("/api/auth/login")
          .set("X-CSRF-Token", s.body.csrfToken)
          .send({ username: "artist", password: "a-test-password-123" })
          .expect(200);
        return { client, csrf: result.body.csrfToken };
      }),
    );
    const results = await Promise.all(
      clients.map(({ client, csrf }, i) =>
        client
          .patch(`/api/appointments/${ids[i]}/status`)
          .set("X-CSRF-Token", csrf)
          .send({ status: "confirmed" }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      db
        .prepare("SELECT count(*) n FROM appointments WHERE status='confirmed'")
        .get().n,
      1,
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
});
test("database restart preserves outbox and processing resumes", async () => {
  await book();
  db.close();
  db = openDatabase(path.join(tmp, "test.db"));
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.length, 2);
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.length, 2);
});
test("cancellation stops a queued reminder even after its original due time", async () => {
  const id = await book();
  await login();
  await status(id).expect(200);
  await status(id, "cancelled").expect(200);
  clock = Date.parse(input().starts_at) - 3600000;
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.filter((a) => a[0] === "reminder").length, 0);
  assert.equal(sent.filter((a) => a[0] === "cancelled").length, 1);
});
test("SQLite online backup can be restored with integrity and original records", async () => {
  await book();
  const backup = path.join(tmp, "snapshot.db");
  await db.backup(backup);
  const restored = openDatabase(backup);
  try {
    assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(
      restored.prepare("SELECT count(*) n FROM appointments").get().n,
      1,
    );
    assert.equal(
      restored.prepare("SELECT count(*) n FROM email_jobs").get().n,
      2,
    );
  } finally {
    restored.close();
  }
});
test("short-notice confirmation queues an immediate reminder", async () => {
  const id = await book();
  clock = Date.parse(input().starts_at) - 3600000;
  await login();
  await status(id).expect(200);
  const job = db
    .prepare("SELECT * FROM email_jobs WHERE kind='reminder'")
    .get();
  assert.equal(job.due_at, clock);
  await processJobs(
    db,
    async (...a) => sent.push(a),
    () => clock,
  );
  assert.equal(sent.filter((a) => a[0] === "reminder").length, 1);
});
