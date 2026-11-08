const crypto = require("node:crypto");
function enqueue(db, a, kind, due) {
  db.prepare(
    "INSERT OR IGNORE INTO email_jobs(appointment_id,kind,revision,due_at) VALUES(?,?,?,?)",
  ).run(a.id, kind, a.revision, due);
}
function cancelJobs(db, id) {
  db.prepare(
    "UPDATE email_jobs SET state='cancelled',token=NULL WHERE appointment_id=? AND kind IN ('confirmed','reminder') AND state IN ('queued','processing')",
  ).run(id);
}
async function processJobs(db, send, now = Date.now) {
  const time = now();
  db.prepare("INSERT OR REPLACE INTO worker_state VALUES(1,?)").run(time);
  db.prepare(
    "UPDATE email_jobs SET state='failed',last_error='LEASE_EXHAUSTED' WHERE state='processing' AND lease_until<=? AND attempts>=5",
  ).run(time);
  // Expire old reminders; do not send a reminder after the appointment begins.
  db.prepare(
    "UPDATE email_jobs SET state='cancelled',token=NULL WHERE kind='reminder' AND state IN ('queued','processing') AND appointment_id IN (SELECT id FROM appointments WHERE status<>'confirmed' OR starts_at<=? OR starts_at IS NULL)",
  ).run(time);
  const deadline = Date.now() + 30000;
  for (let n = 0; n < 50 && Date.now() < deadline; n++) {
    const job = db
      .transaction(() => {
        const row = db
          .prepare(
            "SELECT * FROM email_jobs WHERE (state='queued' AND due_at<=?) OR (state='processing' AND lease_until<=? AND attempts<5) ORDER BY due_at,id LIMIT 1",
          )
          .get(now(), now());
        if (!row) return null;
        const token = crypto.randomUUID();
        db.prepare(
          "UPDATE email_jobs SET state='processing', attempts=attempts+1, lease_until=?,token=? WHERE id=?",
        ).run(now() + 120000, token, row.id);
        return { ...row, attempts: row.attempts + 1, token };
      })
      .immediate();
    if (!job) break;
    const a = db
      .prepare("SELECT * FROM appointments WHERE id=?")
      .get(job.appointment_id);
    if (
      !a ||
      (job.kind === "reminder" &&
        (a.status !== "confirmed" ||
          a.revision !== job.revision ||
          a.starts_at <= now()))
    ) {
      db.prepare(
        "UPDATE email_jobs SET state='cancelled',token=NULL WHERE id=? AND token=?",
      ).run(job.id, job.token);
      continue;
    }
    try {
      await send(
        job.kind,
        a,
        `${job.appointment_id}:${job.kind}:${job.revision}`,
      );
      db.prepare(
        "UPDATE email_jobs SET state='sent',sent_at=?,lease_until=NULL,token=NULL WHERE id=? AND token=? AND state='processing'",
      ).run(now(), job.id, job.token);
      console.info(JSON.stringify({ event: "email_sent", job_id: job.id }));
    } catch (err) {
      const code = Number(err.code) || 0;
      const permanent = code >= 400 && code < 500 && code !== 429;
      db.prepare(
        "UPDATE email_jobs SET state=?,due_at=?,last_error=?,lease_until=NULL,token=NULL WHERE id=? AND token=? AND state='processing'",
      ).run(
        permanent || job.attempts >= 5 ? "failed" : "queued",
        now() + 60000 * 2 ** (job.attempts - 1),
        code ? `HTTP_${code}` : "DELIVERY_FAILED",
        job.id,
        job.token,
      );
      console.error(
        JSON.stringify({
          event: "email_failed",
          job_id: job.id,
          attempt: job.attempts,
        }),
      );
    }
  }
}
module.exports = { enqueue, cancelJobs, processJobs };
