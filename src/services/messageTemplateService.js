const { db } = require('../config/database');

function getSetting(key, defaultValue = '') {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : defaultValue;
}

function formatDate(isoString) {
  if (!isoString) return 'TBD';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTime(isoString) {
  return formatDate(isoString);
}

function generateReminderMessage(booking, baseUrl = 'http://localhost:3000') {
  const hostName = getSetting('host_name', 'Palette & Pillows Hosting');
  const portalUrl = `${baseUrl}/checkin.html?token=${booking.token}`;
  const checkInFormatted = formatDateTime(booking.check_in_date_time);
  const total = booking.total_adults;
  const received = booking.uploaded_count;
  const missing = booking.missing_count;

  let urgencyHeadline = '⚠️ Guest ID Verification Required for Building Entry';
  if (missing === 0) {
    urgencyHeadline = '✅ All IDs Received - You are all set!';
  } else if (booking.timing_category === 'TODAY') {
    urgencyHeadline = '🚨 URGENT: Complete ID Submission for Today\'s Check-in';
  }

  let body = '';
  if (missing === 0) {
    body = `Hi ${booking.guest_primary_name}, thank you for submitting all ${total} adult ID proofs. We have registered your arrival for Flat ${booking.unit_flat_number} (${checkInFormatted}) with the building security desk.`;
  } else if (received === 0) {
    body = `Hi ${booking.guest_primary_name}, we are excited to host you at ${hostName}!

The society security desk requires government ID proofs for ALL adult guests prior to arrival to permit entry at the gate.

🏢 *Stay Details:* Flat ${booking.unit_flat_number}
🕒 *Check-in:* ${checkInFormatted}
👥 *Total Adult Guests:* ${total}

👉 Please upload the ID proofs for all ${total} adult guests using your secure link below:
🔗 ${portalUrl}

*Uploading takes less than 60 seconds from your phone.*`;
  } else {
    body = `Hi ${booking.guest_primary_name}, thank you for sharing initial details!

We have received IDs for *${received} of ${total} adult guests*. Society gate approval requires ID proof for *all adult guests* before granting entry.

🏢 *Flat:* ${booking.unit_flat_number}
⏳ *Pending:* ${missing} adult ID(s) still missing

👉 Please upload the remaining ${missing} ID(s) here so security permits entry without delays:
🔗 ${portalUrl}`;
  }

  return {
    headline: urgencyHeadline,
    text: body,
    portalUrl,
    whatsappShareUrl: booking.guest_phone
      ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(booking.guest_phone.replace(/[^0-9+]/g, ''))}&text=${encodeURIComponent(body)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(body)}`
  };
}

module.exports = {
  generateReminderMessage,
  formatDateTime,
  getSetting
};
