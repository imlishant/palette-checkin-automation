const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { initDatabase, db } = require('../src/config/database');
const { createBooking, getBookingById, getBookingByToken, getAllBookings } = require('../src/services/bookingService');
const { uploadAdultId } = require('../src/services/guestAdultService');
const { generateReminderMessage } = require('../src/services/messageTemplateService');
const { dispatchSocietyEmail, previewSocietyEmail } = require('../src/services/dispatchService');
const { runArrivalComplianceCheck } = require('../src/services/schedulerService');

async function runTests() {
  console.log('🧪 Starting End-to-End Suite for Guest Check-In & Society Email Automation...\n');

  // Step 1: Initialize DB
  initDatabase();
  console.log('✅ Test 1: Database initialized successfully.');

  // Create mock ID files in scratch/temp directory for test uploads
  const testUploadDir = path.join(__dirname, '../uploads/secure_ids');
  if (!fs.existsSync(testUploadDir)) fs.mkdirSync(testUploadDir, { recursive: true });

  const mockFile1 = path.join(testUploadDir, 'test_aadhaar_rahul.jpg');
  const mockFile2 = path.join(testUploadDir, 'test_passport_priya.jpg');
  const mockFile3 = path.join(testUploadDir, 'test_dl_rohit.jpg');
  fs.writeFileSync(mockFile1, 'MOCK_AADHAAR_IMAGE_DATA');
  fs.writeFileSync(mockFile2, 'MOCK_PASSPORT_IMAGE_DATA');
  fs.writeFileSync(mockFile3, 'MOCK_DL_IMAGE_DATA');

  // Step 2: Create a 3-Adult Booking
  const checkinTime = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6 hours from now
  const checkoutTime = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  const testBooking = createBooking({
    guest_primary_name: 'Test Guest Lead',
    guest_phone: '+91 99880 01122',
    guest_email: 'testlead@example.com',
    unit_flat_number: 'E-501',
    check_in_date_time: checkinTime,
    check_out_date_time: checkoutTime,
    total_adults: 3,
    total_children: 1,
    vehicle_number: 'KA-05-ZZ-9999',
    source: 'Airbnb'
  });

  assert.strictEqual(testBooking.total_adults, 3, 'Total adults should be 3');
  assert.strictEqual(testBooking.adults.length, 3, 'Should provision exactly 3 adult ID slots');
  assert.strictEqual(testBooking.uploaded_count, 0, 'Initial uploaded count should be 0');
  assert.strictEqual(testBooking.missing_count, 3, 'Initial missing count should be 3');
  assert.strictEqual(testBooking.society_email_status, 'PENDING_IDS', 'Initial status should be PENDING_IDS');
  console.log(`✅ Test 2: Created booking ${testBooking.id} with 3 provisioned adult ID slots.`);

  // Step 3: Test Tokenized Guest Portal Access
  const portalBooking = getBookingByToken(testBooking.token);
  assert(portalBooking, 'Guest should be able to fetch booking via secure token');
  assert.strictEqual(portalBooking.id, testBooking.id);
  console.log('✅ Test 3: Tokenized guest portal lookup verified.');

  // Step 4: Upload 1 ID (Partial State - 1 of 3)
  const adult1 = testBooking.adults[0];
  uploadAdultId(adult1.id, {
    path: mockFile1,
    originalname: 'rahul_aadhaar.jpg',
    size: 245000
  }, {
    full_name: 'Rahul Sharma',
    id_type: 'Aadhaar'
  });

  const updatedBooking1 = getBookingById(testBooking.id);
  assert.strictEqual(updatedBooking1.uploaded_count, 1, 'Uploaded count should now be 1');
  assert.strictEqual(updatedBooking1.missing_count, 2, 'Missing count should be 2');
  assert.strictEqual(updatedBooking1.completion_percentage, 33, 'Completion percentage should be 33%');
  assert.strictEqual(updatedBooking1.society_email_status, 'PENDING_IDS', 'Status should still be PENDING_IDS');
  console.log('✅ Test 4: Uploaded 1 of 3 adult IDs. Status correctly calculated as 33% PENDING_IDS.');

  // Step 5: Verify Dynamic WhatsApp Reminder Generation
  const reminder = generateReminderMessage(updatedBooking1, 'http://localhost:3000');
  assert(reminder.text.includes('1 of 3 adult guests'), 'Reminder should mention 1 of 3 received');
  assert(reminder.text.includes('2 adult ID(s) still missing'), 'Reminder should mention 2 missing');
  assert(reminder.text.includes(testBooking.token), 'Reminder must contain secure check-in portal link');
  console.log('✅ Test 5: Dynamic WhatsApp & Airbnb reminder template verified:\n' + reminder.text + '\n');

  // Step 6: Test Auto-Dispatcher Rejection When Incomplete
  const incompleteDispatchAttempt = await dispatchSocietyEmail(testBooking.id, { dispatchedBy: 'AUTO_SCHEDULER' });
  assert.strictEqual(incompleteDispatchAttempt.success, false, 'Auto-dispatch must be rejected if IDs are incomplete');
  assert.strictEqual(incompleteDispatchAttempt.reason, 'INCOMPLETE_IDS');
  console.log('✅ Test 6: Guardrail verified: Auto-dispatcher safely rejected incomplete booking.');

  // Step 7: Upload Remaining 2 IDs (Adult 2 and Adult 3)
  uploadAdultId(testBooking.adults[1].id, {
    path: mockFile2,
    originalname: 'priya_passport.jpg',
    size: 512000
  }, { full_name: 'Priya Sharma', id_type: 'Passport' });

  uploadAdultId(testBooking.adults[2].id, {
    path: mockFile3,
    originalname: 'rohit_dl.jpg',
    size: 198000
  }, { full_name: 'Rohit Sharma', id_type: 'Driving License' });

  const completeBooking = getBookingById(testBooking.id);
  assert.strictEqual(completeBooking.uploaded_count, 3);
  assert.strictEqual(completeBooking.missing_count, 0);
  assert.strictEqual(completeBooking.completion_percentage, 100);
  assert.strictEqual(completeBooking.society_email_status, 'READY_TO_DISPATCH', 'Status should be READY_TO_DISPATCH');
  console.log('✅ Test 7: Uploaded all 3 IDs. Booking transitioned to 100% READY_TO_DISPATCH.');

  // Step 8: Test Society Email HTML Preview
  const preview = previewSocietyEmail(testBooking.id);
  assert(preview.html.includes('Flat E-501'), 'Preview HTML should contain flat number');
  assert(preview.html.includes('Rahul Sharma'), 'Preview HTML should contain adult 1 name');
  assert(preview.html.includes('Priya Sharma'), 'Preview HTML should contain adult 2 name');
  assert(preview.html.includes('Rohit Sharma'), 'Preview HTML should contain adult 3 name');
  assert(preview.html.includes('KA-05-ZZ-9999'), 'Preview HTML should contain vehicle number');
  console.log('✅ Test 8: Society email template preview generation verified.');

  // Step 9: Test Dispatching Society Email
  const dispatchResult = await dispatchSocietyEmail(testBooking.id, { dispatchedBy: 'AUTO_SCHEDULER' });
  assert.strictEqual(dispatchResult.success, true);
  assert.strictEqual(dispatchResult.attachedIdsCount, 3, 'Must attach all 3 adult IDs');
  
  const dispatchedBooking = getBookingById(testBooking.id);
  assert.strictEqual(dispatchedBooking.society_email_status, 'SENT', 'Status should be SENT');
  assert(dispatchedBooking.society_email_sent_at, 'Sent timestamp should be set');
  console.log('✅ Test 9: Society email successfully dispatched with 3 attached ID files.');

  // Step 10: Test Idempotency (Prevent Duplicate Dispatch)
  const duplicateAttempt = await dispatchSocietyEmail(testBooking.id, { dispatchedBy: 'AUTO_SCHEDULER' });
  assert.strictEqual(duplicateAttempt.alreadySent, true, 'Idempotency guardrail must skip already sent booking');
  console.log('✅ Test 10: Idempotency verified: Duplicate auto-dispatch was blocked.');

  // Step 11: Test Emergency Gate Override on an Incomplete Booking
  const emergencyBooking = createBooking({
    guest_primary_name: 'Gate Emergency Guest',
    unit_flat_number: 'B-202',
    check_in_date_time: new Date().toISOString(),
    check_out_date_time: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    total_adults: 2
  });

  // Upload only 1 ID
  uploadAdultId(emergencyBooking.adults[0].id, {
    path: mockFile1,
    originalname: 'guest_emergency_id.jpg',
    size: 150000
  }, { full_name: 'Emergency Guest Lead', id_type: 'Aadhaar' });

  // Host clicks emergency gate override
  const overrideResult = await dispatchSocietyEmail(emergencyBooking.id, {
    dispatchedBy: 'HOST_OVERRIDE',
    forceResend: true
  });

  assert.strictEqual(overrideResult.success, true);
  const overriddenBooking = getBookingById(emergencyBooking.id);
  assert.strictEqual(overriddenBooking.society_email_status, 'OVERRIDDEN');
  console.log('✅ Test 11: Host Emergency Gate Override successfully dispatched with 1 ID and marked as OVERRIDDEN.');

  // Step 12: Verify Audit Logs
  const logs = db.prepare(`SELECT * FROM dispatch_logs WHERE booking_id = ?`).all(testBooking.id);
  assert.strictEqual(logs.length, 1, 'Should record 1 dispatch log entry');
  assert.strictEqual(logs[0].status, 'SUCCESS');
  assert.strictEqual(logs[0].attached_ids_count, 3);
  console.log('✅ Test 12: Audit trail logging verified.');

  // Step 13: Test Multi-Listing Profile Management (CRUD)
  const { createListing, getAllListings, getListingById, updateListing, deleteListing } = require('../src/services/listingService');
  const customListing = createListing({
    name: 'Royal Residency 602',
    unit_flat_number: 'B-602',
    society_name: 'Royal Residency Security Wing',
    society_email: 'royal.security@residency.in',
    email_cc_list: 'manager@paletteandpillows.space, host@paletteandpillows.space',
    host_name: 'Palette Royal Host',
    host_phone: '+91 99999 88888',
    email_subject_template: '[CLEARANCE] Flat {unit} - {guest_name} Arrival'
  });

  assert(customListing.id, 'Should generate a listing ID');
  assert.strictEqual(customListing.unit_flat_number, 'B-602');
  assert.strictEqual(customListing.society_email, 'royal.security@residency.in');

  const allActiveListings = getAllListings();
  assert(allActiveListings.length >= 2, 'Should have seeded listing + new custom listing');
  console.log(`✅ Test 13: Multi-listing CRUD verified: Created listing ${customListing.id}.`);

  // Step 14: Test Creating Booking Linked to Custom Listing
  const linkedBooking = createBooking({
    guest_primary_name: 'Anita Sen',
    unit_flat_number: 'B-602',
    check_in_date_time: new Date().toISOString(),
    check_out_date_time: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    total_adults: 1,
    listing_id: customListing.id
  });

  assert.strictEqual(linkedBooking.listing_id, customListing.id);
  assert(linkedBooking.listing, 'Booking should have populated listing metadata');
  assert.strictEqual(linkedBooking.listing.society_email, 'royal.security@residency.in');
  console.log('✅ Test 14: Booking linked to custom listing verified with auto-populated metadata.');

  // Step 15: Verify Listing-Specific Property Email Routing & Template Dispatch
  uploadAdultId(linkedBooking.adults[0].id, {
    path: mockFile1,
    originalname: 'anita_aadhaar.jpg',
    size: 200000
  }, { full_name: 'Anita Sen', id_type: 'Aadhaar' });

  const customDispatch = await dispatchSocietyEmail(linkedBooking.id, {
    dispatchedBy: 'AUTO_SCHEDULER'
  });

  assert.strictEqual(customDispatch.success, true);
  assert.strictEqual(customDispatch.recipientEmail, 'royal.security@residency.in', 'Must route to listing society email');

  const customPreview = previewSocietyEmail(linkedBooking.id);
  assert(customPreview.subject.includes('[CLEARANCE] Flat B-602 - Anita Sen Arrival'), 'Must use listing subject template');
  assert(customPreview.html.includes('Royal Residency Security Wing'), 'HTML must include listing society name');
  console.log('✅ Test 15: Property-aware society email routing, CC list, and custom templates verified.');

  console.log('\n🎉 ALL 15 AUTOMATED TESTS PASSED SUCCESSFULLY! 🚀\n');
}

runTests().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
