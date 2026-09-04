const { db } = require('../config/database');
const crypto = require('crypto');

function generateBookingId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `BK-${num}`;
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Creates a new booking and automatically provisions adult ID slots.
 */
function createBooking(data) {
  const id = data.id || generateBookingId();
  const token = generateToken();
  const totalAdults = parseInt(data.total_adults || 1, 10);
  const totalChildren = parseInt(data.total_children || 0, 10);
  const listingId = data.listing_id || null;

  const insertBooking = db.prepare(`
    INSERT INTO bookings (
      id, token, guest_primary_name, guest_phone, guest_email,
      unit_flat_number, check_in_date_time, check_out_date_time,
      total_adults, total_children, vehicle_number, source,
      society_email_status, listing_id
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      'PENDING_IDS', ?
    )
  `);

  const insertAdult = db.prepare(`
    INSERT INTO guest_adults (
      id, booking_id, adult_index, full_name, id_type, status
    ) VALUES (
      ?, ?, ?, ?, 'Aadhaar', 'MISSING'
    )
  `);

  const transaction = db.transaction(() => {
    insertBooking.run(
      id,
      token,
      data.guest_primary_name,
      data.guest_phone || null,
      data.guest_email || null,
      data.unit_flat_number,
      data.check_in_date_time,
      data.check_out_date_time,
      totalAdults,
      totalChildren,
      data.vehicle_number || null,
      data.source || 'Airbnb',
      listingId
    );

    for (let i = 1; i <= totalAdults; i++) {
      const adultId = `${id}-A${i}`;
      // Lead guest gets primary name, other adult slots remain empty for real name entry
      const defaultName = i === 1 ? data.guest_primary_name : null;
      insertAdult.run(adultId, id, i, defaultName);
    }
  });

  transaction();
  return getBookingById(id);
}

/**
 * Validates a guest legal name using strict alphabetic regex (min 3 chars, letters, spaces, dots, hyphens only).
 */
function isValidGuestName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  // Must be between 3 and 60 characters, containing only letters, spaces, dots, and hyphens
  const nameRegex = /^[a-zA-Z\s.'-]{3,60}$/;
  return nameRegex.test(trimmed);
}

/**
 * Retrieves a booking by its ID with all associated adult ID records and strict compliance breakdown.
 */
function getBookingById(id) {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id);
  if (!booking) return null;

  const adults = db.prepare(`
    SELECT * FROM guest_adults WHERE booking_id = ? ORDER BY adult_index ASC
  `).all(id);

  // Fetch linked listing profile if available
  let listing = null;
  if (booking.listing_id) {
    listing = db.prepare(`SELECT * FROM listings WHERE id = ?`).get(booking.listing_id) || null;
  }

  // An adult is truly complete ONLY IF:
  // 1. A valid ID document is attached (status UPLOADED/VERIFIED & file exists)
  // 2. A valid legal name (min 3 characters) is provided
  const completeAdults = adults.filter(a => {
    const hasFile = (a.status === 'UPLOADED' || a.status === 'VERIFIED') && !!a.id_file_path;
    const hasValidName = isValidGuestName(a.full_name);
    return hasFile && hasValidName;
  });

  const filesUploadedCount = adults.filter(a => (a.status === 'UPLOADED' || a.status === 'VERIFIED') && !!a.id_file_path).length;
  const namesProvidedCount = adults.filter(a => isValidGuestName(a.full_name)).length;

  const uploadedCount = completeAdults.length;
  const missingCount = Math.max(0, booking.total_adults - uploadedCount);
  const missingNamesCount = Math.max(0, booking.total_adults - namesProvidedCount);
  const missingFilesCount = Math.max(0, booking.total_adults - filesUploadedCount);
  const isComplete = uploadedCount >= booking.total_adults;

  return {
    ...booking,
    listing,
    adults: adults.map(a => ({
      ...a,
      has_valid_name: isValidGuestName(a.full_name),
      has_file: !!a.id_file_path,
      is_slot_complete: (a.status === 'UPLOADED' || a.status === 'VERIFIED') && !!a.id_file_path && isValidGuestName(a.full_name)
    })),
    uploaded_count: uploadedCount,
    missing_count: missingCount,
    missing_names_count: missingNamesCount,
    missing_files_count: missingFilesCount,
    is_complete: isComplete,
    completion_percentage: Math.round((uploadedCount / booking.total_adults) * 100)
  };
}

/**
 * Retrieves a booking by guest portal token.
 */
function getBookingByToken(token) {
  const booking = db.prepare(`SELECT * FROM bookings WHERE token = ?`).get(token);
  if (!booking) return null;
  return getBookingById(booking.id);
}

/**
 * Retrieves all bookings with computed compliance status and adult breakdown.
 */
function getAllBookings(filter = 'ALL') {
  let query = `SELECT * FROM bookings ORDER BY datetime(check_in_date_time) ASC`;
  const bookings = db.prepare(query).all();

  const enriched = bookings.map(b => getBookingById(b.id));

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  return enriched.map(b => {
    const checkInDate = b.check_in_date_time.split('T')[0];
    let timingCategory = 'UPCOMING';
    if (checkInDate === todayStr) {
      timingCategory = 'TODAY';
    } else if (checkInDate === tomorrowStr) {
      timingCategory = 'TOMORROW';
    } else if (new Date(b.check_in_date_time) < now) {
      timingCategory = 'PAST';
    }

    return {
      ...b,
      timing_category: timingCategory
    };
  });
}

/**
 * Updates guest info / vehicle info from guest or host.
 */
function updateBookingDetails(id, updates) {
  const fields = [];
  const values = [];

  if (updates.vehicle_number !== undefined) {
    fields.push('vehicle_number = ?');
    values.push(updates.vehicle_number);
  }
  if (updates.guest_phone !== undefined) {
    fields.push('guest_phone = ?');
    values.push(updates.guest_phone);
  }
  if (updates.guest_email !== undefined) {
    fields.push('guest_email = ?');
    values.push(updates.guest_email);
  }
  if (updates.unit_flat_number !== undefined) {
    fields.push('unit_flat_number = ?');
    values.push(updates.unit_flat_number);
  }
  if (updates.listing_id !== undefined) {
    fields.push('listing_id = ?');
    values.push(updates.listing_id);
  }

  if (fields.length === 0) return getBookingById(id);

  fields.push("updated_at = datetime('now', 'localtime')");
  values.push(id);

  const sql = `UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...values);

  return getBookingById(id);
}

/**
 * Deletes a booking and its records.
 */
function deleteBooking(id) {
  db.prepare(`DELETE FROM bookings WHERE id = ?`).run(id);
  return { success: true };
}

module.exports = {
  createBooking,
  getBookingById,
  getBookingByToken,
  getAllBookings,
  updateBookingDetails,
  deleteBooking
};
