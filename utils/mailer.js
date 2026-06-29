// utils/mailer.js
// Sends booking confirmation emails via SendGrid.
//They don't make any decisions — they just wait to be told "send this email" and they do it.

/*
Customer fills form (index.html)
        ↓
fetch() inside index.html sends data to backend
        ↓
server.js receives it, routes to appointments.js
        ↓
appointments.js validates the data      get the request from frontendnpm 
        ↓
database.js saves it to bookings.json
        ↓
mailer.js sends 2 emails via SendGrid
        ↓
appointments.js sends success response    return the results to the frontned
        ↓
index.html shows green banner to customer */

const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const SERVICE_LABELS = {
  'bridal-makeup': 'Bridal Makeup ($699)',
  'bridal-trial':  'Bridal Trial Run ($699)',
  'event':         'Special Event Makeup + Hair ($599)',
};

/**
 * Send a confirmation email to the client.
 * @param {{ name, email, date, service, message }} appointment
 */
async function sendConfirmation(appointment) {
  const { name, email, date, service, message } = appointment;
  const serviceLabel = SERVICE_LABELS[service] || service;

  const msg = {
    to:   email,
    from: {
      email: process.env.FROM_EMAIL,
      name:  'Yihan Makeup · OrlandoYHMakeup',
    },
    subject: `✨ Booking Request Received — ${serviceLabel}`,
    // ── Plain-text fallback ───────────────────────────
    text: `
Hi ${name},

Thank you for reaching out! Your booking request has been received.

Service : ${serviceLabel}
Date    : ${date}
${message ? `Notes   : ${message}` : ''}

I'll follow up within 24 hours to confirm availability and discuss details.

Looking forward to making your day beautiful!
— Yihan
yihans.art@gmail.com
    `.trim(),

    // ── HTML version ─────────────────────────────────
    html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <style>
    body{margin:0;padding:0;background:#faf6f3;font-family:Georgia,serif;color:#2b2b2b}
    .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    .header{background:#c8a898;padding:32px 36px;color:#fff;text-align:center}
    .header h1{margin:0;font-size:26px;letter-spacing:.5px}
    .header p{margin:6px 0 0;font-size:13px;opacity:.85}
    .body{padding:32px 36px}
    .body h2{font-size:18px;margin:0 0 16px}
    .detail{background:#faf6f3;border-radius:10px;padding:16px 20px;margin-bottom:20px}
    .detail table{width:100%;border-collapse:collapse}
    .detail td{padding:6px 0;font-size:14px}
    .detail td:first-child{color:#6b6b6b;width:80px}
    .note{font-size:14px;color:#6b6b6b;line-height:1.7}
    .footer{text-align:center;padding:20px;font-size:12px;color:#a89080;border-top:1px solid #f0e8e3}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <h1>Yihan Makeup ✨</h1>
      <p>Orlando · Bridal &amp; Event Makeup</p>
    </div>
    <div class="body">
      <h2>Hi ${name}, your request is in! 🎉</h2>
      <div class="detail">
        <table>
          <tr><td>Service</td><td><strong>${serviceLabel}</strong></td></tr>
          <tr><td>Date</td><td><strong>${date}</strong></td></tr>
          ${message ? `<tr><td>Notes</td><td>${message}</td></tr>` : ''}
        </table>
      </div>
      <p class="note">
        I'll follow up within <strong>24 hours</strong> to confirm availability and chat about your vision.
        Feel free to reply to this email with any inspiration pictures — they're more than welcome!
      </p>
      <p class="note">A <strong>20% booking fee</strong> is required to hold your date and services.</p>
      <p class="note" style="margin-top:24px">Looking forward to making your special day even more beautiful 💕<br/><br/>— Yihan</p>
    </div>
    <div class="footer">yihans.art@gmail.com · OrlandoYHMakeup · Orlando, FL</div>
  </div>
</body>
</html>
    `.trim(),
  };

  await sgMail.send(msg);
}

/**
 * Send an internal alert to the artist when a new booking arrives.
 * @param {{ name, email, date, service, message }} appointment
 */
async function sendArtistAlert(appointment) {
  const { name, email, date, service, message } = appointment;
  const serviceLabel = SERVICE_LABELS[service] || service;

  const msg = {
    to:   process.env.FROM_EMAIL,
    from: {
      email: process.env.FROM_EMAIL,
      name:  'Booking System · OrlandoYHMakeup',
    },
    subject: `📅 New Booking Request from ${name}`,
    text: `
New booking request received:

Name    : ${name}
Email   : ${email}
Service : ${serviceLabel}
Date    : ${date}
Notes   : ${message || '(none)'}

Log in to review: http://localhost:${process.env.PORT || 3000}/api/appointments
    `.trim(),
  };

  await sgMail.send(msg);
}

module.exports = { sendConfirmation, sendArtistAlert };
