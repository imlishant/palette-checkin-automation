const express = require('express');
const router = express.Router();
const { upload } = require('../utils/fileUpload');
const { getBookingByToken, updateBookingDetails } = require('../services/bookingService');
const { uploadAdultId } = require('../services/guestAdultService');
const { getSetting } = require('../services/messageTemplateService');

router.get('/portal/:token', (req, res) => {
  try {
    const booking = getBookingByToken(req.params.token);
    if (!booking) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired check-in link. Please contact the host.'
      });
    }

    const hostName = getSetting('host_name', 'Palette & Pillows');
    const hostPhone = getSetting('host_phone', '+91 98765 43210');
    const societyName = getSetting('society_name', 'Society Security Desk');

    res.json({
      success: true,
      booking,
      meta: {
        hostName,
        hostPhone,
        societyName
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Upload or Replace ID Document for a specific adult slot
router.post('/portal/:token/adults/:adultId/upload', upload.single('id_file'), (req, res) => {
  try {
    const booking = getBookingByToken(req.params.token);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Invalid check-in link.' });
    }

    // Verify adult belongs to this booking
    const matchingAdult = booking.adults.find(a => a.id === req.params.adultId);
    if (!matchingAdult) {
      return res.status(403).json({ success: false, error: 'Unauthorized adult slot.' });
    }

    const { full_name, id_type } = req.body;

    // If file uploaded, attach file
    let adult;
    if (req.file) {
      adult = uploadAdultId(req.params.adultId, req.file, {
        full_name: full_name !== undefined ? full_name : matchingAdult.full_name,
        id_type: id_type || matchingAdult.id_type || 'Aadhaar'
      });
    } else if (full_name !== undefined || id_type !== undefined) {
      const { updateAdultMetadata } = require('../services/guestAdultService');
      adult = updateAdultMetadata(req.params.adultId, {
        full_name,
        id_type
      });
    } else {
      return res.status(400).json({ success: false, error: 'No file or details provided.' });
    }

    const updatedBooking = getBookingByToken(req.params.token);

    res.json({
      success: true,
      adult,
      booking: updatedBooking
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save / Update an Individual Guest Slot (Name, ID Type)
router.post('/portal/:token/adults/:adultId/save', (req, res) => {
  try {
    const booking = getBookingByToken(req.params.token);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Invalid check-in link.' });
    }

    const matchingAdult = booking.adults.find(a => a.id === req.params.adultId);
    if (!matchingAdult) {
      return res.status(403).json({ success: false, error: 'Unauthorized adult slot.' });
    }

    const { full_name, id_type } = req.body;

    const { updateAdultMetadata } = require('../services/guestAdultService');
    const adult = updateAdultMetadata(req.params.adultId, {
      full_name,
      id_type: id_type || 'Aadhaar'
    });

    const updatedBooking = getBookingByToken(req.params.token);

    res.json({
      success: true,
      adult,
      booking: updatedBooking
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/portal/:token/details', (req, res) => {
  try {
    const booking = getBookingByToken(req.params.token);
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Invalid check-in link.' });
    }

    const updated = updateBookingDetails(booking.id, {
      vehicle_number: req.body.vehicle_number,
      guest_phone: req.body.guest_phone,
      guest_email: req.body.guest_email
    });

    res.json({
      success: true,
      booking: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
