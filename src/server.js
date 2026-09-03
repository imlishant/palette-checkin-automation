const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase, db } = require('./config/database');
const { startScheduler } = require('./services/schedulerService');
const { createBooking, getAllBookings } = require('./services/bookingService');
const apiRoutes = require('./routes/api');
const guestRoutes = require('./routes/guest');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Database
initDatabase();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// Secure uploads directory (for previews within the admin dashboard)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Mount API Routes - Guest portal routes MUST be mounted before protected admin routes
app.use('/api/guest', guestRoutes);
app.use('/api', apiRoutes);

// Route for friendly guest portal URL: /checkin/:token -> redirect to checkin.html?token=:token
app.get('/checkin/:token', (req, res) => {
  res.redirect(`/checkin.html?token=${req.params.token}`);
});

// Seed realistic test data if the database is newly initialized
function seedInitialDataIfEmpty() {
  const count = db.prepare(`SELECT COUNT(*) as count FROM bookings`).get().count;
  if (count === 0) {
    console.log('[SEED] Seeding realistic sample Airbnb bookings for Palette & Pillows...');

    const now = new Date();
    
    // 1. Check-in Today (Urgent - 2 of 4 IDs missing)
    const todayCheckin = new Date(now);
    todayCheckin.setHours(14, 0, 0, 0);
    const todayCheckout = new Date(todayCheckin);
    todayCheckout.setDate(todayCheckout.getDate() + 3);
    todayCheckout.setHours(11, 0, 0, 0);

    const bk1 = createBooking({
      id: 'BK-4012',
      guest_primary_name: 'Rahul Sharma',
      guest_phone: '+91 98112 34567',
      guest_email: 'rahul.sharma@example.com',
      unit_flat_number: 'A-1204',
      check_in_date_time: todayCheckin.toISOString(),
      check_out_date_time: todayCheckout.toISOString(),
      total_adults: 4,
      total_children: 1,
      vehicle_number: 'DL-01-AB-1234',
      source: 'Airbnb'
    });

    // 2. Check-in Today (Ready to Dispatch - 2 of 2 IDs uploaded)
    const readyCheckin = new Date(now);
    readyCheckin.setHours(17, 30, 0, 0);
    const readyCheckout = new Date(readyCheckin);
    readyCheckout.setDate(readyCheckout.getDate() + 2);
    readyCheckout.setHours(11, 0, 0, 0);

    const bk2 = createBooking({
      id: 'BK-4015',
      guest_primary_name: 'Neha Kapoor',
      guest_phone: '+91 99887 76655',
      guest_email: 'neha.kapoor@example.com',
      unit_flat_number: 'B-602',
      check_in_date_time: readyCheckin.toISOString(),
      check_out_date_time: readyCheckout.toISOString(),
      total_adults: 2,
      total_children: 0,
      vehicle_number: 'KA-03-MN-8899',
      source: 'Airbnb'
    });

    // 3. Check-in Tomorrow (Upcoming - 1 of 3 IDs missing)
    const tomorrowCheckin = new Date(now);
    tomorrowCheckin.setDate(tomorrowCheckin.getDate() + 1);
    tomorrowCheckin.setHours(15, 0, 0, 0);
    const tomorrowCheckout = new Date(tomorrowCheckin);
    tomorrowCheckout.setDate(tomorrowCheckout.getDate() + 4);
    tomorrowCheckout.setHours(11, 0, 0, 0);

    const bk3 = createBooking({
      id: 'BK-4020',
      guest_primary_name: 'Amit Patel',
      guest_phone: '+91 91234 56789',
      guest_email: 'amit.patel@example.com',
      unit_flat_number: 'C-1008',
      check_in_date_time: tomorrowCheckin.toISOString(),
      check_out_date_time: tomorrowCheckout.toISOString(),
      total_adults: 3,
      total_children: 0,
      vehicle_number: 'MH-02-XY-9900',
      source: 'Airbnb'
    });

    // 4. Past Check-in (Society Email Sent)
    const pastCheckin = new Date(now);
    pastCheckin.setDate(pastCheckin.getDate() - 1);
    pastCheckin.setHours(13, 0, 0, 0);
    const pastCheckout = new Date(pastCheckin);
    pastCheckout.setDate(pastCheckout.getDate() + 3);
    pastCheckout.setHours(11, 0, 0, 0);

    const bk4 = createBooking({
      id: 'BK-3990',
      guest_primary_name: 'Siddharth Roy',
      guest_phone: '+91 98711 22334',
      guest_email: 'sid.roy@example.com',
      unit_flat_number: 'A-405',
      check_in_date_time: pastCheckin.toISOString(),
      check_out_date_time: pastCheckout.toISOString(),
      total_adults: 2,
      total_children: 0,
      vehicle_number: 'HR-26-DQ-5544',
      source: 'Airbnb'
    });

    // Mark bk4 as already sent
    db.prepare(`
      UPDATE bookings
      SET society_email_status = 'SENT',
          society_email_sent_at = datetime('now', '-1 day', 'localtime')
      WHERE id = 'BK-3990'
    `).run();

    console.log('[SEED] 4 sample bookings created successfully.');
  }
}

seedInitialDataIfEmpty();

// Start background scheduler
startScheduler();

// Start Server
app.listen(PORT, () => {
  console.log(`
  ✨ ================================================================= ✨
     PALETTE & PILLOWS - GUEST CHECK-IN & SOCIETY EMAIL AUTOMATION
     Server running at: http://localhost:${PORT}
     Host Operations Dashboard: http://localhost:${PORT}/
  ✨ ================================================================= ✨
  `);
});
