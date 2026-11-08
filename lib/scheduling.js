const { DateTime } = require("luxon");
const ZONE = "America/New_York";
const SERVICES = ["bridal-makeup", "bridal-trial", "event"];
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function validDate(date) {
  return (
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    DateTime.fromISO(date, { zone: ZONE }).isValid
  );
}
function localInstant(date, time) {
  if (
    !validDate(date) ||
    typeof time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    fail("Invalid local date or time.");
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: ZONE });
  // Reject spring-forward gaps and fall-back ambiguous wall times rather than guess.
  if (
    !dt.isValid ||
    dt.toFormat("HH:mm") !== time ||
    dt.getPossibleOffsets().length !== 1
  )
    fail("This time is invalid or ambiguous due to daylight saving time.");
  return dt.toMillis();
}
function settings(db) {
  return db.prepare("SELECT * FROM settings WHERE id=1").get();
}
function available(db, date, service, now = Date.now(), exclude = 0) {
  if (!validDate(date) || !SERVICES.includes(service))
    fail("Invalid date or service.");
  const window = db
    .prepare("SELECT * FROM availability WHERE date=?")
    .get(date);
  if (!window || window.blocked) return [];
  const config = settings(db);
  const slots = [];
  let start, end;
  try {
    start = localInstant(date, window.start_time);
    end = localInstant(date, window.end_time);
  } catch {
    return [];
  }
  // Untimed confirmed legacy records conservatively reserve the entire business date.
  if (
    db
      .prepare(
        "SELECT 1 FROM appointments WHERE date=? AND status='confirmed' AND starts_at IS NULL AND id<>?",
      )
      .get(date, exclude)
  )
    return [];
  const conflicts = db
    .prepare(
      "SELECT starts_at,ends_at,buffer_minutes FROM appointments WHERE status='confirmed' AND starts_at IS NOT NULL AND id<>?",
    )
    .all(exclude);
  for (
    let t = start;
    t + config.duration_minutes * 60000 <= end;
    t += (config.duration_minutes + config.buffer_minutes) * 60000
  ) {
    const finish = t + config.duration_minutes * 60000;
    if (t <= now) continue;
    if (
      conflicts.some(
        (a) =>
          t < a.ends_at + (a.buffer_minutes ?? config.buffer_minutes) * 60000 &&
          finish + config.buffer_minutes * 60000 > a.starts_at,
      )
    )
      continue;
    slots.push({
      starts_at: new Date(t).toISOString(),
      label: DateTime.fromMillis(t, { zone: ZONE }).toFormat("h:mm a ZZZZ"),
      ends_at: finish,
    });
  }
  return slots;
}
function requireSlot(db, date, service, startsAt, now, exclude = 0) {
  if (typeof startsAt !== "string") fail("Choose an available time slot.");
  const slot = available(db, date, service, now, exclude).find(
    (s) => s.starts_at === startsAt,
  );
  if (!slot)
    fail("This slot is no longer available. Please choose another.", 409);
  return {
    starts_at: Date.parse(slot.starts_at),
    ends_at: slot.ends_at,
    buffer_minutes: settings(db).buffer_minutes,
  };
}
module.exports = {
  ZONE,
  SERVICES,
  validDate,
  localInstant,
  available,
  requireSlot,
  settings,
  fail,
};
