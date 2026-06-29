// routes/appointments.js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db      = require('../db/database');
const { sendConfirmation, sendArtistAlert } = require('../utils/mailer');

const router = express.Router();

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  next();
}

const VALID_SERVICES = ['bridal-makeup', 'bridal-trial', 'event'];

// ── POST /api/appointments ────────────────────────────────────────────────────
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('date')
      .isDate({ format: 'YYYY-MM-DD' })
      .withMessage('Date must be in YYYY-MM-DD format')
      .custom((val) => {
        if (new Date(val) < new Date()) throw new Error('Date must be in the future');
        return true;
      }),
    body('service').isIn(VALID_SERVICES).withMessage(`Service must be one of: ${VALID_SERVICES.join(', ')}`),
    body('message').optional().trim(),
  ],
  validate,
  async (req, res) => {
    const { name, email, date, service, message } = req.body;
    try {
      const appointment = db.insertAppointment({ name, email, date, service, message });

      // Send emails — non-blocking, failures don't break the booking
      Promise.allSettled([
        sendConfirmation(appointment),
        sendArtistAlert(appointment),
      ]).then(results => results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[mailer] email ${i} failed:`, r.reason?.message);
      }));

      return res.status(201).json({
        success: true,
        message: 'Appointment created! A confirmation email is on its way.',
        data: appointment,
      });
    } catch (err) {
      console.error('[POST /appointments]', err);
      return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
  }
);

// ── GET /api/appointments ─────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  try {
    const rows = db.getAllAppointments();
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[GET /appointments]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/appointments/:id ─────────────────────────────────────────────────
router.get('/:id', [param('id').isInt({ min: 1 })], validate, (req, res) => {
  try {
    const row = db.getAppointmentById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: 'Appointment not found.' });
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error('[GET /appointments/:id]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── PATCH /api/appointments/:id/status ───────────────────────────────────────
router.patch(
  '/:id/status',
  [param('id').isInt({ min: 1 }), body('status').isIn(['pending', 'confirmed', 'cancelled'])],
  validate,
  (req, res) => {
    try {
      const ok = db.updateStatus(req.params.id, req.body.status);
      if (!ok) return res.status(404).json({ success: false, message: 'Appointment not found.' });
      return res.json({ success: true, message: `Status updated to "${req.body.status}".` });
    } catch (err) {
      console.error('[PATCH /appointments/:id/status]', err);
      return res.status(500).json({ success: false, message: 'Server error.' });
    }
  }
);

module.exports = router;
