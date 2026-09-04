const { db } = require('../config/database');
const { getEmailTransporter } = require('../config/email');
const { getBookingById } = require('./bookingService');
const { formatDateTime, getSetting } = require('./messageTemplateService');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Replaces placeholders in dynamic templates like {unit}, {guest_name}, {check_in}, etc.
 */
function interpolateTemplate(templateStr, variables) {
  if (!templateStr) return '';
  let result = templateStr;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value !== undefined && value !== null ? String(value) : '');
  }
  return result;
}

/**
 * Builds the HTML content for the society entry notification email based on admin settings.
 */
function buildSocietyEmailHtml(booking, societyName, hostName, hostPhone, hostEmail) {
  const checkInStr = formatDateTime(booking.check_in_date_time);
  const checkOutStr = formatDateTime(booking.check_out_date_time);
  const vehicleStr = booking.vehicle_number ? booking.vehicle_number : 'None / Cab / Public Transit';
  const listing = booking.listing || null;

  // Template variables available for admin customization
  const templateVars = {
    unit: booking.unit_flat_number,
    guest_name: booking.guest_primary_name,
    guest_phone: booking.guest_phone || 'Provided on arrival',
    guest_email: booking.guest_email || 'N/A',
    check_in: checkInStr,
    check_out: checkOutStr,
    adult_count: booking.total_adults,
    children_count: booking.total_children,
    vehicle: vehicleStr,
    booking_id: booking.id,
    source: booking.source || 'Airbnb',
    society_name: societyName,
    host_name: hostName,
    host_phone: hostPhone,
    host_email: hostEmail
  };

  const rawIntro = (listing && listing.email_intro_text) || getSetting(
    'email_intro_text',
    'Please permit gate entry for the following registered guest(s) arriving at Flat {unit}. All verified government identity proofs are attached with this email for society security compliance.'
  );
  const interpolatedIntro = interpolateTemplate(rawIntro, templateVars);

  const rawDisclaimer = (listing && listing.email_disclaimer_text) || getSetting(
    'email_disclaimer_text',
    'Attached files contain confidential identity documents for society verification and building security clearance only.'
  );
  const interpolatedDisclaimer = interpolateTemplate(rawDisclaimer, templateVars);

  const adultsRows = booking.adults.map((adult) => {
    const hasValidName = typeof adult.full_name === 'string' && adult.full_name.trim().length >= 3;
    const hasFile = (adult.status === 'UPLOADED' || adult.status === 'VERIFIED') && !!adult.id_file_path;

    const nameDisplay = hasValidName 
      ? escapeHtml(adult.full_name.trim()) 
      : '<span style="color:#dc2626;font-weight:700;">⚠ Missing Legal Name</span>';

    let statusBadge = '';
    if (hasFile && hasValidName) {
      statusBadge = '<span style="color:#059669;font-weight:600;">✓ ID Attached & Verified</span>';
    } else if (hasFile && !hasValidName) {
      statusBadge = '<span style="color:#ea580c;font-weight:600;">⚠ Photo Uploaded (Name Missing)</span>';
    } else if (!hasFile && hasValidName) {
      statusBadge = '<span style="color:#dc2626;font-weight:600;">⚠ ID Photo Missing</span>';
    } else {
      statusBadge = '<span style="color:#dc2626;font-weight:600;">❌ Name & ID Missing</span>';
    }
    
    return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#334155;">Adult ${adult.adult_index}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:600;color:#0f172a;">${nameDisplay}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#475569;">${escapeHtml(adult.id_type || 'Aadhaar')}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:14px;">${statusBadge}</td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Guest Arrival Notification - Flat ${booking.unit_flat_number}</title>
</head>
<body style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color:#f8fafc; margin:0; padding:24px; color:#1e293b;">
  <div style="max-width:640px; margin:0 auto; background-color:#ffffff; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding:28px 32px; color:#ffffff;">
      <div style="font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; opacity:0.85; margin-bottom:6px;">
        GUEST ENTRY APPROVAL REQUEST
      </div>
      <h1 style="margin:0; font-size:22px; font-weight:700; line-height:1.3;">
        Arrival Notification: Flat ${booking.unit_flat_number}
      </h1>
      <p style="margin:6px 0 0 0; font-size:14px; opacity:0.9;">
        Booking Reference: <strong>${booking.id}</strong> (${booking.source || 'Airbnb'})
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding:28px 32px;">
      <p style="font-size:15px; line-height:1.6; color:#334155; margin-top:0;">
        Dear <strong>${societyName}</strong>,
      </p>
      <p style="font-size:15px; line-height:1.6; color:#334155;">
        ${interpolatedIntro}
      </p>

      <!-- Key Details Grid -->
      <div style="background-color:#f1f5f9; border-radius:8px; padding:18px 20px; margin:20px 0;">
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr>
            <td style="padding:6px 0; color:#64748b; width:40%;">Flat / Unit:</td>
            <td style="padding:6px 0; font-weight:700; color:#0f172a; font-size:16px;">Flat ${booking.unit_flat_number}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; color:#64748b;">Primary Guest:</td>
            <td style="padding:6px 0; font-weight:600; color:#0f172a;">${booking.guest_primary_name}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; color:#64748b;">Guest Phone / Contact:</td>
            <td style="padding:6px 0; color:#0f172a;">${booking.guest_phone || 'Provided upon check-in'}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; color:#64748b;">Check-in Date & Time:</td>
            <td style="padding:6px 0; font-weight:600; color:#4338ca;">${checkInStr}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; color:#64748b;">Check-out Date & Time:</td>
            <td style="padding:6px 0; color:#0f172a;">${checkOutStr}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; color:#64748b;">Total Guests:</td>
            <td style="padding:6px 0; color:#0f172a;"><strong>${booking.total_adults} Adult(s)</strong> ${booking.total_children > 0 ? `, ${booking.total_children} Child(ren)` : ''}</td>
          </tr>
          <tr>
            <td style="padding:6px 0; color:#64748b;">Vehicle Number:</td>
            <td style="padding:6px 0; font-weight:600; color:#0f172a;">${vehicleStr}</td>
          </tr>
        </table>
      </div>

      <!-- Adult Guest Manifest Table -->
      <h3 style="font-size:16px; margin:24px 0 12px 0; color:#0f172a;">Registered Adult Guest(s) & ID Verification</h3>
      <table style="width:100%; border-collapse:collapse; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; margin-bottom:24px;">
        <thead>
          <tr style="background-color:#f8fafc; text-align:left;">
            <th style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:12px; text-transform:uppercase; color:#64748b;">Slot</th>
            <th style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:12px; text-transform:uppercase; color:#64748b;">Guest Name</th>
            <th style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:12px; text-transform:uppercase; color:#64748b;">ID Document</th>
            <th style="padding:10px 14px; border-bottom:1px solid #e2e8f0; font-size:12px; text-transform:uppercase; color:#64748b;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${adultsRows}
        </tbody>
      </table>

      <!-- Host Verification Note -->
      <div style="border-left:4px solid #4f46e5; background-color:#eef2ff; padding:14px 18px; border-radius:0 8px 8px 0; font-size:13px; color:#312e81; line-height:1.5;">
        <strong>Host Contact for Verification:</strong><br>
        ${hostName} | Phone: <a href="tel:${hostPhone}" style="color:#4f46e5; text-decoration:none; font-weight:600;">${hostPhone}</a> | Email: ${hostEmail}
      </div>

      <p style="font-size:13px; color:#64748b; margin-top:24px; line-height:1.5;">
        <em>Note: ${interpolatedDisclaimer}</em>
      </p>
    </div>

    <!-- Footer -->
    <div style="background-color:#f8fafc; border-top:1px solid #e2e8f0; padding:16px 32px; text-align:center; font-size:12px; color:#94a3b8;">
      Palette & Pillows Hosting &bull; Automated Security & Compliance System
    </div>

  </div>
</body>
</html>
  `;
}

/**
 * Dispatches society email with all adult ID attachments and handles idempotency.
 */
async function dispatchSocietyEmail(bookingId, options = {}) {
  const {
    dispatchedBy = 'AUTO_SCHEDULER', // AUTO_SCHEDULER, HOST_OVERRIDE, MANUAL_TEST
    overrideEmail = null,
    forceResend = false
  } = options;

  const booking = getBookingById(bookingId);
  if (!booking) {
    throw new Error(`Booking ${bookingId} not found.`);
  }

  // Idempotency Check: Reject auto-scheduler if already sent
  if (booking.society_email_status === 'SENT' && !forceResend && dispatchedBy === 'AUTO_SCHEDULER') {
    return {
      success: true,
      alreadySent: true,
      message: `Booking ${bookingId} was already sent on ${booking.society_email_sent_at}. Skipping auto-dispatch.`
    };
  }

  // Completeness check for AUTO_SCHEDULER
  if (dispatchedBy === 'AUTO_SCHEDULER' && !booking.is_complete) {
    return {
      success: false,
      reason: 'INCOMPLETE_IDS',
      message: `Cannot auto-dispatch: Only ${booking.uploaded_count} of ${booking.total_adults} adult IDs uploaded.`
    };
  }

  const listing = booking.listing || null;

  const societyName = (listing && listing.society_name) || getSetting('society_name', 'Green Valley Heights Security Desk');
  const recipientEmail = overrideEmail || (listing && listing.society_email) || getSetting('society_email', 'society.security@greenvalleyrwa.org');
  const hostName = (listing && listing.host_name) || getSetting('host_name', 'Palette & Pillows Hosting');
  const hostPhone = (listing && listing.host_phone) || getSetting('host_phone', '+91 98765 43210');
  const hostEmail = (listing && listing.host_email) || getSetting('host_email', 'host@paletteandpillows.com');
  const rawCcList = (listing && listing.email_cc_list !== null && listing.email_cc_list !== undefined)
    ? listing.email_cc_list
    : getSetting('email_cc_list', hostEmail);
  const ccEmails = rawCcList.split(',').map(s => s.trim()).filter(Boolean);

  const checkInStr = formatDateTime(booking.check_in_date_time);
  const checkOutStr = formatDateTime(booking.check_out_date_time);
  const vehicleStr = booking.vehicle_number ? booking.vehicle_number : 'None / Cab / Public Transit';

  const templateVars = {
    unit: booking.unit_flat_number,
    guest_name: booking.guest_primary_name,
    check_in: checkInStr,
    check_out: checkOutStr,
    adult_count: booking.total_adults,
    children_count: booking.total_children,
    vehicle: vehicleStr,
    booking_id: booking.id,
    society_name: societyName,
    host_name: hostName
  };

  const subjectTemplate = (listing && listing.email_subject_template) || getSetting(
    'email_subject_template',
    '[Guest Arrival] Flat {unit} - {guest_name} ({adult_count} Adults) - {check_in}'
  );
  const subject = interpolateTemplate(subjectTemplate, templateVars);
  const htmlContent = buildSocietyEmailHtml(booking, societyName, hostName, hostPhone, hostEmail);

  // Prepare attachments
  const attachments = [];
  booking.adults.forEach((adult) => {
    if (adult.id_file_path && fs.existsSync(adult.id_file_path)) {
      const ext = path.extname(adult.id_file_path);
      const cleanName = (adult.full_name || `Adult_${adult.adult_index}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      const attachmentFilename = `ID_Adult_${adult.adult_index}_${cleanName}${ext}`;

      attachments.push({
        filename: attachmentFilename,
        path: adult.id_file_path
      });
    }
  });

  const transporter = await getEmailTransporter();
  const mailOptions = {
    from: process.env.SMTP_FROM || `"${hostName}" <notifications@paletteandpillows.com>`,
    to: recipientEmail,
    cc: ccEmails.length > 0 ? ccEmails : undefined,
    subject: subject,
    html: htmlContent,
    attachments
  };

  const dispatchLogId = `LOG-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let status = 'SUCCESS';
  let errorMessage = null;

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[DISPATCH] Society email sent for ${bookingId}. MessageId: ${info.messageId}`);

    // If Ethereal test mail, print preview URL
    const nodemailer = require('nodemailer');
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[DISPATCH] Preview Ethereal URL: ${previewUrl}`);
    }

    // Update booking status
    const newStatus = dispatchedBy === 'HOST_OVERRIDE' && !booking.is_complete ? 'OVERRIDDEN' : 'SENT';
    db.prepare(`
      UPDATE bookings SET
        society_email_status = ?,
        society_email_sent_at = datetime('now', 'localtime'),
        updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(newStatus, bookingId);

  } catch (err) {
    console.error(`[DISPATCH] Failed to send email for ${bookingId}:`, err);
    status = 'FAILED';
    errorMessage = err.message;
    throw err;
  } finally {
    // Record audit log
    db.prepare(`
      INSERT INTO dispatch_logs (
        id, booking_id, recipient_email, subject, attached_ids_count,
        dispatched_by, status, error_message, email_preview_html
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dispatchLogId,
      bookingId,
      recipientEmail,
      subject,
      attachments.length,
      dispatchedBy,
      status,
      errorMessage,
      htmlContent
    );
  }

  return {
    success: status === 'SUCCESS',
    dispatchLogId,
    recipientEmail,
    attachedIdsCount: attachments.length,
    booking: getBookingById(bookingId)
  };
}

/**
 * Generates an HTML preview of the society email without sending.
 */
function previewSocietyEmail(bookingId) {
  const booking = getBookingById(bookingId);
  if (!booking) throw new Error(`Booking ${bookingId} not found.`);

  const listing = booking.listing || null;

  const societyName = (listing && listing.society_name) || getSetting('society_name', 'Green Valley Heights Security Desk');
  const hostName = (listing && listing.host_name) || getSetting('host_name', 'Palette & Pillows Hosting');
  const hostPhone = (listing && listing.host_phone) || getSetting('host_phone', '+91 98765 43210');
  const hostEmail = (listing && listing.host_email) || getSetting('host_email', 'host@paletteandpillows.com');
  const recipientEmail = (listing && listing.society_email) || getSetting('society_email', 'society.security@greenvalleyrwa.org');

  const checkInStr = formatDateTime(booking.check_in_date_time);
  const checkOutStr = formatDateTime(booking.check_out_date_time);
  const vehicleStr = booking.vehicle_number ? booking.vehicle_number : 'None / Cab / Public Transit';

  const templateVars = {
    unit: booking.unit_flat_number,
    guest_name: booking.guest_primary_name,
    check_in: checkInStr,
    check_out: checkOutStr,
    adult_count: booking.total_adults,
    children_count: booking.total_children,
    vehicle: vehicleStr,
    booking_id: booking.id,
    society_name: societyName,
    host_name: hostName
  };

  const subjectTemplate = (listing && listing.email_subject_template) || getSetting(
    'email_subject_template',
    '[Guest Arrival] Flat {unit} - {guest_name} ({adult_count} Adults) - {check_in}'
  );
  const subject = interpolateTemplate(subjectTemplate, templateVars);
  const html = buildSocietyEmailHtml(booking, societyName, hostName, hostPhone, hostEmail);

  return {
    subject,
    recipientEmail,
    html,
    booking
  };
}

module.exports = {
  dispatchSocietyEmail,
  previewSocietyEmail,
  buildSocietyEmailHtml,
  interpolateTemplate
};
