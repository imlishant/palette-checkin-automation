const cron = require('node-cron');
const { getAllBookings } = require('./bookingService');
const { dispatchSocietyEmail } = require('./dispatchService');
const { getSetting } = require('./messageTemplateService');

let cronTask = null;

/**
 * Runs a single cycle of the automated arrival scanner.
 */
async function runArrivalComplianceCheck() {
  const autoDispatchEnabled = getSetting('auto_dispatch_enabled', 'true') === 'true';
  const dispatchHoursBefore = parseInt(getSetting('dispatch_hours_before', '24'), 10);

  if (!autoDispatchEnabled) {
    console.log('[SCHEDULER] Auto-dispatch is disabled in settings.');
    return { checked: 0, dispatched: 0 };
  }

  const now = new Date();
  const bookings = getAllBookings();
  let checked = 0;
  let dispatched = 0;

  for (const booking of bookings) {
    checked++;
    // Check if already dispatched or cancelled
    if (booking.society_email_status === 'SENT' || booking.society_email_status === 'OVERRIDDEN') {
      continue;
    }

    const checkInTime = new Date(booking.check_in_date_time);
    const hoursUntilCheckin = (checkInTime - now) / (1000 * 60 * 60);

    // If within dispatch window (e.g. within 24h of check-in or past check-in today)
    if (hoursUntilCheckin <= dispatchHoursBefore && hoursUntilCheckin >= -24) {
      if (booking.is_complete) {
        console.log(`[SCHEDULER] Booking ${booking.id} (${booking.guest_primary_name}) is 100% complete and within ${dispatchHoursBefore}h of check-in. Auto-dispatching society email...`);
        try {
          await dispatchSocietyEmail(booking.id, {
            dispatchedBy: 'AUTO_SCHEDULER'
          });
          dispatched++;
        } catch (err) {
          console.error(`[SCHEDULER ERROR] Failed to auto-dispatch ${booking.id}:`, err.message);
        }
      } else {
        console.log(`[SCHEDULER] Booking ${booking.id} check-in is in ${hoursUntilCheckin.toFixed(1)}h but missing ${booking.missing_count} adult ID(s). Escalation active.`);
      }
    }
  }

  return { checked, dispatched };
}

/**
 * Starts the recurring scheduler (every 15 minutes).
 */
function startScheduler() {
  if (cronTask) {
    return;
  }

  // Run every 15 minutes: */15 * * * *
  cronTask = cron.schedule('*/15 * * * *', async () => {
    console.log(`[SCHEDULER] Running periodic arrival check (${new Date().toLocaleTimeString()})...`);
    try {
      await runArrivalComplianceCheck();
    } catch (e) {
      console.error('[SCHEDULER ERROR] Periodic check error:', e);
    }
  });

  console.log('[SCHEDULER] Background arrival compliance scheduler started (Runs every 15 minutes).');
}

module.exports = {
  startScheduler,
  runArrivalComplianceCheck
};
