// Guest Portal Client Logic - Unified Auto-Save Workflow
let currentToken = null;
let currentBooking = null;
let activeAdultSlotId = null;

// Legal Name Regex Validator (Alphabetic letters, spaces, dots, hyphens, min 3 chars, max 60)
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

function formatDateTime(isoString) {
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

// Show localized banner or toast
function showGuestToast(msg, type = 'success') {
  const alertBox = document.getElementById('guest-validation-alert');
  if (!alertBox) return;

  if (type === 'success') {
    alertBox.style.background = 'rgba(16, 185, 129, 0.15)';
    alertBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    alertBox.style.color = '#6ee7b7';
    alertBox.innerHTML = `<strong>✓ Auto-Saved:</strong> ${msg}`;
  } else {
    alertBox.style.background = 'rgba(239, 68, 68, 0.15)';
    alertBox.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    alertBox.style.color = '#fca5a5';
    alertBox.innerHTML = `<strong>⚠️ Attention:</strong> ${msg}`;
  }
  alertBox.style.display = 'block';
  setTimeout(() => {
    alertBox.style.display = 'none';
  }, 5000);
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
    document.getElementById('error-message').textContent = 'No check-in token provided in the URL.';
    return;
  }

  try {
    const res = await fetch(`/api/guest/portal/${currentToken}`);
    const data = await res.json();

    loadingState.style.display = 'none';

    if (data.success) {
      currentBooking = data.booking;
      renderPortal(data.booking, data.meta);
      portalContent.style.display = 'block';
    } else {
      errorState.style.display = 'block';
      document.getElementById('error-message').textContent = data.error || 'Invalid or expired reservation link.';
    }
  } catch (err) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    document.getElementById('error-message').textContent = 'Could not load check-in details. Please check your connection.';
  }
}

// Render Portal UI
function renderPortal(booking, meta) {
  document.getElementById('header-greeting').textContent = `Welcome, ${booking.guest_primary_name}!`;
  document.getElementById('summary-unit').textContent = `Flat ${booking.unit_flat_number}`;
  document.getElementById('summary-guest-name').textContent = booking.guest_primary_name;
  document.getElementById('summary-checkin').textContent = formatDateTime(booking.check_in_date_time);
  document.getElementById('summary-guests-count').textContent = `${booking.total_adults} Adult(s)${booking.total_children > 0 ? ` + ${booking.total_children} Child` : ''}`;

  document.getElementById('input-primary-name').value = booking.guest_primary_name || '';
  if (booking.guest_phone) {
    document.getElementById('input-primary-phone').value = booking.guest_phone;
  }

  if (booking.vehicle_number) {
    document.getElementById('input-vehicle').value = booking.vehicle_number;
  }

  // Update Progress Meter
  const uploaded = booking.uploaded_count; // strictly complete (valid name >= 3 chars & attached photo)
  const total = booking.total_adults;
  const percentage = booking.completion_percentage;

  const progressPill = document.getElementById('progress-pill');
  const progressBar = document.getElementById('progress-bar-fill');
  const progressHint = document.getElementById('progress-hint-text');
  const completeBanner = document.getElementById('complete-banner');

  progressPill.textContent = `${uploaded} of ${total} Verified`;
  progressBar.style.width = `${percentage}%`;

  if (uploaded >= total) {
    progressPill.classList.add('complete');
    progressBar.classList.add('done');
    progressHint.textContent = `✓ All ${total} adult guest details & ID proofs are verified. Ready for building security approval!`;
    completeBanner.style.display = 'block';
  } else {
    progressPill.classList.remove('complete');
    progressBar.classList.remove('done');
    const missingNames = booking.missing_names_count || (total - uploaded);
    const missingFiles = booking.missing_files_count || (total - uploaded);
    progressHint.textContent = `Pending: ${missingNames} Guest Name(s) and ${missingFiles} ID Photo(s) required to grant gate clearance.`;
    completeBanner.style.display = 'none';
  }

  // Render Per-Adult Slots (Clean, Auto-saving, Zero Button Clutter)
  const container = document.getElementById('adult-slots-container');
  container.innerHTML = booking.adults.map(adult => {
    const hasFile = (adult.status === 'UPLOADED' || adult.status === 'VERIFIED') && !!adult.id_file_path;
    const hasValidName = isValidName(adult.full_name);
    const isComplete = hasFile && hasValidName;

    const isLeadGuest = adult.adult_index === 1;
    const defaultPlaceholder = isLeadGuest ? 'Primary Guest Legal Name *' : `Adult ${adult.adult_index} Legal Name as per ID *`;
    const initialName = adult.full_name || (isLeadGuest ? booking.guest_primary_name : '');
    const currentIdType = adult.id_type || 'Aadhaar';

    let badgeClass = 'missing';
    let badgeText = '❌ Missing ID & Name';
    if (isComplete) {
      badgeClass = 'uploaded';
      badgeText = '✓ Verified (Name & ID)';
    } else if (hasFile && !hasValidName) {
      badgeClass = 'missing';
      badgeText = '⚠ Legal Name Required';
    } else if (!hasFile && hasValidName) {
      badgeClass = 'missing';
      badgeText = '📸 ID Photo Required';
    }

    return `
      <div class="adult-upload-card ${isComplete ? 'uploaded' : ''}" id="card-adult-${adult.id}" style="${isComplete ? 'border:1px solid rgba(16,185,129,0.5);' : ''}">
        
        <div class="slot-top-row">
          <div class="slot-tag">
            <div class="slot-number">${adult.adult_index}</div>
            <div class="slot-name">${initialName ? escapeHtml(initialName) : `Adult Guest ${adult.adult_index}`}</div>
          </div>
          <span class="slot-status-badge ${badgeClass}" id="badge-adult-${adult.id}">
            ${badgeText}
          </span>
        </div>

        <div class="upload-controls">
          <div>
            <label style="font-size:11px; color:var(--text-muted); font-weight:600; display:block; margin-bottom:4px;">
              Legal Name (Letters only, min 3 characters) *
            </label>
            <div class="form-inputs-row" style="margin-bottom:8px;">
              <input type="text" class="guest-input" id="name-${adult.id}" 
                placeholder="${defaultPlaceholder}" 
                value="${escapeHtml(initialName)}"
                minlength="3"
                oninput="validateNameInputLive('${adult.id}')"
                onblur="autoSaveAdultSlot('${adult.id}')"
                style="${!hasValidName ? 'border-color:rgba(245,158,11,0.5);' : 'border-color:rgba(16,185,129,0.5);'}">
              
              <select class="guest-input" id="type-${adult.id}" onchange="autoSaveAdultSlot('${adult.id}')">
                <option value="Aadhaar" ${currentIdType === 'Aadhaar' ? 'selected' : ''}>Aadhaar</option>
                <option value="Passport" ${currentIdType === 'Passport' ? 'selected' : ''}>Passport</option>
                <option value="Driving License" ${currentIdType === 'Driving License' ? 'selected' : ''}>Driving License</option>
                <option value="Voter ID" ${currentIdType === 'Voter ID' ? 'selected' : ''}>Voter ID</option>
                <option value="Govt ID" ${currentIdType === 'Govt ID' ? 'selected' : ''}>Govt ID</option>
              </select>
            </div>
          </div>

          <div id="inline-error-${adult.id}" style="display:none; color:#f87171; font-size:12px; margin-bottom:8px; font-weight:600;"></div>

          <div>
            ${hasFile ? `
              <div class="file-preview-pill">
                <span style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:260px;">
                  📄 Attached: <strong>${escapeHtml(adult.id_file_name || 'ID Document')}</strong> (${escapeHtml(currentIdType)})
                </span>
                <button type="button" class="btn-upload-file" style="padding:6px 12px; font-size:12px; width:auto; background:rgba(255,255,255,0.12); box-shadow:none;" onclick="triggerGuestUpload('${adult.id}')">Replace Photo</button>
              </div>
            ` : `
              <button type="button" class="btn-upload-file" onclick="triggerGuestUpload('${adult.id}')">
                <span>📸 Snap / Upload ID Document</span>
              </button>
            `}
          </div>

        </div>

      </div>
    `;
  }).join('');
}

// Live regex validator indicator as user types
function validateNameInputLive(adultId) {
  const input = document.getElementById(`name-${adultId}`);
  if (!input) return;
  const val = input.value.trim();
  if (isValidName(val)) {
    input.style.borderColor = 'rgba(16, 185, 129, 0.7)';
  } else {
    input.style.borderColor = 'rgba(239, 68, 68, 0.7)';
  }
}

// Trigger File Picker for Adult Slot
function triggerGuestUpload(adultId) {
  activeAdultSlotId = adultId;
  const fileInput = document.getElementById('guest-file-input');
  fileInput.value = '';
  fileInput.click();
}

// Handle File Selected & Upload for specific slot (Auto-saves immediately)
document.getElementById('guest-file-input').addEventListener('change', async (e) => {
  if (!e.target.files.length || !activeAdultSlotId || !currentToken) return;

  const file = e.target.files[0];
  const nameInput = document.getElementById(`name-${activeAdultSlotId}`);
  const typeSelect = document.getElementById(`type-${activeAdultSlotId}`);
  const inlineError = document.getElementById(`inline-error-${activeAdultSlotId}`);

  const fullName = nameInput ? nameInput.value.trim() : '';
  const idType = typeSelect ? typeSelect.value : 'Aadhaar';

  const formData = new FormData();
  formData.append('id_file', file);
  if (fullName) formData.append('full_name', fullName);
  if (idType) formData.append('id_type', idType);

  const card = document.getElementById(`card-adult-${activeAdultSlotId}`);
  if (card) card.style.opacity = '0.5';

  try {
    const res = await fetch(`/api/guest/portal/${currentToken}/adults/${activeAdultSlotId}/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      currentBooking = data.booking;
      renderPortal(data.booking);
      showGuestToast('ID photo uploaded & saved successfully!', 'success');
    } else {
      if (inlineError) {
        inlineError.textContent = data.error || 'Upload failed.';
        inlineError.style.display = 'block';
      }
      if (card) card.style.opacity = '1';
    }
  } catch (err) {
    if (inlineError) {
      inlineError.textContent = 'Upload error: ' + err.message;
      inlineError.style.display = 'block';
    }
    if (card) card.style.opacity = '1';
  }
});

// Auto-save Individual Adult Slot on blur/change
async function autoSaveAdultSlot(adultId) {
  if (!currentToken || !currentBooking) return;

  const nameInput = document.getElementById(`name-${adultId}`);
  const typeSelect = document.getElementById(`type-${adultId}`);
  const inlineError = document.getElementById(`inline-error-${adultId}`);
  const card = document.getElementById(`card-adult-${adultId}`);

  if (inlineError) inlineError.style.display = 'none';

  const fullName = nameInput ? nameInput.value.trim() : '';
  const idType = typeSelect ? typeSelect.value : 'Aadhaar';

  if (!fullName) return; // let them continue typing

  if (!isValidName(fullName)) {
    if (inlineError) {
      inlineError.textContent = '⚠️ Name must contain letters only (min 3 characters).';
      inlineError.style.display = 'block';
    }
    return;
  }

  // Save to backend silently
  try {
    const res = await fetch(`/api/guest/portal/${currentToken}/adults/${adultId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, id_type: idType })
    });
    const data = await res.json();
    if (data.success) {
      currentBooking = data.booking;
      // Update badge and card status without wiping other inputs
      const matchingAdult = data.booking.adults.find(a => a.id === adultId);
      if (matchingAdult && matchingAdult.is_slot_complete) {
        if (card) card.style.border = '1px solid rgba(16,185,129,0.5)';
        const badge = document.getElementById(`badge-adult-${adultId}`);
        if (badge) {
          badge.className = 'slot-status-badge uploaded';
          badge.textContent = '✓ Verified (Name & ID)';
        }
      }
      showGuestToast(`Name for Adult ${matchingAdult.adult_index} auto-saved!`, 'success');
    }
  } catch (e) {
    console.warn('Auto-save error', e);
  }
}

// Auto-save Primary Guest info
async function autoSavePrimaryDetails() {
  if (!currentToken) return;
  const primaryNameInput = document.getElementById('input-primary-name');
  const primaryPhoneInput = document.getElementById('input-primary-phone');
  const primaryName = primaryNameInput ? primaryNameInput.value.trim() : '';
  const primaryPhone = primaryPhoneInput ? primaryPhoneInput.value.trim() : '';

  if (primaryName && isValidName(primaryName)) {
    try {
      await fetch(`/api/guest/portal/${currentToken}/details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_primary_name: primaryName,
          guest_phone: primaryPhone
        })
      });
      showGuestToast('Primary contact details saved!', 'success');
    } catch (e) {
      console.warn('Auto-save error', e);
    }
  }
}

// Auto-save Vehicle Number
async function autoSaveVehicle() {
  if (!currentToken) return;
  const vehicle = document.getElementById('input-vehicle').value.trim();
  try {
    await fetch(`/api/guest/portal/${currentToken}/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_number: vehicle })
    });
    showGuestToast('Vehicle registration details saved!', 'success');
  } catch (e) {
    console.warn('Auto-save vehicle error', e);
  }
}

// Attach auto-save event listeners
document.getElementById('input-primary-name').addEventListener('blur', autoSavePrimaryDetails);
document.getElementById('input-primary-phone').addEventListener('blur', autoSavePrimaryDetails);
document.getElementById('input-vehicle').addEventListener('blur', autoSaveVehicle);

// Single Master Submit & Verify Action
document.getElementById('btn-submit-checkin').addEventListener('click', async () => {
  if (!currentBooking || !currentToken) return;

  const primaryNameInput = document.getElementById('input-primary-name');
  const primaryName = primaryNameInput ? primaryNameInput.value.trim() : '';

  const errors = [];

  if (!primaryName || !isValidName(primaryName)) {
    errors.push('• <strong>Primary Guest Legal Name</strong> is required (letters only, min 3 characters).');
  }

  for (const adult of currentBooking.adults) {
    const nameInput = document.getElementById(`name-${adult.id}`);
    const nameVal = nameInput ? nameInput.value.trim() : (adult.full_name || '');
    const hasFile = (adult.status === 'UPLOADED' || adult.status === 'VERIFIED') && !!adult.id_file_path;

    if (!nameVal || !isValidName(nameVal)) {
      errors.push(`• <strong>Adult ${adult.adult_index}</strong>: Valid legal name is required.`);
      const card = document.getElementById(`card-adult-${adult.id}`);
      if (card) card.style.border = '2px solid #ef4444';
    }

    if (!hasFile) {
      errors.push(`• <strong>Adult ${adult.adult_index}</strong>: ID document photo is not uploaded.`);
      const card = document.getElementById(`card-adult-${adult.id}`);
      if (card) card.style.border = '2px solid #ef4444';
    }
  }

  // Refresh latest state from server
  const refreshRes = await fetch(`/api/guest/portal/${currentToken}`);
  const refreshData = await refreshRes.json();
  if (refreshData.success) {
    currentBooking = refreshData.booking;
    renderPortal(refreshData.booking);
  }

  const alertBox = document.getElementById('guest-validation-alert');
  if (errors.length > 0) {
    alertBox.style.background = 'rgba(239, 68, 68, 0.15)';
    alertBox.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    alertBox.style.color = '#fca5a5';
    alertBox.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px; font-size:14px;">⚠️ Please complete the required mandatory details:</div>
      ${errors.join('<br>')}
    `;
    alertBox.style.display = 'block';
    alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    alertBox.style.background = 'rgba(16, 185, 129, 0.15)';
    alertBox.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    alertBox.style.color = '#6ee7b7';
    alertBox.innerHTML = `<strong>🎉 All ${currentBooking.total_adults} adult guest names and ID proofs are verified and ready for society building entry!</strong>`;
    alertBox.style.display = 'block';
    document.getElementById('complete-banner').style.display = 'block';
  }
});

// Initialize on page load
loadGuestPortal();
