# OrlandoYHMakeup — Appointment studio

Existing HTML/CSS/vanilla JavaScript branding with Express, better-sqlite3 and SendGrid. One administrator manages booking requests, time windows, confirmations and cancellations at `/admin.html`. Customers continue using the original public website.

## Architecture

- `server.js`: environment loading, database connection, HTTP startup and graceful shutdown.
- `lib/app.js`: HTTP security, authentication and validated public/admin APIs. Factory accepts an isolated database, clock and mail transport for tests.
- `db/database.js`: transactional, versioned additive migration; WAL, foreign keys and a 5-second busy timeout.
- `lib/scheduling.js`: New York timezone conversion, slot generation and interval validation.
- `lib/session-store.js`: persistent SQLite sessions; no browser token storage.
- `lib/jobs.js`: durable email outbox, transaction-based claims, leases and retry state.
- `utils/mailer.js`: escaped branded HTML/plain-text templates and SendGrid v3 HTTP transport with a 10-second timeout.
- `worker.js`: standalone processor for a **shared filesystem**. `scripts/trigger-jobs.js`: Render scheduler invoking the web service's protected processor.
- `public/booking.js`, `public/admin.*`: customer slot selection and responsive administration.

SQLite is for one small-business web instance on a persistent local disk. Horizontal scaling and independently hosted database workers need a shared database architecture such as Postgres; do not give each instance a separate SQLite copy.

## Local setup and administrator credentials

Use Node 22 or 24. Node 24 is the deployment reference.

```sh
npm ci
cp .env.example .env
```

Edit `.env`. Use a **new local database**, never a production database or a database copied from repository history. Ignored database files already on disk are retained; a nonempty legacy database is migrated on first startup. The original repository included customer database files: see the data exposure section before handling them.

Generate `SESSION_SECRET` and a separate `WORKER_SECRET` using `openssl rand -hex 32`. Generate a bcrypt password hash (cost 12) using stdin, so the password stays out of arguments and shell history:

```sh
read -s -r password
printf '%s' "$password" | node scripts/hash-password.js
unset password
```

Use a unique password of 12–72 UTF-8 bytes. Put the result in `ADMIN_PASSWORD_HASH` **inside single quotes** in `.env` (bcrypt contains `$`). Put your username in `ADMIN_USERNAME`. Invalid authentication configuration prevents startup. Rotation of `SESSION_SECRET` invalidates every session; do this when changing administrator access. Restart after environment changes.

```sh
npm run dev
# Separate terminal, with the same DB_PATH:
npm run worker
```

Visit `http://localhost:3000/admin.html`, log in and add dated availability. No availability is open by default. Configure SendGrid with a verified sender and a least-privilege Mail Send API key. Local booking saves even without email credentials; delivery attempts fail visibly in the job dashboard. Never use real customer addresses in development.

## Environment

| Variable              | Purpose                                                                   |
| --------------------- | ------------------------------------------------------------------------- |
| `NODE_ENV`            | `development` locally, `production` on Render                             |
| `PORT`                | HTTP port, defaults to 3000; Render supplies it                           |
| `APP_ORIGIN`          | Exact public origin, no trailing slash; HTTPS required in production      |
| `DB_PATH`             | SQLite filename; use `/var/data/bookings.db` on a mounted Render disk     |
| `ADMIN_USERNAME`      | Single administrator login                                                |
| `ADMIN_PASSWORD_HASH` | bcrypt hash, never a plaintext password                                   |
| `SESSION_SECRET`      | Random secret, at least 32 characters                                     |
| `WORKER_SECRET`       | Separate random secret, at least 32 characters; identical on web and cron |
| `SENDGRID_API_KEY`    | SendGrid Mail Send key                                                    |
| `FROM_EMAIL`          | Verified sender                                                           |
| `ARTIST_EMAIL`        | Internal notification recipient; defaults to sender                       |
| `TRUST_PROXY`         | `1` only behind the trusted Render proxy, `0` locally                     |

Production requires authentication, HTTPS origin, DB path, worker secret and email configuration. There are no embedded production credentials. `.env.example` contains placeholders only.

## Authentication and security

1. `GET /api/auth/session` creates a CSRF token in the server session and returns `{authenticated, csrfToken}`.
2. `POST /api/auth/login` takes `{username,password}` and the `X-CSRF-Token` header. Successful login rotates the session ID and token.
3. Send the returned CSRF token with every cookie-authenticated state-changing request, including logout.
4. `POST /api/auth/logout` destroys the SQLite session and clears the cookie.

Sessions expire absolutely after eight hours. Cookies are HttpOnly, SameSite Strict, and Secure in production; local HTTP development needs Secure disabled. No JWT or credential is stored in localStorage. Session payloads contain no password. Login is limited to 10 requests per 15 minutes per IP; booking to 10 per hour; availability to 120 per minute. Limits are per process and reset on restart, suitable for the single-instance deployment. TLS/proxy IP handling must be configured correctly.

All admin APIs require authentication. CSRF is required for admin writes. Exact-origin checks reject cross-origin writes; CORS credential sharing is disabled. Requests are JSON with a 16 KB limit. Names, email addresses, IDs, services, dates, times and notes are validated; SQL parameters are bound. Logs omit request bodies, customer data, session IDs and provider response bodies. Public responses contain only the submitted booking's ID, status and time.

Helmet applies security headers. CSP preserves the existing inline public page scripts/styles and Google Fonts. The new admin scripts use external files and textContent. A future nonce-based CSP can tighten the public page without changing its design. Avoid inserting unescaped HTML into the public page.

## API

All JSON responses include `success` except health. Failure responses include a safe `message`. Common errors: 400 invalid input, 401 login required, 403 CSRF/origin failure, 404 missing resource, 409 unavailable slot/invalid transition, 413 oversized request, 429 rate limited. Timestamps for appointment details/jobs are UTC epoch milliseconds; public slot timestamps are ISO UTC strings.

| Method | Path                                              | Access and behavior                                                       |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------- |
| GET    | `/api/health`                                     | Public database readiness, no customer details                            |
| GET    | `/api/auth/session`                               | Public session and CSRF bootstrap                                         |
| POST   | `/api/auth/login`                                 | Public + CSRF, rate limited                                               |
| POST   | `/api/auth/logout`                                | Admin + CSRF                                                              |
| GET    | `/api/availability?date=YYYY-MM-DD&service=event` | Public available slots and timezone                                       |
| POST   | `/api/appointments`                               | Public validated booking request                                          |
| GET    | `/api/appointments`                               | Admin list; optional `status=pending\|confirmed\|cancelled`, `upcoming=1` |
| GET    | `/api/appointments/:id`                           | Admin details                                                             |
| PATCH  | `/api/appointments/:id/status`                    | Admin + CSRF; `{status:"confirmed"}` or `{status:"cancelled"}`            |
| GET    | `/api/admin/availability`                         | Admin windows and settings                                                |
| PUT    | `/api/admin/availability/:date`                   | Admin + CSRF; `{start_time:"09:00",end_time:"17:00",blocked:false}`       |
| PUT    | `/api/admin/settings`                             | Admin + CSRF; `{duration_minutes:90,buffer_minutes:15}`                   |
| GET    | `/api/admin/jobs`                                 | Admin latest 200 delivery states and worker heartbeat                     |
| POST   | `/api/internal/jobs/run`                          | `Authorization: Bearer WORKER_SECRET`, no admin cookie required           |

Booking body:

```json
{
  "name": "Example Client",
  "email": "client@example.invalid",
  "date": "2030-06-10",
  "service": "event",
  "starts_at": "2030-06-10T13:00:00.000Z",
  "message": "Optional notes"
}
```

Obtain `starts_at` from availability; the example is not a guaranteed slot. Services retain their original IDs: `bridal-makeup`, `bridal-trial`, `event`. **Intentional API changes:** old date-only POSTs now require `starts_at`; administrative endpoints require authentication; transitions back to pending are rejected. The existing public form is updated in the same change.

## Scheduling rules and legacy records

Business timezone is **America/New_York**, regardless of server timezone. Admin windows use local dates and wall times; API booking choices use explicit ISO UTC instants. Luxon rejects nonexistent spring-forward times and ambiguous fall-back times. Appointments and buffers use elapsed minutes, even across DST transitions. One same-day window per date is supported; overnight windows and recurring weekly rules are not supported.

Duration is 15–480 minutes (default 90); buffer 0–120 minutes (default 15). The last appointment must finish within the configured window. Buffer can extend beyond closing. Slots start at opening and advance by duration + buffer. All services currently share these settings. Past starts are rejected. Changing settings or blocking a date does not move/cancel existing confirmed appointments; pending requests are revalidated at confirmation using current settings.

Pending requests **do not reserve slots**. Multiple customers may request the same time; only one overlapping request can be confirmed. Submission, confirmation and email-job creation run inside `BEGIN IMMEDIATE` transactions. Confirmation checks current availability and every confirmed interval, including saved buffers, excluding itself. A conflict rolls back all changes with 409. Cancellation releases the reservation. Allowed transitions are pending → confirmed/cancelled and confirmed → cancelled; repeat identical status is idempotent. Cancelled appointments cannot reopen.

Legacy `date` values retain their exact meaning and remain untouched. Old records gain **NULL** `starts_at`, `ends_at` and `buffer_minutes`; no midnight conversion or inferred time is performed. Legacy pending records can be assigned a returned slot explicitly in the admin detail view before confirmation. Legacy confirmed date-only records conservatively block their entire date and receive no timed reminder. Contact the customer and agree on a time before cancelling/replacing such a confirmed record; automatic time assignment is intentionally unavailable.

## Schema and migration

Migration 1 runs atomically on startup and records its version in `schema_migrations`. It creates a new database when needed, or adds columns to the existing appointments table, preserving IDs, statuses, date, creation timestamps, and every original field. A failed transaction rolls back. It does not delete rows, rewrite history, or open/migrate files during builds.

- `appointments`: original fields plus nullable UTC-millisecond start/end, buffer snapshot, and integer revision.
- `availability`: dated local window and blocked flag.
- `settings`: single duration/buffer configuration.
- `sessions`: server session JSON and expiry milliseconds.
- `email_jobs`: appointment FK, kind, revision, due time, state, attempts, lease ownership token, safe error code and sent time. `(appointment_id,kind,revision)` is unique.
- `worker_state`: latest processor heartbeat.

Existing `created_at` strings remain in their original SQLite UTC format; new scheduling/job/session timestamps are UTC milliseconds. There is no destructive down migration. Before a production upgrade, take and verify a consistent backup and rehearse the migration on a securely held copy outside this repository. Tests use synthetic legacy fixtures, never real customer data.

## Durable email processing

Request submission enqueues a customer receipt and artist alert atomically. Confirmation enqueues confirmation and a reminder due at `starts_at - 24h`. A confirmation less than 24 hours before start schedules an immediate reminder. Cancellation cancels unsent reminders/obsolete confirmations and enqueues a cancellation email. All templates escape user content and include plain text.

A processor claims each due job inside an immediate transaction, records a unique claim token and a two-minute lease, then calls SendGrid outside the transaction. It records success only if it still owns that claim. A restart recovers expired leases. Temporary failures, network errors and 429 responses retry after 1, 2, 4, 8 and 16 minutes, with at most five delivery attempts. Other 4xx errors fail immediately. Exhausted jobs remain visible for operator investigation. Each run processes up to 50 jobs with a 30-second admission budget (an in-flight send can add up to 10 seconds).

Confirmed appointment revisions plus unique job keys prevent duplicate scheduling. Repeated normal worker execution does not resend completed jobs; overlapping workers cannot claim the same unexpired job. **SendGrid has no transactional exactly-once delivery with SQLite**: a crash after provider acceptance but before marking sent can cause a duplicate on lease recovery. `custom_args.job_key` aids investigation; it is not a provider idempotency guarantee. Cancellation cannot recall an already in-flight send. `sent` means accepted (202), not inbox delivery. Webhook bounce tracking is outside this change.

After downtime, overdue reminders run when processing resumes, unless the appointment has already begun (then cancelled). Exact 24-hour delivery depends on uptime, scheduler frequency, provider availability and backlog. Monitor `/api/admin/jobs`, heartbeat freshness, failures, and scheduler exit status. For a terminal failed job, resolve configuration/provider errors and reconcile provider activity before an operator-approved manual retry; no automatic endless retry is performed.

## Render deployment (manual; nothing is deployed by this change)

Reference configuration is `render.yaml`, with automatic deployments disabled. It uses new review service names so importing it does not silently reconfigure the existing production service. Review values and costs before applying. Do not import a second empty service and assume it contains existing bookings.

1. Freeze booking writes during the cutover. Back up the **live** database, verify integrity, and secure the backup off-service. Capture the current running revision and environment securely. Repository database files are not a source of truth.
2. Use a paid, always-on web service with a persistent disk mounted at `/var/data`. The free sleeping/ephemeral filesystem configuration cannot provide durable SQLite or timely reminders. Do not scale horizontally.
3. Transfer a verified SQLite backup to `/var/data/bookings.db` using secure operator access, with correct ownership. Keep the old database untouched until validation. Setting a new empty DB_PATH without moving the data would hide existing appointments.
4. Set the variables above; use the exact public HTTPS origin, `TRUST_PROXY=1` behind Render, and a verified sender. Keep production auto-deploy off. Build `npm ci --omit=dev`, start `npm start`, health check `/api/health`.
5. Startup applies the additive migration on the mounted disk. Do not run migration in a pre-deploy job with a different ephemeral filesystem. Verify record counts privately, health, admin login, legacy dates and availability before reopening booking writes.
6. Configure a Render cron service to run `node scripts/trigger-jobs.js` every minute (`* * * * *`), with the web service's `APP_ORIGIN` and the same `WORKER_SECRET`. Its HTTP request invokes processing where the SQLite disk is mounted. Do **not** run `worker.js` against a cron-local database.
7. Exercise email and cancellation with an operator-owned test address before relying on reminders. Alert on failed cron runs, no heartbeat for several minutes, pending backlog and failed jobs. Keep both services' automatic deployment disabled.

Render persistent disks belong to one service; cron jobs cannot mount/access them. A separate Render background worker cannot share the web service disk. That is why the scheduled trigger uses authenticated HTTPS. Outside Render, `npm run worker` or `npm run worker:once` works only with the same local filesystem database. A standalone timer is not the production reliability mechanism.

Sources: [Render disks](https://render.com/docs/disks), [cron limitations](https://render.com/docs/cronjobs), [Blueprint configuration](https://render.com/docs/blueprint-spec), [SendGrid Mail Send API](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send).

## Backup, restore and rollback

Create a consistent SQLite online backup instead of copying only a live WAL-mode `.db` file:

```sh
DB_PATH=/var/data/bookings.db node scripts/backup.js /var/data/backups/booking-backup.db
```

Create the destination directory first; the script refuses to overwrite existing files. Store encrypted copies off the Render disk with restricted access and a retention policy. Check `PRAGMA integrity_check` on a backup and rehearse restore privately. Do not print rows or attach backups to issues/PRs. Backups contain customer data and active sessions; protect them accordingly.

Restore during maintenance with all web/worker processes stopped. Preserve the current database and matching `-wal`/`-shm` files as a secured rollback set. Place a verified standalone backup at a **new** path, update DB_PATH manually, and start the service. Never mix an old backup with current WAL/SHM files. Verify health and counts privately before resuming traffic. Rotating SESSION_SECRET revokes sessions in backups. Restoring an older backup loses later writes and may replay already sent emails; reconcile SendGrid activity/job state before restarting processors. Application rollback alone does not undo new confirmed reservations; prefer a forward fix or maintenance mode over running the old unsecured API against migrated data.

## Previously committed customer data and secrets

This branch removes `db/bookings.db`, `db/bookings.db-wal` and `db/bookings.db-shm` **from Git tracking only**. `git rm --cached` retains local files. `.gitignore` excludes SQLite files/sidecars and environment secrets. No customer rows were inspected, printed, migrated or committed during implementation. Production files/settings were not accessed or changed.

Existing public Git history, forks and caches can still contain the old files. Removing current tracking does not erase them. The current source credential-pattern scan is not proof that history or arbitrary credential formats are clean. Separately, the owner should restrict exposure, assess affected data with appropriate privacy advice, rotate any historically exposed credentials, revoke sessions as needed, and decide on customer notifications. If approved later, coordinate a history-cleaning operation and GitHub cached-object removal with collaborators. **No history rewrite is performed or authorized by this PR.** Never paste customer records into an issue or CI log.

## Validation and CI

```sh
npm ci
npm test
npx playwright install chromium
npm run test:e2e
npm run format:check
npm run security:check
npm audit --audit-level=low
```

Tests use temporary databases, synthetic records, fake clocks and mocked email calls. Browser tests use an in-memory database and disabled real transport. They exercise customer booking and administrator confirmation, cancellation, availability, logout and mobile layout. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chromium for local testing.

GitHub Actions runs on PRs and pushes to main, on Node 22 and 24. It installs the lockfile, checks formatting/current tracked secrets/data, audits dependencies, runs the backend tests and Chromium workflow. There is no deploy step. The lightweight credential scan checks common key formats and forbidden tracked files, not customer text or full historical secrets. Add organization-level secret scanning/history audit separately as needed.

## Remaining limits

One administrator, one availability window per date, one shared service duration, no self-service customer cancellation/rescheduling, no MFA/password recovery, no queue retry UI, no delivery webhook, and no distributed rate limiter. The admin list is appropriate for a small business, without pagination. Email transport and Render provisioning must be verified in the owner's environment; mocked tests cannot demonstrate live provider delivery. See the reminder section for crash-window duplicate and cancellation-in-flight limits.
