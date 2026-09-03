// Guest Portal Client Logic - Per-Guest Independent Submission
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
    alertBox.innerHTML = `<strong>✓ Success:</strong> ${msg}`;
  } else {
    alertBox.style.background = 'rgba(239, 68, 68, 0.15)';
    alertBox.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    alertBox.style.color = '#fca5a5';
    alertBox.innerHTML = `<strong>⚠️ Attention:</strong> ${msg}`;
  }
  alertBox.style.display = 'block';
  setTimeout(() => {
    alertBox.style.display = 'none';
  }, 6000);
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
  const uploaded = booking.uploaded_count; // strictly complete (both valid name >= 3 chars & photo)
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

  // Render Per-Adult Slots with Independent Save Controls
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
                style="${!hasValidName ? 'border-color:rgba(245,158,11,0.5);' : 'border-color:rgba(16,185,129,0.5);'}">
              
              <select class="guest-input" id="type-${adult.id}">
                <option value="Aadhaar" ${currentIdType === 'Aadhaar' ? 'selected' : ''}>Aadhaar</option>
                <option value="Passport" ${currentIdType === 'Passport' ? 'selected' : ''}>Passport</option>
                <option value="Driving License" ${currentIdType === 'Driving License' ? 'selected' : ''}>Driving License</option>
                <option value="Voter ID" ${currentIdType === 'Voter ID' ? 'selected' : ''}>Voter ID</option>
                <option value="Govt ID" ${currentIdType === 'Govt ID' ? 'selected' : ''}>Govt ID</option>
              </select>
            </div>
          </div>

          <div id="inline-error-${adult.id}" style="display:none; color:#f87171; font-size:12px; margin-bottom:8px; font-weight:600;"></div>

          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            ${hasFile ? `
              <div class="file-preview-pill" style="flex:1;">
                <span style="text-overflow:ellipsis; overflow:hidden; white-space:nowrap; max-width:200px;">
                  📄 Attached: <strong>${escapeHtml(adult.id_file_name || 'ID Document')}</strong>
                </span>
                <button type="button" class="btn-upload-file" style="padding:5px 10px; font-size:11px; width:auto; background:rgba(255,255,255,0.12); box-shadow:none;" onclick="triggerGuestUpload('${adult.id}')">Replace</button>
              </div>
            ` : `
              <button type="button" class="btn-upload-file" style="flex:1;" onclick="triggerGuestUpload('${adult.id}')">
                <span>📸 Snap / Upload ID Proof</span>
              </button>
            `}

            <button type="button" class="btn-upload-file" id="btn-save-slot-${adult.id}" style="width:auto; padding:8px 16px; font-size:13px; background:${isComplete ? '#059669' : 'var(--accent-primary)'};" onclick="saveIndividualAdultSlot('${adult.id}')">
              <span>💾 Save Adult ${adult.adult_index}</span>
            </button>
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

// Handle File Selected & Upload for specific slot
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
      if (isValidName(fullName)) {
        showGuestToast(`Adult slot updated with ID document and legal name!`, 'success');
      } else {
        showGuestToast(`ID photo uploaded! Please enter the legal name (letters only, min 3 chars) to complete verification.`, 'warning');
      }
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

// Save Individual Adult Slot (e.g. Guest 3 fills their details)
async function saveIndividualAdultSlot(adultId) {
  if (!currentToken || !currentBooking) return;

  const nameInput = document.getElementById(`name-${adultId}`);
  const typeSelect = document.getElementById(`type-${adultId}`);
  const inlineError = document.getElementById(`inline-error-${adultId}`);
  const card = document.getElementById(`card-adult-${adultId}`);

  if (inlineError) inlineError.style.display = 'none';

  const fullName = nameInput ? nameInput.value.trim() : '';
  const idType = typeSelect ? typeSelect.value : 'Aadhaar';

  const matchingAdult = currentBooking.adults.find(a => a.id === adultId);
  const hasFile = matchingAdult && (matchingAdult.status === 'UPLOADED' || matchingAdult.status === 'VERIFIED') && !!matchingAdult.id_file_path;

  // Validate Name Format (Strict Regex: Letters, min 3 chars)
  if (!fullName) {
    if (inlineError) {
      inlineError.textContent = '⚠️ Full legal name is mandatory.';
      inlineError.style.display = 'block';
    }
    if (card) card.style.border = '2px solid #ef4444';
    return;
  }

  if (!isValidName(fullName)) {
    if (inlineError) {
      inlineError.textContent = '⚠️ Name must contain letters only (min 3 characters, no numbers or special symbols).';
      inlineError.style.display = 'block';
    }
    if (card) card.style.border = '2px solid #ef4444';
    return;
  }

  // Check ID photo
  if (!hasFile) {
    if (inlineError) {
      inlineError.textContent = '📸 ID document photo is required for this slot. Please click "Snap / Upload ID Proof".';
      inlineError.style.display = 'block';
    }
    if (card) card.style.border = '2px solid #f59e0b';
  }

  // Save to backend
  try {
    const res = await fetch(`/api/guest/portal/${currentToken}/adults/${adultId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, id_type: idType })
    });
    const data = await res.json();
    if (data.success) {
      currentBooking = data.booking;
      renderPortal(data.booking);
      if (hasFile) {
        showGuestToast(`Adult slot verified successfully!`, 'success');
      } else {
        showGuestToast(`Name saved! Please attach the ID document photo to complete gate verification.`, 'warning');
      }
    } else {
      if (inlineError) {
        inlineError.textContent = data.error || 'Failed to save details.';
        inlineError.style.display = 'block';
      }
    }
  } catch (err) {
    if (inlineError) {
      inlineError.textContent = 'Network error: ' + err.message;
      inlineError.style.display = 'block';
    }
  }
}

// Master "Save & Verify All Guest Details" Button
document.getElementById('btn-save-all-details').addEventListener('click', async () => {
  if (!currentBooking || !currentToken) return;

  const primaryNameInput = document.getElementById('input-primary-name');
  const primaryPhoneInput = document.getElementById('input-primary-phone');
  const primaryName = primaryNameInput ? primaryNameInput.value.trim() : '';
  const primaryPhone = primaryPhoneInput ? primaryPhoneInput.value.trim() : '';

  const errors = [];

  // 1. Validate Primary Guest Name
  if (!primaryName) {
    errors.push('• <strong>Primary Guest Name</strong> is mandatory.');
  } else if (!isValidName(primaryName)) {
    errors.push('• <strong>Primary Guest Name</strong> must contain letters only (min 3 characters).');
  }

  // 2. Validate All Adult Slots
  for (const adult of currentBooking.adults) {
    const nameInput = document.getElementById(`name-${adult.id}`);
    const nameVal = nameInput ? nameInput.value.trim() : (adult.full_name || '');
    const hasFile = (adult.status === 'UPLOADED' || adult.status === 'VERIFIED') && !!adult.id_file_path;

    if (!nameVal) {
      errors.push(`• <strong>Adult ${adult.adult_index}</strong>: Legal name is missing.`);
    } else if (!isValidName(nameVal)) {
      errors.push(`• <strong>Adult ${adult.adult_index}</strong>: Name "${escapeHtml(nameVal)}" is invalid (letters only, min 3 characters).`);
    }

    if (!hasFile) {
      errors.push(`• <strong>Adult ${adult.adult_index}</strong>: ID document photo is not uploaded.`);
    }
  }

  // Save Primary Contact info
  try {
    if (isValidName(primaryName)) {
      await fetch(`/api/guest/portal/${currentToken}/details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_primary_name: primaryName,
          guest_phone: primaryPhone
        })
      });
    }
  } catch (e) {
    console.warn('Error saving primary details', e);
  }

  // Save all adult slot names
  for (const adult of currentBooking.adults) {
    const nameInput = document.getElementById(`name-${adult.id}`);
    const typeSelect = document.getElementById(`type-${adult.id}`);
    if (nameInput && typeSelect) {
      const val = nameInput.value.trim();
      const type = typeSelect.value;
      if (val && isValidName(val)) {
        await fetch(`/api/guest/portal/${currentToken}/adults/${adult.id}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ full_name: val, id_type: type })
        });
      }
    }
  }

  // Refresh booking state
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
  }
});

// Vehicle Details Submit
document.getElementById('form-additional-details').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentToken) return;

  const vehicleNumber = document.getElementById('input-vehicle').value;

  try {
    const res = await fetch(`/api/guest/portal/${currentToken}/details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle_number: vehicleNumber })
    });
    const data = await res.json();
    if (data.success) {
      showGuestToast('Vehicle registration details saved for building security entry!', 'success');
      currentBooking = data.booking;
      renderPortal(data.booking);
    }
  } catch (err) {
    showGuestToast('Error saving details: ' + err.message, 'danger');
  }
});

// Initialize on page load
loadGuestPortal();
