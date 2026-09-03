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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Insert default settings if not exists
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);

  insertSetting.run('society_name', process.env.DEFAULT_SOCIETY_NAME || 'Green Valley Heights Security Desk');
  insertSetting.run('society_email', process.env.DEFAULT_SOCIETY_EMAIL || 'society.security@greenvalleyrwa.org');
  insertSetting.run('host_name', process.env.HOST_NAME || 'Palette & Pillows Hosting');
  insertSetting.run('host_phone', process.env.HOST_PHONE || '+91 98765 43210');
  insertSetting.run('host_email', process.env.HOST_EMAIL || 'host@paletteandpillows.com');
  insertSetting.run('email_cc_list', process.env.HOST_EMAIL || 'host@paletteandpillows.com');
  insertSetting.run('email_subject_template', '[Guest Arrival] Flat {unit} - {guest_name} ({adult_count} Adults) - {check_in}');
  insertSetting.run('email_intro_text', 'Please permit gate entry for the following registered guest(s) arriving at Flat {unit}. All verified government identity proofs are attached with this email for society security compliance.');
  insertSetting.run('email_disclaimer_text', 'Attached files contain confidential identity documents for society verification and building security clearance only.');
  insertSetting.run('auto_dispatch_enabled', 'true');
  insertSetting.run('dispatch_hours_before', '24');

  console.log('[DB] Database tables and default settings initialized.');
}

module.exports = {
  db,
  initDatabase
};
