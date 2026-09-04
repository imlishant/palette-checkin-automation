const { db } = require('../config/database');
const crypto = require('crypto');

function generateListingId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `LISTING-${num}`;
}

/**
 * Returns all active listings ordered by name.
 */
function getAllListings() {
  return db.prepare(`
    SELECT * FROM listings WHERE is_active = 1 ORDER BY created_at ASC
  `).all();
}

/**
 * Gets a single listing by its ID.
 */
function getListingById(id) {
  if (!id) return null;
  return db.prepare(`SELECT * FROM listings WHERE id = ?`).get(id);
}

/**
 * Creates a new listing profile.
 */
function createListing(data) {
  const id = data.id || generateListingId();
  const insert = db.prepare(`
    INSERT INTO listings (
      id, name, unit_flat_number, society_name, society_email,
      email_cc_list, host_name, host_phone, host_email,
      email_subject_template, email_intro_text, email_disclaimer_text, is_active
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 1
    )
  `);

  insert.run(
    id,
    data.name || `Flat ${data.unit_flat_number}`,
    data.unit_flat_number,
    data.society_name || 'Society Security Desk',
    data.society_email,
    data.email_cc_list || null,
    data.host_name || null,
    data.host_phone || null,
    data.host_email || null,
    data.email_subject_template || null,
    data.email_intro_text || null,
    data.email_disclaimer_text || null
  );

  return getListingById(id);
}

/**
 * Updates an existing listing profile.
 */
function updateListing(id, data) {
  const existing = getListingById(id);
  if (!existing) {
    throw new Error(`Listing ${id} not found.`);
  }

  const update = db.prepare(`
    UPDATE listings SET
      name = ?,
      unit_flat_number = ?,
      society_name = ?,
      society_email = ?,
      email_cc_list = ?,
      host_name = ?,
      host_phone = ?,
      host_email = ?,
      email_subject_template = ?,
      email_intro_text = ?,
      email_disclaimer_text = ?,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `);

  update.run(
    data.name !== undefined ? data.name : existing.name,
    data.unit_flat_number !== undefined ? data.unit_flat_number : existing.unit_flat_number,
    data.society_name !== undefined ? data.society_name : existing.society_name,
    data.society_email !== undefined ? data.society_email : existing.society_email,
    data.email_cc_list !== undefined ? data.email_cc_list : existing.email_cc_list,
    data.host_name !== undefined ? data.host_name : existing.host_name,
    data.host_phone !== undefined ? data.host_phone : existing.host_phone,
    data.host_email !== undefined ? data.host_email : existing.host_email,
    data.email_subject_template !== undefined ? data.email_subject_template : existing.email_subject_template,
    data.email_intro_text !== undefined ? data.email_intro_text : existing.email_intro_text,
    data.email_disclaimer_text !== undefined ? data.email_disclaimer_text : existing.email_disclaimer_text,
    id
  );

  return getListingById(id);
}

/**
 * Deletes or deactivates a listing profile.
 */
function deleteListing(id) {
  const existing = getListingById(id);
  if (!existing) {
    throw new Error(`Listing ${id} not found.`);
  }

  // Soft delete by setting is_active = 0
  db.prepare(`UPDATE listings SET is_active = 0, updated_at = datetime('now', 'localtime') WHERE id = ?`).run(id);
  return { success: true, message: `Listing ${id} archived.` };
}

module.exports = {
  getAllListings,
  getListingById,
  createListing,
  updateListing,
  deleteListing
};
