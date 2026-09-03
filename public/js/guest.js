// Guest Portal Client - Clean & Intuitive Individual Guest Flow
let currentToken = null;
let currentBooking = null;
let activeAdultSlotId = null;

const LEGAL_NAME_REGEX = /^[a-zA-Z\s.'-]{3,60}$/;

function isValidName(name) {
  if (!name || typeof name !== 'string') return false;
  return LEGAL_NAME_REGEX.test(name.trim());
}

function getTokenFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (token) return token;

  const pathParts = window.location.pathname.split('/');
  if (pathParts.length > 2 && pathParts[1] === 'checkin') {
    return pathParts[2];
  }
  return null;
}

function formatCleanDate(isoString) {
  if (!isoString) return 'TBD';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Global quick toast
function showToast(msg, isSuccess = true) {
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'toast-msg';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.display = 'block';
  toast.style.borderColor = isSuccess ? '#10b981' : '#ef4444';
  toast.style.color = isSuccess ? '#6ee7b7' : '#fca5a5';

  setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// Load Booking Details
async function loadGuestPortal() {
  currentToken = getTokenFromUrl();
  const loadingState = document.getElementById('loading-state');
  const errorState = document.getElementById('error-state');
  const portalContent = document.getElementById('portal-content');

  if (!currentToken) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    document.getElementById('error-message').textContent = 'No reservation token found in URL.';
    return;
  }

  try {
    const res = await fetch(`/api/guest/portal/${currentToken}`);
    const data = await res.json();

    loadingState.style.display = 'none';

    if (data.success) {
      currentBooking = data.booking;
      if (data.meta && data.meta.hostName) {
        document.getElementById('portal-host-name').textContent = data.meta.hostName;
      }
      renderPortal(data.booking);
      portalContent.style.display = 'block';
    } else {
      errorState.style.display = 'block';
      document.getElementById('error-message').textContent = data.error || 'Invalid or expired reservation link.';
    }
  } catch (err) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    document.getElementById('error-message').textContent = 'Could not load details. Please check your internet connection.';
  }
}

// Render Portal Content
function renderPortal(booking) {
  // 1. Summary Strip (Clean & Non-repetitive)
  document.getElementById('summary-unit').textContent = `Flat ${booking.unit_flat_number}`;
  document.getElementById('summary-checkin').textContent = formatCleanDate(booking.check_in_date_time);
  document.getElementById('summary-guests-count').textContent = `${booking.total_adults} Adult(s)${booking.total_children > 0 ? ` + ${booking.total_children} Child` : ''}`;

  if (booking.vehicle_number) {
    document.getElementById('input-vehicle').value = booking.vehicle_number;
    document.getElementById('vehicle-status-badge').textContent = 'Saved';
    document.getElementById('vehicle-status-badge').className = 'status-badge complete';
  }

  // 2. Progress Tracker
  const uploaded = booking.uploaded_count; // Complete adults with valid name and ID file
  const total = booking.total_adults;
  const percentage = booking.completion_percentage;

  const progressPill = document.getElementById('progress-pill');
  const progressBar = document.getElementById('progress-bar-fill');
  const progressHint = document.getElementById('progress-hint-text');
  const completeBanner = document.getElementById('complete-banner');

  progressPill.textContent = `${uploaded} of ${total} Completed`;
  progressBar.style.width = `${percentage}%`;

  if (uploaded >= total) {
    progressPill.classList.add('complete');
    progressBar.classList.add('done');
    progressHint.textContent = `✓ All ${total} guest IDs are registered and ready for society security clearance.`;
    completeBanner.style.display = 'block';
  } else {
    progressPill.classList.remove('complete');
    progressBar.classList.remove('done');
    const remaining = total - uploaded;
    progressHint.textContent = `Pending: ${remaining} guest ID(s) needed for building entry approval.`;
    completeBanner.style.display = 'none';
  }

  // 3. Render Individual Adult Cards (No document dropdown clutter)
  const container = document.getElementById('adult-slots-container');
  container.innerHTML = booking.adults.map(adult => {
    const hasFile = (adult.status === 'UPLOADED' || adult.status === 'VERIFIED') && !!adult.id_file_path;
    const hasValidName = isValidName(adult.full_name);
    const isComplete = hasFile && hasValidName;

    const isLeadGuest = adult.adult_index === 1;
    const slotTitle = isLeadGuest ? 'Adult 1 (Lead Guest)' : `Adult Guest ${adult.adult_index}`;
    const placeholder = isLeadGuest ? 'Primary Guest Full Name *' : `Adult ${adult.adult_index} Full Name (as per ID) *`;
    const initialName = adult.full_name || (isLeadGuest ? booking.guest_primary_name : '');

    return `
      <div class="guest-card ${isComplete ? 'verified' : ''}" id="card-adult-${adult.id}">
        
        <div class="card-head">
          <div class="guest-identity-tag">
            <div class="guest-num-badge">${adult.adult_index}</div>
            <div class="guest-title">${slotTitle}</div>
          </div>
          <span class="status-badge ${isComplete ? 'complete' : 'missing'}" id="badge-${adult.id}">
            ${isComplete ? '✓ Complete' : 'Pending'}
          </span>
        </div>

        <div class="field-group">
          <label class="field-label">Legal Name (as per Govt ID) *</label>
          <input type="text" class="clean-input" id="name-${adult.id}" 
            placeholder="${placeholder}" 
            value="${escapeHtml(initialName)}"
            minlength="3"
            oninput="handleNameInput('${adult.id}')"
            style="${!hasValidName && initialName ? 'border-color:#ef4444;' : ''}">
          <div id="err-${adult.id}" style="display:none; color:#f87171; font-size:12px; margin-top:4px;">
            Please enter a valid name with letters only (min 3 characters).
          </div>
        </div>

        <div class="card-actions-row">
          <div>
            ${hasFile ? `
              <button type="button" class="btn-upload attached" onclick="triggerFileUpload('${adult.id}')">
                <span>📄 ${escapeHtml(adult.id_file_name || 'Govt ID Attached')}</span>
                <span style="text-decoration:underline; font-size:11px; margin-left:4px;">(Replace)</span>
              </button>
            ` : `
              <button type="button" class="btn-upload" onclick="triggerFileUpload('${adult.id}')">
                <span>📷 Upload / Snap Govt ID</span>
              </button>
            `}
          </div>

          <button type="button" class="btn-save-slot ${isComplete ? 'saved' : ''}" id="btn-save-${adult.id}" onclick="saveIndividualAdult('${adult.id}')">
            ${isComplete ? '✓ Saved' : 'Save Details'}
          </button>
        </div>

      </div>
    `;
  }).join('');
}

// Input validator feedback
function handleNameInput(adultId) {
  const input = document.getElementById(`name-${adultId}`);
  const err = document.getElementById(`err-${adultId}`);
  if (!input) return;
  const val = input.value.trim();

  if (val.length > 0 && !isValidName(val)) {
    if (err) err.style.display = 'block';
    input.style.borderColor = '#ef4444';
  } else {
    if (err) err.style.display = 'none';
    input.style.borderColor = 'var(--border-color)';
  }
}

// Trigger Mobile / Desktop File Upload
function triggerFileUpload(adultId) {
  activeAdultSlotId = adultId;
  const fileInput = document.getElementById('guest-file-input');
  fileInput.value = '';
  fileInput.click();
}

// Handle File Selected -> Auto-upload and update slot immediately
document.getElementById('guest-file-input').addEventListener('change', async (e) => {
  if (!e.target.files.length || !activeAdultSlotId || !currentToken) return;

  const file = e.target.files[0];
  const nameInput = document.getElementById(`name-${activeAdultSlotId}`);
  const fullName = nameInput ? nameInput.value.trim() : '';

  const formData = new FormData();
  formData.append('id_file', file);
  if (fullName) formData.append('full_name', fullName);
  formData.append('id_type', 'Govt ID');

  const card = document.getElementById(`card-adult-${activeAdultSlotId}`);
  if (card) card.style.opacity = '0.6';

  try {
    const res = await fetch(`/api/guest/portal/${currentToken}/adults/${activeAdultSlotId}/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      currentBooking = data.booking;
      renderPortal(data.booking);
      showToast('✓ ID photo uploaded successfully!', true);
    } else {
      if (card) card.style.opacity = '1';
      showToast(data.error || 'Upload failed', false);
    }
  } catch (err) {
    if (card) card.style.opacity = '1';
    showToast('Upload error: ' + err.message, false);
  }
});

// Save Individual Adult Slot (Name + Status)
async function saveIndividualAdult(adultId) {
  if (!currentToken || !currentBooking) return;

  const nameInput = document.getElementById(`name-${adultId}`);
  const err = document.getElementById(`err-${adultId}`);
  const btn = document.getElementById(`btn-save-${adultId}`);

  const fullName = nameInput ? nameInput.value.trim() : '';

  if (!fullName || !isValidName(fullName)) {
    if (err) err.style.display = 'block';
    if (nameInput) nameInput.focus();
    showToast('Please enter a valid legal name (min 3 characters)', false);
    return;
  }

  if (err) err.style.display = 'none';
  if (btn) {
    btn.textContent = 'Saving...';
    btn.disabled = true;
  }

  try {
    const res = await fetch(`/api/guest/portal/${currentToken}/adults/${adultId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, id_type: 'Govt ID' })
    });
    const data = await res.json();

    if (data.success) {
      currentBooking = data.booking;
      renderPortal(data.booking);
      showToast('✓ Details saved successfully!', true);
    } else {
      showToast(data.error || 'Failed to save', false);
      if (btn) {
        btn.textContent = 'Save Details';
        btn.disabled = false;
      }
    }
  } catch (e) {
    showToast('Network error saving details', false);
    if (btn) {
      btn.textContent = 'Save Details';
      btn.disabled = false;
    }
  }
}

// Save Vehicle Details
document.getElementById('btn-save-vehicle').addEventListener('click', async () => {
  if (!currentToken) return;

  const vehicleInput = document.getElementById('input-vehicle');
  const vehicle = vehicleInput ? vehicleInput.value.trim() : '';
  const btn = document.getElementById('btn-save-vehicle');

  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    const res = await fetch(`/api/guest/portal/${currentToken}/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_number: vehicle })
    });
    const data = await res.json();

    btn.textContent = 'Save Vehicle';
    btn.disabled = false;

    if (data.success) {
      document.getElementById('vehicle-status-badge').textContent = 'Saved';
      document.getElementById('vehicle-status-badge').className = 'status-badge complete';
      showToast('✓ Vehicle details saved!', true);
    } else {
      showToast(data.error || 'Failed to save vehicle', false);
    }
  } catch (e) {
    btn.textContent = 'Save Vehicle';
    btn.disabled = false;
    showToast('Network error saving vehicle', false);
  }
});

// Initialize on page load
loadGuestPortal();
