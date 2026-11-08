const { DateTime } = require("luxon");
const { ZONE } = require("../lib/scheduling");
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const titles = {
  received: "Booking Request Received",
  artist: "New Booking Request",
  confirmed: "Appointment Confirmed",
  cancelled: "Appointment Cancelled",
  reminder: "Your Appointment Is Tomorrow",
};
function template(kind, a) {
  const when =
    a.starts_at == null
      ? `${a.date} (time to be arranged)`
      : DateTime.fromMillis(a.starts_at, { zone: ZONE }).toFormat(
          "cccc, LLLL d, yyyy · h:mm a ZZZZ",
        );
  const copy =
    kind === "received"
      ? "Your request is pending review. Yihan will follow up within 24 hours."
      : kind === "cancelled"
        ? "Your appointment has been cancelled. Please contact Yihan to arrange another date."
        : kind === "artist"
          ? "A new request is ready for review in your admin dashboard."
          : "We look forward to making your day beautiful!";
  const text = `${titles[kind]}\nHi ${a.name},\nService: ${a.service}\nDate: ${when}\n${a.message || ""}\n${copy}\n— Yihan · OrlandoYHMakeup`;
  return {
    subject: `${titles[kind]} — Yihan Makeup`,
    text,
    html: `<div style="background:#faf6f3;padding:32px;color:#2b2b2b;font-family:Georgia,serif"><div style="max-width:560px;margin:auto;background:white;border-radius:16px;overflow:hidden"><header style="background:#c8a898;padding:24px;color:white"><h1>Yihan Makeup</h1><p>Orlando · Bridal &amp; Event Makeup</p></header><main style="padding:28px"><h2>${escapeHtml(titles[kind])}</h2><p>Hi ${escapeHtml(a.name)},</p><p>${escapeHtml(a.service)}<br>${escapeHtml(when)}</p><p>${escapeHtml(a.message)}</p><p>${copy}</p><p>— Yihan · OrlandoYHMakeup</p></main></div></div>`,
  };
}
async function deliver(kind, appointment, key, options = {}) {
  const config = options.config || process.env;
  const request = options.request || fetch;
  if (!config.SENDGRID_API_KEY || !config.FROM_EMAIL)
    throw new Error("EMAIL_CONFIGURATION");
  const content = template(kind, appointment);
  const response = await request("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${config.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [
            {
              email:
                kind === "artist"
                  ? config.ARTIST_EMAIL || config.FROM_EMAIL
                  : appointment.email,
            },
          ],
        },
      ],
      from: {
        email: config.FROM_EMAIL,
        name: "Yihan Makeup · OrlandoYHMakeup",
      },
      subject: content.subject,
      content: [
        { type: "text/plain", value: content.text },
        { type: "text/html", value: content.html },
      ],
      custom_args: { job_key: key },
    }),
  });
  if (response.status !== 202)
    throw Object.assign(new Error("SENDGRID_REJECTED"), {
      code: response.status,
    });
}
module.exports = { deliver, template, escapeHtml };
