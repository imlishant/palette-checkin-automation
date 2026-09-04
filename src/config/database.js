const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'email_automation.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      guest_primary_name TEXT NOT NULL,
      guest_phone TEXT,
      guest_email TEXT,
      unit_flat_number TEXT NOT NULL,
      check_in_date_time TEXT NOT NULL,
      check_out_date_time TEXT NOT NULL,
      total_adults INTEGER NOT NULL DEFAULT 1,
      total_children INTEGER NOT NULL DEFAULT 0,
      vehicle_number TEXT,
      source TEXT DEFAULT 'Airbnb',
      society_email_status TEXT DEFAULT 'PENDING_IDS', -- PENDING_IDS, READY_TO_DISPATCH, SENT, OVERRIDDEN
      society_email_sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS guest_adults (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      adult_index INTEGER NOT NULL,
      full_name TEXT,
      id_type TEXT DEFAULT 'Aadhaar', -- Aadhaar, Passport, DL, Voter ID, Govt ID
      id_file_path TEXT,
      id_file_name TEXT,
      file_size_bytes INTEGER,
      status TEXT DEFAULT 'MISSING', -- MISSING, UPLOADED, VERIFIED
      uploaded_at TEXT,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dispatch_logs (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      attached_ids_count INTEGER NOT NULL DEFAULT 0,
      dispatched_by TEXT NOT NULL, -- AUTO_SCHEDULER, HOST_OVERRIDE, MANUAL_TEST
      status TEXT NOT NULL, -- SUCCESS, FAILED
      error_message TEXT,
      email_preview_html TEXT,
      timestamp TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit_flat_number TEXT NOT NULL,
      society_name TEXT NOT NULL,
      society_email TEXT NOT NULL,
      email_cc_list TEXT,
      host_name TEXT,
      host_phone TEXT,
      host_email TEXT,
      email_subject_template TEXT,
      email_intro_text TEXT,
      email_disclaimer_text TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migration: Ensure bookings table has listing_id column
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(bookings)`).all();
    const hasListingId = tableInfo.some(col => col.name === 'listing_id');
    if (!hasListingId) {
      db.exec(`ALTER TABLE bookings ADD COLUMN listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL;`);
      console.log('[DB] Migrated bookings table: added listing_id column.');
    }
  } catch (err) {
    console.warn('[DB] Migration note for bookings table:', err.message);
  }

  // Insert default settings if not exists
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  const defaultSocietyName = process.env.DEFAULT_SOCIETY_NAME || 'Green Valley Heights Security Desk';
  const defaultSocietyEmail = process.env.DEFAULT_SOCIETY_EMAIL || 'society.security@greenvalleyrwa.org';
  const defaultHostName = process.env.HOST_NAME || 'Palette & Pillows Hosting';
  const defaultHostPhone = process.env.HOST_PHONE || '+91 98765 43210';
  const defaultHostEmail = process.env.HOST_EMAIL || process.env.SMTP_USER || 'host@paletteandpillows.com';
  const defaultCcList = process.env.EMAIL_CC_LIST || process.env.HOST_EMAIL || process.env.SMTP_USER || 'host@paletteandpillows.com';
  const defaultSubjectTemplate = process.env.EMAIL_SUBJECT_TEMPLATE || '[Guest Arrival] Flat {unit} - {guest_name} ({adult_count} Adults) - {check_in}';
  const defaultIntroText = process.env.EMAIL_INTRO_TEXT || 'Please permit gate entry for the following registered guest(s) arriving at Flat {unit}. All verified government identity proofs are attached with this email for society security compliance.';
  const defaultDisclaimerText = process.env.EMAIL_DISCLAIMER_TEXT || 'Attached files contain confidential identity documents for society verification and building security clearance only.';

  insertSetting.run('society_name', defaultSocietyName);
  insertSetting.run('society_email', defaultSocietyEmail);
  insertSetting.run('host_name', defaultHostName);
  insertSetting.run('host_phone', defaultHostPhone);
  insertSetting.run('host_email', defaultHostEmail);
  insertSetting.run('email_cc_list', defaultCcList);
  insertSetting.run('email_subject_template', defaultSubjectTemplate);
  insertSetting.run('email_intro_text', defaultIntroText);
  insertSetting.run('email_disclaimer_text', defaultDisclaimerText);
  insertSetting.run('auto_dispatch_enabled', process.env.AUTO_DISPATCH_ENABLED || 'true');
  insertSetting.run('dispatch_hours_before', process.env.DISPATCH_HOURS_BEFORE || '24');

  // Seed default listing if no listings exist
  const existingListings = db.prepare(`SELECT count(*) as count FROM listings`).get();
  if (existingListings.count === 0) {
    const insertListing = db.prepare(`
      INSERT INTO listings (
        id, name, unit_flat_number, society_name, society_email,
        email_cc_list, host_name, host_phone, host_email,
        email_subject_template, email_intro_text, email_disclaimer_text, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    insertListing.run(
      'listing-1',
      'Listing 1 (Flat A-1204 - Green Valley)',
      'A-1204',
      defaultSocietyName,
      defaultSocietyEmail,
      defaultCcList,
      defaultHostName,
      defaultHostPhone,
      defaultHostEmail,
      defaultSubjectTemplate,
      defaultIntroText,
      defaultDisclaimerText
    );
    console.log('[DB] Seeded initial default listing: listing-1.');
  }

  console.log('[DB] Database tables, migrations, and default settings initialized.');
}

module.exports = {
  db,
  initDatabase
};
