
//routes/appointments.js is the core of the REST API — it validates incoming data, saves bookings to the database, 
//triggers automated emails, and returns the appropriate response to the frontend.

/*
Frontend sends POST request
        ↓
Validation checks all fields
        ↓
  Fields invalid? → Send 400 error back
  Fields valid?   → Keep going
        ↓
Save booking to database
        ↓
Send 2 emails simultaneously
        ↓
Send 201 success response to frontend
        ↓
Frontend shows green banner to customer */

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

// ── POST /api/appointments - creating a booking
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
      const appointment = db.insertAppointment({ name, email, date, service, message }); //save this booking to the database

      // sned two emails at the same time - one to the customer, one to me. if either fails, just log the error but don't cancel the booking
      Promise.allSettled([ //try both emails, and regardless of whether they succeed or fail, keep going
        sendConfirmation(appointment),
        sendArtistAlert(appointment),
      ]).then(results => results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[mailer] email ${i} failed:`, r.reason?.message);
      }));

      return res.status(201).json({ //tell the frontend everything worked. 201 is the HTTP status code for something was successfully created
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

// ── GET /api/appointments - retrieving all bookings, when someone asks for all appointments, go get them from the database and send them back

router.get('/', (_req, res) => {
  try {
    const rows = db.getAllAppointments();
    return res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error('[GET /appointments]', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ── GET /api/appointments/:id - retrieving one specific booking
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

// ── PATCH /api/appointments/:id/status - change the status of a booking to pending, confirmed, or cancelled
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
