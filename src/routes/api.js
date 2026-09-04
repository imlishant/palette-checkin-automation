const express = require('express');
const router = express.Router();
const { db } = require('../config/database');
const { upload } = require('../utils/fileUpload');
const {
  createBooking,
  getBookingById,
  getAllBookings,
  updateBookingDetails,
  deleteBooking
} = require('../services/bookingService');
const {
  getAllListings,
  getListingById,
  createListing,
  updateListing,
  deleteListing
} = require('../services/listingService');
const {
  uploadAdultId,
  removeAdultId,
  updateAdultMetadata
} = require('../services/guestAdultService');
const {
  dispatchSocietyEmail,
  previewSocietyEmail
} = require('../services/dispatchService');
const {
  generateReminderMessage
} = require('../services/messageTemplateService');
const { runArrivalComplianceCheck } = require('../services/schedulerService');

// --- Admin Authentication Middleware ---
function requireAdminAuth(req, res, next) {
  const configuredPin = process.env.ADMIN_PIN || '7788';
  const clientPin = req.headers['x-admin-pin'] || req.query.admin_pin;

  if (!clientPin || clientPin !== configuredPin) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Host Admin PIN required to access this resource.'
    });
  }
  next();
}

// Public Auth Endpoint
router.post('/auth/verify-pin', (req, res) => {
  const configuredPin = process.env.ADMIN_PIN || '7788';
  const { pin } = req.body;

  if (pin === configuredPin) {
    res.json({ success: true, message: 'Authentication successful.' });
  } else {
    res.status(401).json({ success: false, error: 'Incorrect Host Admin PIN. Access denied.' });
  }
});

// Protect all following routes with requireAdminAuth
router.use(requireAdminAuth);

// --- Listings Management Routes ---
router.get('/listings', (req, res) => {
  try {
    const listings = getAllListings();
    res.json({ success: true, listings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/listings/:id', (req, res) => {
  try {
    const listing = getListingById(req.params.id);
    if (!listing) return res.status(404).json({ success: false, error: 'Listing not found' });
    res.json({ success: true, listing });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/listings', (req, res) => {
  try {
    const {
      name,
      unit_flat_number,
      society_name,
      society_email,
      email_cc_list,
      host_name,
      host_phone,
      host_email,
      email_subject_template,
      email_intro_text,
      email_disclaimer_text
    } = req.body;

    if (!unit_flat_number || !society_email) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least a Flat/Unit Number and Society Security Email.'
      });
    }

    const listing = createListing({
      name: name || `Flat ${unit_flat_number}`,
      unit_flat_number,
      society_name,
      society_email,
      email_cc_list,
      host_name,
      host_phone,
      host_email,
      email_subject_template,
      email_intro_text,
      email_disclaimer_text
    });

    res.status(201).json({ success: true, listing });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/listings/:id', (req, res) => {
  try {
    const updated = updateListing(req.params.id, req.body);
    res.json({ success: true, listing: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/listings/:id', (req, res) => {
  try {
    const result = deleteListing(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Bookings Routes ---
router.get('/bookings', (req, res) => {
  try {
    const bookings = getAllBookings();
    res.json({ success: true, bookings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/bookings/:id', (req, res) => {
  try {
    const booking = getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }
    res.json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/bookings', (req, res) => {
  try {
    const {
      guest_primary_name,
      guest_phone,
      guest_email,
      unit_flat_number,
      check_in_date_time,
      check_out_date_time,
      total_adults,
      total_children,
      vehicle_number,
      source,
      listing_id
    } = req.body;

    if (!guest_primary_name || !unit_flat_number || !check_in_date_time || !check_out_date_time) {
      return res.status(400).json({
        success: false,
        error: 'Please provide guest name, unit flat number, check-in, and check-out times.'
      });
    }

    const booking = createBooking({
      guest_primary_name,
      guest_phone,
      guest_email,
      unit_flat_number,
      check_in_date_time,
      check_out_date_time,
      total_adults: parseInt(total_adults || 1, 10),
      total_children: parseInt(total_children || 0, 10),
      vehicle_number,
      source: source || 'Airbnb',
      listing_id: listing_id || null
    });

    res.status(201).json({ success: true, booking });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/bookings/:id', (req, res) => {
  try {
    const updated = updateBookingDetails(req.params.id, req.body);
    res.json({ success: true, booking: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/bookings/:id', (req, res) => {
  try {
    deleteBooking(req.params.id);
    res.json({ success: true, message: `Booking ${req.params.id} deleted.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Adult Guest ID Upload & Management ---
router.post('/adults/:id/upload', upload.single('id_file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No ID file provided.' });
    }

    const adult = uploadAdultId(req.params.id, req.file, {
      full_name: req.body.full_name,
      id_type: req.body.id_type
    });

    res.json({ success: true, adult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/adults/:id/id', (req, res) => {
  try {
    const adult = removeAdultId(req.params.id);
    res.json({ success: true, adult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/adults/:id', (req, res) => {
  try {
    updateAdultMetadata(req.params.id, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Reminder Message Generator ---
router.get('/bookings/:id/reminder', (req, res) => {
  try {
    const booking = getBookingById(req.params.id);
    if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

    const host = req.get('host');
    const protocol = req.protocol;
    const baseUrl = `${protocol}://${host}`;

    const reminder = generateReminderMessage(booking, baseUrl);
    res.json({ success: true, reminder });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Society Email Preview & Dispatch ---
router.get('/bookings/:id/preview-email', (req, res) => {
  try {
    const preview = previewSocietyEmail(req.params.id);
    res.json({ success: true, preview });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/bookings/:id/dispatch', async (req, res) => {
  try {
    const { dispatchedBy = 'HOST_OVERRIDE', forceResend = false, overrideEmail = null } = req.body;
    const result = await dispatchSocietyEmail(req.params.id, {
      dispatchedBy,
      forceResend,
      overrideEmail
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Scheduler Manual Trigger ---
router.post('/scheduler/run-now', async (req, res) => {
  try {
    const result = await runArrivalComplianceCheck();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Settings & Audit Logs ---
router.get('/settings', (req, res) => {
  try {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/settings', (req, res) => {
  try {
    const update = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    const transaction = db.transaction((data) => {
      for (const [key, value] of Object.entries(data)) {
        update.run(key, String(value));
      }
    });
    transaction(req.body);
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/logs', (req, res) => {
  try {
    const logs = db.prepare(`SELECT * FROM dispatch_logs ORDER BY datetime(timestamp) DESC LIMIT 50`).all();
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
