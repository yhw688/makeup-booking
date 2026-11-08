// Runs on a scheduler. It accesses the web service, never a separate SQLite copy.
const url = process.env.APP_ORIGIN;
if (!url?.startsWith("https://") || !process.env.WORKER_SECRET)
  throw new Error("Set HTTPS APP_ORIGIN and WORKER_SECRET.");
fetch(`${url}/api/internal/jobs/run`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.WORKER_SECRET}` },
  signal: AbortSignal.timeout(55000),
})
  .then((r) => {
    if (!r.ok) throw new Error("Worker request failed.");
    console.info("Job processing completed.");
  })
  .catch(() => {
    console.error("Worker request failed; inspect the service job dashboard.");
    process.exitCode = 1;
  });
