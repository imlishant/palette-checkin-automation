const { db } = require('../config/database');
const path = require('path');
const fs = require('fs');

/**
 * Updates an adult guest's ID details and marks status as UPLOADED.
 */
function uploadAdultId(adultId, fileData, extraData = {}) {
  const adult = db.prepare(`SELECT * FROM guest_adults WHERE id = ?`).get(adultId);
  if (!adult) {
    throw new Error(`Adult record ${adultId} not found`);
  }

  // If there was an old file, remove it
  if (adult.id_file_path && fs.existsSync(adult.id_file_path)) {
    try {
      fs.unlinkSync(adult.id_file_path);
    } catch (e) {
      console.warn(`[UPLOAD] Could not remove previous ID file: ${e.message}`);
    }
  }

  const fullName = extraData.full_name !== undefined ? extraData.full_name : adult.full_name;
  const idType = extraData.id_type || adult.id_type || 'Aadhaar';
  const nowStr = new Date().toISOString();

  const update = db.prepare(`
    UPDATE guest_adults
    SET full_name = ?,
        id_type = ?,
        id_file_path = ?,
        id_file_name = ?,
        file_size_bytes = ?,
        status = 'UPLOADED',
        uploaded_at = ?
    WHERE id = ?
  `);

  update.run(
    fullName,
    idType,
    fileData.path,
    fileData.originalname,
    fileData.size,
    nowStr,
    adultId
  );

  // Check if booking is now 100% complete
  checkAndUpdateBookingStatus(adult.booking_id);

  return db.prepare(`SELECT * FROM guest_adults WHERE id = ?`).get(adultId);
}

/**
 * Removes an uploaded ID file for an adult.
 */
function removeAdultId(adultId) {
  const adult = db.prepare(`SELECT * FROM guest_adults WHERE id = ?`).get(adultId);
  if (!adult) return null;

  if (adult.id_file_path && fs.existsSync(adult.id_file_path)) {
    try {
      fs.unlinkSync(adult.id_file_path);
    } catch (e) {
      console.warn(`[REMOVE] Could not remove ID file: ${e.message}`);
    }
  }

  db.prepare(`
    UPDATE guest_adults
    SET id_file_path = NULL,
        id_file_name = NULL,
        file_size_bytes = NULL,
        status = 'MISSING',
        uploaded_at = NULL
    WHERE id = ?
  `).run(adultId);

  checkAndUpdateBookingStatus(adult.booking_id);
  return db.prepare(`SELECT * FROM guest_adults WHERE id = ?`).get(adultId);
}

/**
 * Updates adult metadata (name, id type) without re-uploading file.
 */
function updateAdultMetadata(adultId, data) {
  const fields = [];
  const values = [];

  if (data.full_name !== undefined) {
    fields.push('full_name = ?');
    values.push(data.full_name);
  }
  if (data.id_type !== undefined) {
    fields.push('id_type = ?');
    values.push(data.id_type);
  }

  if (fields.length === 0) return;

  values.push(adultId);
  db.prepare(`UPDATE guest_adults SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Recalculates booking society status based on whether all adult slots have BOTH a valid name and ID.
 */
function checkAndUpdateBookingStatus(bookingId) {
  const booking = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
  if (!booking) return;

  // If already sent or overridden, don't revert to pending unless explicitly requested
  if (booking.society_email_status === 'SENT' || booking.society_email_status === 'OVERRIDDEN') {
    return;
  }

  const adults = db.prepare(`SELECT full_name, status, id_file_path FROM guest_adults WHERE booking_id = ?`).all(bookingId);
  
  const completeAdults = adults.filter(a => {
    const hasFile = (a.status === 'UPLOADED' || a.status === 'VERIFIED') && !!a.id_file_path;
    const hasValidName = typeof a.full_name === 'string' && a.full_name.trim().length >= 3;
    return hasFile && hasValidName;
  });

  const newStatus = completeAdults.length >= booking.total_adults ? 'READY_TO_DISPATCH' : 'PENDING_IDS';

  db.prepare(`
    UPDATE bookings
    SET society_email_status = ?,
        updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(newStatus, bookingId);
}

module.exports = {
  uploadAdultId,
  removeAdultId,
  updateAdultMetadata,
  checkAndUpdateBookingStatus
};
