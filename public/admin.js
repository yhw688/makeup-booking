"use strict";
const $ = (id) => document.getElementById(id);
let csrfToken = "",
  selected = null;
function notice(s) {
  $("notice").textContent = s;
}
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && url !== "/api/auth/login") showLogin();
    throw new Error(data.message || "Request failed.");
  }
  return data;
}
function showLogin() {
  $("login-panel").hidden = false;
  $("dashboard").hidden = true;
  $("logout").hidden = true;
  $("appointments").replaceChildren();
  $("detail-content").textContent = "";
  $("details").hidden = true;
  selected = null;
}
function text(tag, value) {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
}
function when(a) {
  return a.starts_at === null
    ? `${a.date} · Date only; time not assigned`
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        dateStyle: "full",
        timeStyle: "short",
      }).format(new Date(a.starts_at)) + " Eastern";
}
async function refresh() {
  const query = new URLSearchParams();
  if ($("filter").value) query.set("status", $("filter").value);
  if ($("upcoming").checked) query.set("upcoming", "1");
  const [appointments, availability, jobs] = await Promise.all([
    api("/api/appointments?" + query),
    api("/api/admin/availability"),
    api("/api/admin/jobs"),
  ]);
  $("appointments").replaceChildren();
  for (const a of appointments.data) {
    const card = text("article", "");
    card.className = "appointment";
    const b = text("button", "View details");
    b.onclick = () => safe(() => details(a.id));
    card.append(
      text("h3", a.name),
      text("p", `${a.service} · ${a.status}`),
      text("p", when(a)),
      b,
    );
    $("appointments").append(card);
  }
  if (!appointments.data.length)
    $("appointments").append(text("p", "No appointments match."));
  for (const key of ["duration_minutes", "buffer_minutes"])
    $("settings").elements[key].value = availability.settings[key];
  $("windows").replaceChildren(
    ...availability.data.map((w) =>
      text(
        "p",
        `${w.date} · ${w.blocked ? "Blocked" : `${w.start_time}–${w.end_time}`}`,
      ),
    ),
  );
  $("jobs").replaceChildren(
    ...jobs.data.map((j) =>
      text(
        "p",
        `Job ${j.id} · Appointment ${j.appointment_id} · ${j.kind} · ${j.state} · ${j.attempts} attempts${j.last_error ? " · " + j.last_error : ""}`,
      ),
    ),
  );
  $("worker-status").textContent = jobs.worker
    ? `Last worker run: ${new Date(jobs.worker.last_run).toLocaleString()}`
    : "Worker has not run. Configure the scheduled trigger before relying on email delivery.";
}
async function details(id) {
  const { data: a } = await api(`/api/appointments/${id}`);
  selected = a;
  $("details").hidden = false;
  $("detail-content").textContent =
    `${a.name}\n${a.email}\n${a.service}\n${when(a)}\nStatus: ${a.status}\nNotes: ${a.message || "None"}`;
  $("confirm").disabled = a.status !== "pending";
  $("cancel").disabled = a.status === "cancelled";
  $("legacy-label").hidden = a.starts_at !== null || a.status !== "pending";
  if (a.starts_at === null && a.status === "pending") {
    const slots = await api(
      "/api/availability?" +
        new URLSearchParams({ date: a.date, service: a.service }),
    );
    $("legacy-slot").replaceChildren(
      new Option("Choose an available time", ""),
      ...slots.data.map((s) => new Option(s.label, s.starts_at)),
    );
  }
  $("details").scrollIntoView({ behavior: "smooth", block: "start" });
}
async function safe(fn) {
  try {
    await fn();
  } catch (e) {
    notice(e.message);
  }
}
$("login").onsubmit = (e) => {
  e.preventDefault();
  safe(async () => {
    const form = e.target;
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    });
    csrfToken = result.csrfToken;
    form.reset();
    await enter();
  });
};
async function enter() {
  $("login-panel").hidden = true;
  $("dashboard").hidden = false;
  $("logout").hidden = false;
  notice("");
  await refresh();
}
$("logout").onclick = () =>
  safe(async () => {
    await api("/api/auth/logout", { method: "POST" });
    csrfToken = "";
    showLogin();
    const s = await api("/api/auth/session");
    csrfToken = s.csrfToken;
  });
$("refresh").onclick = () => safe(refresh);
$("filter").onchange = () => safe(refresh);
$("upcoming").onchange = () => safe(refresh);
$("close-detail").onclick = () => {
  $("details").hidden = true;
  selected = null;
};
for (const status of ["confirmed", "cancelled"])
  $(status === "confirmed" ? "confirm" : "cancel").onclick = () =>
    safe(async () => {
      if (!selected) return;
      const body = { status };
      if (status === "confirmed" && selected.starts_at === null) {
        body.starts_at = $("legacy-slot").value;
        if (!body.starts_at)
          throw new Error("Choose an available time for this legacy request.");
      }
      if (
        status === "cancelled" &&
        !window.confirm(
          "Cancel this appointment? The customer will be notified.",
        )
      )
        return;
      await api(`/api/appointments/${selected.id}/status`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      notice("Appointment updated.");
      await details(selected.id);
      await refresh();
    });
$("settings").onsubmit = (e) => {
  e.preventDefault();
  safe(async () => {
    const f = e.target;
    await api("/api/admin/settings", {
      method: "PUT",
      body: JSON.stringify({
        duration_minutes: Number(f.elements.duration_minutes.value),
        buffer_minutes: Number(f.elements.buffer_minutes.value),
      }),
    });
    notice("Duration and buffer updated.");
    await refresh();
  });
};
$("availability").onsubmit = (e) => {
  e.preventDefault();
  safe(async () => {
    const f = e.target;
    await api("/api/admin/availability/" + f.elements.date.value, {
      method: "PUT",
      body: JSON.stringify({
        start_time: f.elements.start_time.value,
        end_time: f.elements.end_time.value,
        blocked: f.elements.blocked.checked,
      }),
    });
    notice(
      "Availability saved. Confirmed appointments retain their original times.",
    );
    await refresh();
  });
};
safe(async () => {
  const s = await api("/api/auth/session");
  csrfToken = s.csrfToken;
  if (s.authenticated) await enter();
  else showLogin();
});
