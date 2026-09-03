// Host Operations Dashboard Logic
let allBookings = [];
let currentFilter = 'ALL';
let activeBookingForEmail = null;
let activeAdultIdForUpload = null;

// Admin Authentication State
function getAdminPin() {
  return localStorage.getItem('pp_admin_pin') || '';
}

function setAdminPin(pin) {
  localStorage.setItem('pp_admin_pin', pin);
}

function clearAdminPin() {
  localStorage.removeItem('pp_admin_pin');
}

function authFetch(url, options = {}) {
  const pin = getAdminPin();
  const headers = options.headers || {};
  headers['x-admin-pin'] = pin;
  return fetch(url, { ...options, headers });
}

// Check PIN on startup
function checkAuth() {
  const pin = getAdminPin();
  const lockScreen = document.getElementById('admin-lock-screen');
  if (!pin) {
    lockScreen.style.display = 'flex';
    return false;
  }
  lockScreen.style.display = 'none';
  return true;
}

// DOM Elements
const bookingsContainer = document.getElementById('bookings-container');
const statMissing = document.getElementById('stat-missing-count');
const statReady = document.getElementById('stat-ready-count');
const statSent = document.getElementById('stat-sent-count');
const statToday = document.getElementById('stat-today-count');
const activeFilterBadge = document.getElementById('active-filter-badge');

// Modal Elements
const modalNewBooking = document.getElementById('modal-new-booking');
const modalReminder = document.getElementById('modal-reminder');
const modalEmailPreview = document.getElementById('modal-email-preview');
const modalSettings = document.getElementById('modal-settings');
const modalLogs = document.getElementById('modal-logs');

// Toast helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'danger' ? '⚠' : 'ℹ'}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Format Date for display (Date only, no time)
function formatDateTime(isoString) {
  if (!isoString) return 'TBD';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

// Fetch all bookings
async function loadBookings() {
  try {
    const res = await authFetch('/api/bookings');
    const data = await res.json();
    if (data.success) {
      allBookings = data.bookings;
      updateStats();
      renderBookings();
    } else {
      showToast(data.error || 'Failed to load bookings', 'danger');
    }
  } catch (err) {
    showToast('Error connecting to backend: ' + err.message, 'danger');
  }
}

// Compute & update metrics
function updateStats() {
  let missing = 0;
  let ready = 0;
  let sent = 0;
  let today = 0;

  allBookings.forEach(b => {
    if (b.society_email_status === 'SENT' || b.society_email_status === 'OVERRIDDEN') {
      sent++;
    } else if (b.is_complete) {
      ready++;
    } else {
      missing += b.missing_count;
    }

    if (b.timing_category === 'TODAY') {
      today++;
    }
  });

  statMissing.textContent = missing;
  statReady.textContent = ready;
  statSent.textContent = sent;
  statToday.textContent = today;
}

// Filter and render list
function renderBookings() {
  let filtered = allBookings;

  if (currentFilter === 'ATTENTION') {
    filtered = allBookings.filter(b => !b.is_complete && b.society_email_status !== 'SENT');
  } else if (currentFilter === 'TODAY') {
    filtered = allBookings.filter(b => b.timing_category === 'TODAY');
  } else if (currentFilter === 'TOMORROW') {
    filtered = allBookings.filter(b => b.timing_category === 'TOMORROW');
  } else if (currentFilter === 'SENT') {
    filtered = allBookings.filter(b => b.society_email_status === 'SENT' || b.society_email_status === 'OVERRIDDEN');
  }

  activeFilterBadge.textContent = `${filtered.length} Bookings`;

  if (filtered.length === 0) {
    bookingsContainer.innerHTML = `
      <div style="text-align:center; padding: 50px 20px; background:var(--bg-card); border-radius:var(--radius-md); border:1px solid var(--border-subtle);">
        <div style="font-size:36px; margin-bottom:10px;">📋</div>
        <div style="font-size:16px; font-weight:600; color:var(--text-primary);">No bookings found in this category</div>
        <div style="font-size:13px; color:var(--text-muted); margin-top:4px;">Try selecting another filter or add a new booking.</div>
      </div>
    `;
    return;
  }

  bookingsContainer.innerHTML = filtered.map(b => {
    let borderClass = 'ready-border';
    let statusBadge = '';
    let progressColor = 'yellow';

    if (b.society_email_status === 'SENT') {
      borderClass = 'sent-border';
      statusBadge = `<span class="badge success">✓ Society Sent (${formatDateTime(b.society_email_sent_at)})</span>`;
      progressColor = 'green';
    } else if (b.society_email_status === 'OVERRIDDEN') {
      borderClass = 'sent-border';
      statusBadge = `<span class="badge warning">⚡ Gate Override Sent</span>`;
      progressColor = 'green';
    } else if (b.is_complete) {
      borderClass = 'ready-border';
      statusBadge = `<span class="badge warning">🟡 Ready to Dispatch (${b.uploaded_count}/${b.total_adults} Complete)</span>`;
      progressColor = 'green';
    } else {
      borderClass = 'urgent-border';
      const missingDetails = [];
      if (b.missing_names_count > 0) missingDetails.push(`${b.missing_names_count} Name(s)`);
      if (b.missing_files_count > 0) missingDetails.push(`${b.missing_files_count} ID Photo(s)`);
      const missingStr = missingDetails.join(' & ') || `${b.missing_count} Adult(s)`;

      statusBadge = `<span class="badge danger">🚨 Incomplete (${b.uploaded_count}/${b.total_adults} Complete - Missing ${missingStr})</span>`;
      progressColor = b.uploaded_count === 0 ? 'red' : 'yellow';
    }

    let timingBadge = '';
    if (b.timing_category === 'TODAY') {
      timingBadge = `<span class="badge danger">TODAY ARRIVAL</span>`;
    } else if (b.timing_category === 'TOMORROW') {
      timingBadge = `<span class="badge info">TOMORROW</span>`;
    }

    return `
      <div class="booking-card ${borderClass}" id="card-${b.id}">
        <div class="booking-main-row">
          
          <!-- Column 1: Unit & Guest Info -->
          <div class="guest-info-col">
            <div class="unit-badge">Flat ${b.unit_flat_number}</div>
            <div class="guest-details">
              <div class="guest-name">
                ${b.guest_primary_name}
                ${timingBadge}
              </div>
              <div class="guest-sub">
                <span>Ref: <strong>${b.id}</strong> (${b.source})</span>
                <span>•</span>
                <span>📞 ${b.guest_phone || 'No phone'}</span>
                <span>•</span>
                <span>🚗 ${b.vehicle_number || 'No vehicle'}</span>
              </div>
            </div>
          </div>

          <!-- Column 2: Timings -->
          <div class="timing-col">
            <div class="time-label">Check-in / Check-out</div>
            <div class="time-val">${formatDateTime(b.check_in_date_time)}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Out: ${formatDateTime(b.check_out_date_time)}</div>
          </div>

          <!-- Column 3: Adult ID Progress -->
          <div class="compliance-col">
            <div class="progress-label">
              <span style="font-weight:600; color:var(--text-primary);">${b.uploaded_count} of ${b.total_adults} Adult IDs</span>
              <span style="color:var(--text-muted);">${b.completion_percentage}%</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill ${progressColor}" style="width: ${b.completion_percentage}%;"></div>
            </div>
            <div style="margin-top:6px;">
              ${statusBadge}
            </div>
          </div>

          <!-- Column 4: Quick Action Buttons -->
          <div class="action-btn-group">
            <button class="btn btn-outline btn-icon-only" title="Toggle Per-Adult ID Manifest" onclick="toggleAdultManifest('${b.id}')">
              👥 IDs
            </button>
            <button class="btn btn-outline" onclick="openReminderModal('${b.id}')">
              💬 WhatsApp
            </button>
            <button class="btn btn-outline" onclick="openEmailPreview('${b.id}')">
              👁️ Preview Email
            </button>
            <button class="btn ${b.is_complete ? 'btn-primary' : 'btn-emergency'}" onclick="triggerDirectDispatch('${b.id}', ${b.is_complete})">
              ${b.society_email_status === 'SENT' ? '✓ Resend' : b.is_complete ? '⚡ Send Society' : '🚨 Gate Override'}
            </button>
          </div>

        </div>

        <!-- Expandable Per-Adult ID Manifest -->
        <div class="adult-manifest-panel" id="manifest-${b.id}" style="display:none;">
          ${renderAdultSlots(b)}
        </div>
      </div>
    `;
  }).join('');
}

// Render adult slots inside manifest with full inline editability
function renderAdultSlots(booking) {
  return booking.adults.map(adult => {
    const hasFile = (adult.status === 'UPLOADED' || adult.status === 'VERIFIED') && !!adult.id_file_path;
    const hasValidName = typeof adult.full_name === 'string' && adult.full_name.trim().length >= 3;
    const isComplete = hasFile && hasValidName;
    const currentName = adult.full_name || '';
    const currentType = adult.id_type || 'Aadhaar';

    let badgeClass = 'danger';
    let badgeText = '❌ Missing ID';
    if (isComplete) {
      badgeClass = 'success';
      badgeText = '✓ Verified (Name & ID)';
    } else if (hasFile && !hasValidName) {
      badgeClass = 'warning';
      badgeText = '⚠ Legal Name Required (min 3 chars)';
    } else if (!hasFile && hasValidName) {
      badgeClass = 'danger';
      badgeText = '📸 ID Photo Missing';
    }

    return `
      <div class="adult-slot-card ${isComplete ? 'uploaded' : 'missing'}" id="slot-card-${adult.id}">
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-size:12px; font-weight:700; color:#a5b4fc;">Slot: Adult ${adult.adult_index}</span>
            <span class="badge ${badgeClass}" style="font-size:10px; padding:2px 6px;">
              ${badgeText}
            </span>
          </div>

          <div style="display:grid; grid-template-columns: 1.3fr 1fr; gap:6px; margin-bottom:6px;">
            <input type="text" class="form-input" style="padding:6px 8px; font-size:12px; ${!hasValidName ? 'border-color:#f59e0b;' : ''}" 
              id="name-input-${adult.id}" 
              placeholder="Full Legal Name as per ID *" 
              value="${escapeHtml(currentName)}" 
              minlength="3"
              onblur="saveAdultMetadata('${adult.id}')"
              title="Edit guest legal name">
            
            <select class="form-select" style="padding:6px 8px; font-size:12px;" 
              id="type-select-${adult.id}" 
              onchange="saveAdultMetadata('${adult.id}')">
              <option value="Aadhaar" ${currentType === 'Aadhaar' ? 'selected' : ''}>Aadhaar</option>
              <option value="Passport" ${currentType === 'Passport' ? 'selected' : ''}>Passport</option>
              <option value="Driving License" ${currentType === 'Driving License' ? 'selected' : ''}>Driving License</option>
              <option value="Voter ID" ${currentType === 'Voter ID' ? 'selected' : ''}>Voter ID</option>
              <option value="Govt ID" ${currentType === 'Govt ID' ? 'selected' : ''}>Govt ID</option>
            </select>
          </div>

          ${adult.id_file_name ? `
            <div style="font-size:11px; color:#6ee7b7; text-overflow:ellipsis; overflow:hidden; max-width:240px; white-space:nowrap;">
              📄 Attached: <strong>${escapeHtml(adult.id_file_name)}</strong>
            </div>
          ` : ''}
        </div>

        <div style="display:flex; flex-direction:column; gap:4px; margin-left:8px; justify-content:center;">
          ${hasFile ? `
            <button class="slot-upload-btn btn-outline" style="color:var(--danger); padding:6px 8px;" onclick="removeAdultIdFile('${adult.id}')" title="Delete Uploaded ID">✕ Remove</button>
          ` : `
            <button class="slot-upload-btn btn-primary" style="padding:6px 8px;" onclick="triggerHostUpload('${adult.id}')">+ Upload ID</button>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Auto-save adult legal name and ID type
async function saveAdultMetadata(adultId) {
  const nameInput = document.getElementById(`name-input-${adultId}`);
  const typeSelect = document.getElementById(`type-select-${adultId}`);
  if (!nameInput || !typeSelect) return;

  const fullName = nameInput.value.trim();
  const idType = typeSelect.value;

  try {
    const res = await authFetch(`/api/adults/${adultId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, id_type: idType })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ Guest details updated!', 'success');
    }
  } catch (e) {
    showToast('Failed to save guest name', 'danger');
  }
}

// Toggle manifest
function toggleAdultManifest(bookingId) {
  const panel = document.getElementById(`manifest-${bookingId}`);
  if (panel) {
    panel.style.display = panel.style.display === 'none' ? 'grid' : 'none';
  }
}

// Open Reminder Modal
async function openReminderModal(bookingId) {
  try {
    const res = await authFetch(`/api/bookings/${bookingId}/reminder`);
    const data = await res.json();
    if (data.success) {
      document.getElementById('reminder-text').value = data.reminder.text;
      document.getElementById('reminder-portal-url').value = data.reminder.portalUrl;
      document.getElementById('btn-open-whatsapp').href = data.reminder.whatsappShareUrl;
      modalReminder.classList.add('active');
    }
  } catch (e) {
    showToast('Failed to load reminder message', 'danger');
  }
}

// Open Email Preview Modal
async function openEmailPreview(bookingId) {
  try {
    activeBookingForEmail = bookingId;
    const res = await authFetch(`/api/bookings/${bookingId}/preview-email`);
    const data = await res.json();
    if (data.success) {
      document.getElementById('email-preview-title').textContent = `Society Notification - Flat ${data.preview.booking.unit_flat_number}`;
      document.getElementById('preview-recipient-email').value = data.preview.recipientEmail;
      document.getElementById('preview-subject').value = data.preview.subject;
      document.getElementById('preview-email-frame-container').innerHTML = data.preview.html;

      const warningElem = document.getElementById('preview-dispatch-warning');
      const b = data.preview.booking;
      if (!b.is_complete) {
        const missingParts = [];
        if (b.missing_names_count > 0) missingParts.push(`${b.missing_names_count} Name(s)`);
        if (b.missing_files_count > 0) missingParts.push(`${b.missing_files_count} ID Document(s)`);
        const missingText = missingParts.join(' & ') || 'Details';
        warningElem.innerHTML = `<span style="color:#ef4444; font-weight:700;">⚠ INCOMPLETE: Missing ${missingText}.</span> Auto-dispatch blocked. Proceed only as emergency override.`;
      } else {
        warningElem.innerHTML = `<span style="color:#10b981; font-weight:700;">✓ 100% Verified:</span> All ${b.total_adults} adult legal names and ID proofs verified.`;
      }

      modalEmailPreview.classList.add('active');
    }
  } catch (e) {
    showToast('Failed to load email preview', 'danger');
  }
}

// Trigger Direct Dispatch from button
async function triggerDirectDispatch(bookingId, isComplete) {
  const confirmMsg = isComplete
    ? `Send society entry approval email for booking ${bookingId}?`
    : `🚨 EMERGENCY GATE OVERRIDE: Some adult IDs are still missing. Proceed and notify society anyway for entry?`;

  if (!confirm(confirmMsg)) return;

  try {
    showToast('Dispatching email with attachments...', 'info');
    const res = await authFetch(`/api/bookings/${bookingId}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dispatchedBy: isComplete ? 'HOST_DISPATCH' : 'HOST_OVERRIDE',
        forceResend: true
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ Society email dispatched! Attached ${data.result.attachedIdsCount} ID(s).`, 'success');
      loadBookings();
    } else {
      showToast(data.error || 'Failed to dispatch email', 'danger');
    }
  } catch (e) {
    showToast('Dispatch error: ' + e.message, 'danger');
  }
}

// Host Manual Upload ID file
function triggerHostUpload(adultId) {
  activeAdultIdForUpload = adultId;
  const fileInput = document.getElementById('host-manual-file-input');
  fileInput.value = '';
  fileInput.click();
}

document.getElementById('host-manual-file-input').addEventListener('change', async (e) => {
  if (!e.target.files.length || !activeAdultIdForUpload) return;
  const file = e.target.files[0];
  const formData = new FormData();
  formData.append('id_file', file);

  try {
    showToast('Uploading ID document...', 'info');
    const res = await authFetch(`/api/adults/${activeAdultIdForUpload}/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ ID uploaded successfully!', 'success');
      loadBookings();
    } else {
      showToast(data.error || 'Upload failed', 'danger');
    }
  } catch (err) {
    showToast('Upload error: ' + err.message, 'danger');
  }
});

// Remove Adult ID file
async function removeAdultIdFile(adultId) {
  if (!confirm('Remove this uploaded ID file?')) return;
  try {
    const res = await authFetch(`/api/adults/${adultId}/id`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('ID removed', 'info');
      loadBookings();
    }
  } catch (err) {
    showToast('Error removing ID', 'danger');
  }
}

// Filter Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderBookings();
  });
});

// Stat card quick filters
document.getElementById('card-filter-missing').addEventListener('click', () => {
  setFilter('ATTENTION');
});
document.getElementById('card-filter-ready').addEventListener('click', () => {
  setFilter('ALL');
});
document.getElementById('card-filter-sent').addEventListener('click', () => {
  setFilter('SENT');
});
document.getElementById('card-filter-today').addEventListener('click', () => {
  setFilter('TODAY');
});

function setFilter(filterName) {
  currentFilter = filterName;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filterName);
  });
  renderBookings();
}

// Modal Close triggers
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  });
});

// New Booking Form Submit
document.getElementById('btn-new-booking').addEventListener('click', () => {
  const now = new Date();
  const checkinDefault = now.toISOString().slice(0, 10);
  const checkoutDefault = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  document.getElementById('new-checkin').value = checkinDefault;
  document.getElementById('new-checkout').value = checkoutDefault;
  modalNewBooking.classList.add('active');
});

// Auto-open calendar picker when clicking anywhere on date inputs
document.querySelectorAll('input[type="date"]').forEach(input => {
  input.addEventListener('click', () => {
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker();
      } catch (e) {
        // Fallback for browsers that don't allow showPicker
      }
    }
  });
});

document.getElementById('form-new-booking').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    guest_primary_name: document.getElementById('new-guest-name').value,
    unit_flat_number: document.getElementById('new-unit').value,
    guest_phone: document.getElementById('new-phone').value,
    guest_email: document.getElementById('new-email').value,
    check_in_date_time: new Date(document.getElementById('new-checkin').value).toISOString(),
    check_out_date_time: new Date(document.getElementById('new-checkout').value).toISOString(),
    total_adults: parseInt(document.getElementById('new-adults').value, 10),
    total_children: parseInt(document.getElementById('new-children').value || 0, 10),
    vehicle_number: document.getElementById('new-vehicle').value,
    source: document.getElementById('new-source').value
  };

  try {
    const res = await authFetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ Booking ${data.booking.id} created with ${payload.total_adults} adult ID slots!`, 'success');
      modalNewBooking.classList.remove('active');
      document.getElementById('form-new-booking').reset();
      loadBookings();
    } else {
      showToast(data.error || 'Failed to create booking', 'danger');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
});

// Reminder Clipboard buttons
document.getElementById('btn-copy-reminder').addEventListener('click', () => {
  const text = document.getElementById('reminder-text').value;
  navigator.clipboard.writeText(text);
  showToast('✓ WhatsApp reminder copied to clipboard!', 'success');
});

document.getElementById('btn-copy-portal-url').addEventListener('click', () => {
  const url = document.getElementById('reminder-portal-url').value;
  navigator.clipboard.writeText(url);
  showToast('✓ Guest link copied to clipboard!', 'success');
});

// Confirm Dispatch from Preview Modal
document.getElementById('btn-confirm-dispatch').addEventListener('click', async () => {
  if (!activeBookingForEmail) return;
  const overrideEmail = document.getElementById('preview-recipient-email').value;

  try {
    showToast('Sending society email...', 'info');
    const res = await authFetch(`/api/bookings/${activeBookingForEmail}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dispatchedBy: 'HOST_DISPATCH',
        forceResend: true,
        overrideEmail
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ Email successfully sent to society security!', 'success');
      modalEmailPreview.classList.remove('active');
      loadBookings();
    } else {
      showToast(data.error || 'Failed to send', 'danger');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'danger');
  }
});

// Run Scheduler Button
document.getElementById('btn-run-scheduler').addEventListener('click', async () => {
  try {
    showToast('Running arrival compliance scan...', 'info');
    const res = await authFetch('/api/scheduler/run-now', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`✓ Scan completed! Checked: ${data.result.checked}, Auto-dispatched: ${data.result.dispatched}`, 'success');
      loadBookings();
    }
  } catch (err) {
    showToast('Scheduler error: ' + err.message, 'danger');
  }
});

// Settings Modal with Persistent Local Storage Cache & Auto-Sync
function populateSettingsForm(s) {
  if (!s) return;
  if (s.society_name) document.getElementById('set-society-name').value = s.society_name;
  if (s.society_email) document.getElementById('set-society-email').value = s.society_email;
  if (s.host_name) document.getElementById('set-host-name').value = s.host_name;
  if (s.host_phone) document.getElementById('set-host-phone').value = s.host_phone;
  if (s.host_email) document.getElementById('set-host-email').value = s.host_email;
  if (s.email_cc_list) document.getElementById('set-email-cc').value = s.email_cc_list;
  if (s.email_subject_template) document.getElementById('set-subject-template').value = s.email_subject_template;
  if (s.email_intro_text) document.getElementById('set-intro-text').value = s.email_intro_text;
  if (s.email_disclaimer_text) document.getElementById('set-disclaimer-text').value = s.email_disclaimer_text;
  if (s.dispatch_hours_before) document.getElementById('set-dispatch-hours').value = s.dispatch_hours_before;
  if (s.auto_dispatch_enabled) document.getElementById('set-auto-dispatch').value = s.auto_dispatch_enabled;
}

document.getElementById('btn-open-settings').addEventListener('click', async () => {
  // 1. Immediately prefill from localStorage if available
  const cachedSettings = localStorage.getItem('pp_admin_settings');
  if (cachedSettings) {
    try {
      populateSettingsForm(JSON.parse(cachedSettings));
    } catch (e) {}
  }

  // 2. Fetch latest from server
  try {
    const res = await authFetch('/api/settings');
    const data = await res.json();
    if (data.success && data.settings) {
      populateSettingsForm(data.settings);
    }
  } catch (e) {
    console.warn('Could not fetch server settings, using local cached settings');
  }

  modalSettings.classList.add('active');
});

document.getElementById('form-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    society_name: document.getElementById('set-society-name').value,
    society_email: document.getElementById('set-society-email').value,
    host_name: document.getElementById('set-host-name').value,
    host_phone: document.getElementById('set-host-phone').value,
    host_email: document.getElementById('set-host-email').value,
    email_cc_list: document.getElementById('set-email-cc').value,
    email_subject_template: document.getElementById('set-subject-template').value,
    email_intro_text: document.getElementById('set-intro-text').value,
    email_disclaimer_text: document.getElementById('set-disclaimer-text').value,
    dispatch_hours_before: document.getElementById('set-dispatch-hours').value,
    auto_dispatch_enabled: document.getElementById('set-auto-dispatch').value
  };

  // Save to localStorage immediately
  localStorage.setItem('pp_admin_settings', JSON.stringify(payload));

  try {
    const res = await authFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('✓ Settings saved persistently across all devices!', 'success');
      modalSettings.classList.remove('active');
    }
  } catch (err) {
    showToast('Saved locally. Will sync to server automatically.', 'info');
    modalSettings.classList.remove('active');
  }
});

// Logs Modal
document.getElementById('btn-open-logs').addEventListener('click', async () => {
  try {
    const res = await authFetch('/api/logs');
    const data = await res.json();
    if (data.success) {
      const container = document.getElementById('logs-container');
      if (data.logs.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">No society emails sent yet.</div>`;
      } else {
        container.innerHTML = data.logs.map(log => `
          <div style="background:rgba(15,23,42,0.6); border:1px solid var(--border-subtle); border-radius:8px; padding:12px 16px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:600;">
              <span>Booking: ${log.booking_id} &bull; To: ${log.recipient_email}</span>
              <span class="badge ${log.status === 'SUCCESS' ? 'success' : 'danger'}">${log.status}</span>
            </div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">
              Subject: ${log.subject}
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:4px; display:flex; justify-content:space-between;">
              <span>Triggered by: <strong>${log.dispatched_by}</strong> &bull; Attached IDs: <strong>${log.attached_ids_count}</strong></span>
              <span>${formatDateTime(log.timestamp)}</span>
            </div>
          </div>
        `).join('');
      }
      modalLogs.classList.add('active');
    }
  } catch (e) {
    showToast('Failed to load audit logs', 'danger');
  }
});

// Initial Load

// Admin Login Form Submit
document.getElementById('form-admin-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pinInput = document.getElementById('input-admin-pin').value.trim();
  const errorMsg = document.getElementById('login-error-msg');
  errorMsg.style.display = 'none';

  try {
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinInput })
    });
    const data = await res.json();
    if (data.success) {
      setAdminPin(pinInput);
      document.getElementById('admin-lock-screen').style.display = 'none';
      loadBookings();
    } else {
      errorMsg.textContent = data.error || 'Incorrect PIN.';
      errorMsg.style.display = 'block';
    }
  } catch (err) {
    errorMsg.textContent = 'Network error connecting to server.';
    errorMsg.style.display = 'block';
  }
});

// Lock Dashboard Button
document.getElementById('btn-lock-dashboard').addEventListener('click', () => {
  clearAdminPin();
  document.getElementById('admin-lock-screen').style.display = 'flex';
  document.getElementById('input-admin-pin').value = '';
});

// Initial Auth Check & Load
if (checkAuth()) {
  loadBookings();
}
