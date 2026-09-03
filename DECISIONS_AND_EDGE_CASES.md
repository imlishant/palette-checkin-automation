# Palette & Pillows — Architecture Decisions, Edge Cases & Discussion Log

> **Living Project Documentation**  
> This document records all architectural decisions, design considerations, edge cases, user Q&As, and future improvement ideas discussed during the development and evolution of the **Palette & Pillows Guest Check-In & Society Email Automation Platform**.

---

## 1. Origin & Core Problem Statement

Residential societies and apartment HOAs require verified government identity proofs for **every adult guest** before security guards permit entry through the gate. 

### Historical Pain Points:
1. **The "Missing ID" Bottleneck**: A reservation might be for 4 adults, but the guest initially provides only 1 or 2 IDs.
2. **Channel Fragmentation**: Details and ID photos arrive scattered across Airbnb messages, WhatsApp photos, and reservation emails.
3. **Repeated Host Follow-ups**: Hosts must repeatedly message guests across channels to collect the remaining IDs before check-in.
4. **Last-Minute Gate Panics**: Guests often send IDs while standing at the gate with guards actively refusing entry, forcing the host to scramble to compile emails.

---

## 2. Architecture Decision Records (ADRs)

### ADR-001: Dedicated Lightweight Web App vs. Local n8n vs. Google Apps Script
* **Context**: Deciding on the underlying automation architecture.
* **Evaluation**:
  * *Local n8n*: Risk of failure when host laptop sleeps/goes offline; requires public tunnels (ngrok/Cloudflare) for guest uploads.
  * *Google Apps Script + Sheets*: Free and reliable, but limited UI customization for dynamic per-adult photo slots.
  * *Dedicated Web App (Node.js + SQLite + Mobile Web)*: Provides 24/7 cloud readiness ($0 free-tier deployable), custom mobile guest uploader with dynamic progress bars, and a 1-click host dashboard.
* **Decision**: **Option A (Dedicated Full-Stack Web Application)** chosen for superior guest experience and emergency host controls.

### ADR-002: Per-Adult Entity Data Model
* **Context**: Simple booking records only track total guest count, not individual ID completeness.
* **Decision**: Created a sub-entity table `guest_adults` linking 1..N adult slots to each booking. This enables:
  * Individual status tracking (`MISSING`, `UPLOADED`, `VERIFIED`).
  * Live completion percentage calculation (`received_ids / total_adults`).
  * Dynamic template generation (*"We have received 2 of 4 IDs. 2 IDs still missing"*).

### ADR-003: Cryptographic Tokenized URLs for Guests (Zero-Login)
* **Context**: Guests will not create accounts or passwords just to upload check-in IDs.
* **Decision**: Every booking is assigned a unique, random 32-character token (e.g., `checkin.html?token=7396a4...`). The guest portal API is strictly scoped to that single reservation.

### ADR-004: Strict Idempotency & Auto-Dispatch Guardrails
* **Context**: Society security offices must not be spammed with duplicate emails for the same booking.
* **Decision**:
  1. Auto-scheduler only triggers if `uploaded_count >= total_adults`.
  2. Once dispatched, booking transitions to `SENT` or `OVERRIDDEN` with a timestamp.
  3. Subsequent auto-scheduler runs skip sent bookings permanently.

### ADR-005: Two-Tier Data Flow: Reservation Ingestion vs. Guest Document Upload
* **Context**: Clarifying what data is entered by the host/Airbnb vs. what is uploaded by the guests.
* **Decision**:
  * **Tier 1 (Reservation Details)**: Primary Guest Name, Flat #, Total Adults, Check-in/Out dates are ingested when the booking is confirmed (via 20s manual entry or future iCal/email parser). This initializes the ID requirements.
  * **Tier 2 (ID Documents & Sub-Guest Names)**: Sensitive ID photos and names of Adult 2, 3, etc. are submitted by the guests via their mobile upload link.

### ADR-006: Admin-Configurable Society Email Templates & Dynamic Placeholders
* **Context**: Society security rules, subject line conventions, mandatory disclaimers, and CC recipients change frequently between different apartment complexes. Hardcoding them into source files required developer code edits.
* **Decision**: All email formatting (Subject Line, CC List, Intro/Purpose Text, Society Rules Disclaimer) is now exposed directly in the Dashboard **⚙️ Settings** modal. The backend interpolates dynamic tags (`{unit}`, `{guest_name}`, `{adult_count}`, `{check_in}`, `{check_out}`, `{vehicle}`).

### ADR-007: Brand Domain Integration (paletteandpillows.space)
* **Context**: The user owns the active marketing domain `https://paletteandpillows.space/` (Adora De Goa, Dabolim).
* **Decision**: Recommended deploying the guest check-in & society email backend under a dedicated subdomain such as `https://checkin.paletteandpillows.space/` or `https://app.paletteandpillows.space/`.
  * Preserves main marketing website speed and SEO.
  * Provides high-trust branded guest links (`checkin.paletteandpillows.space/checkin/BK-XXXX`).
  * Deploys for free on Render / Railway / Fly.io / VPS with simple CNAME DNS pointing.

### ADR-008: Host Admin PIN Authentication Barrier & Guest Route Isolation
* **Context**: If a guest accesses the root domain (`/` or removes the token from the URL), they must not be able to view other reservations, guest names, or ID documents.
* **Decision**:
  1. All admin API routes (`/api/bookings`, `/api/adults`, `/api/settings`, `/api/logs`) are now protected by the `requireAdminAuth` middleware validating the `x-admin-pin` header.
  2. The Host Dashboard UI renders a secure **Host Lock Screen** prompt unless unlocked with the Host PIN (`ADMIN_PIN=7788` in `.env`).
  3. The Guest Portal remains on `/checkin.html?token=...` and only communicates with `/api/guest/*` endpoints scoped strictly to their single reservation token.

### ADR-009: Date-Only Standardization & Guest Route Order Fix
* **Context**:
  1. Check-in and check-out timestamps are unnecessary for society security gate registers and create clutter; date-only format (e.g. `3 Sep 2026`) is cleaner.
  2. Express route mounting order caused `/api/guest` to be intercepted by `/api` admin auth middleware.
* **Decision**:
  1. Standardized all UI inputs, WhatsApp messages, and email templates to date-only format.
  2. Mounted `/api/guest` before protected `/api` routes so guests access their portal seamlessly without PIN challenges.

### ADR-010: Default Aadhaar Selection & Real-Time Editable Guest Names
* **Context**: Sub-adults (Adult 2, 3, etc.) had placeholder names like `"Adult 2"` that were difficult to edit post-upload, and document selection defaulted to generic `"Govt ID"`.
* **Decision**:
  1. Default document type standardized to **`Aadhaar`** across all schemas, dropdowns, and uploads.
  2. Sub-adult slots now start with an empty full name field (placeholder: `"Full Name as per ID *"`).
  3. Real-time auto-saving name input fields added to both the **Guest Mobile Portal** and the **Host Dashboard Manifest** so names can be reviewed and edited before or after ID upload.
  4. Explicit SVG calendar icon styling with hover zoom (`#818cf8`) and automatic `input.showPicker()` on click to guarantee instant calendar popups across macOS/Chrome/Safari.

### ADR-011: Strict Guest Legal Name Enforcement (Min 3 Chars) & Granular Compliance Accounting
* **Context**: Uploading an ID photo with an empty name field was incorrectly counted as "100% Complete" and showed fallback `"Guest 2"`, `"Guest 3"` in society emails.
* **Decision**:
  1. **Strict Double-Condition Gate**: An adult slot is considered complete **only if** both conditions are met:
     - `full_name` is present and $\ge 3$ non-whitespace characters (`isValidGuestName`).
     - A valid ID photo/PDF file is attached.
  2. **Removed Fallback Names**: Incomplete names in society email previews now render explicitly as `⚠ Missing Legal Name` and block automated dispatch.
  3. **Master "Save & Verify All Details" Action**: Added a prominent save and validation button on the guest portal that performs comprehensive checks, highlights missing slots in red, and presents actionable error guidance.
  4. **Dashboard Granular Status Reporting**: The host dashboard badges now explicitly report missing counts: e.g. `🚨 Incomplete (1/4 Complete - Missing 3 Name(s) & 1 ID Photo(s))`.

### ADR-012: Independent Per-Guest Slot Saving & Legal Name Regex
* **Context**: Different guests/family members sharing the same check-in link needed the ability to fill and save their individual details (e.g. Guest 3 fills their name and ID) without waiting for or wiping other guests' inputs.
* **Decision**:
  1. **Dedicated Per-Slot "💾 Save Adult [X]" Action**: Each adult card now has an independent save handler.
  2. **Strict Legal Name Regex**: Enforced `/^[a-zA-Z\s.'-]{3,60}$/` to ensure real alphabetic names (rejects garbage like `123`, `$$$`, or empty inputs).
  3. **Isolated Persistence**: Saving one slot updates the server immediately without resetting other inputs currently being typed in the browser.
  4. **Visual State**: A slot turns green (`✓ Verified`) only when both its valid regex name and ID photo are successfully saved.

### ADR-013: Subdomain Architecture & Namecheap DNS Runbook (checkin.paletteandpillows.space)
* **Context**: Main marketing site is hosted on GitHub Pages (`paletteandpillows.space` via Namecheap DNS). Full-stack Node.js automation app requires a backend runtime with SQLite, Multer, Nodemailer, and Cron.
* **Decision**:
  1. **Subdomain Choice**: `checkin.paletteandpillows.space` deployed on Render.com (Free Tier Node.js Web Service + Auto SSL).
  2. **Namecheap DNS Mapping**: Add CNAME Record: `Host: checkin`, `Value: <app-name>.onrender.com`.
  3. **Production URL**: `APP_BASE_URL=https://checkin.paletteandpillows.space` generates clean branded guest links (`https://checkin.paletteandpillows.space/checkin/BK-XXXX`).

### ADR-014: Hosting Platform Analysis (Vercel Serverless vs. Render Persistent Container)
* **Context**: The user inquired whether Vercel could be used instead of Render.
* **Decision**:
  * **Vercel Limitations for this App**:
    1. *Ephemeral Filesystem*: Vercel Serverless wipes SQLite databases and local ID uploads (`./uploads/secure_ids`) every time a function goes idle.
    2. *Serverless Lifecycle*: In-memory `node-cron` cannot run continuously on Vercel without external cron triggering.
  * **Recommended Hosting (Render / Railway)**:
    1. Render runs a persistent Node.js environment where SQLite, `node-cron` background checks, and local file handling work out-of-the-box with **zero refactoring** and **zero cost**.

### ADR-015: Pre-Commit Security & Privacy Audit
* **Context**: Verifying that no SMTP credentials, Gmail App Passwords, SQLite databases, or uploaded guest ID photos are exposed to GitHub.
* **Decision**:
  1. Configured strict multi-layer `.gitignore` blocking `.env*`, `data/*.db*`, `uploads/secure_ids/*`, and system logs.
  2. Executed automated file-by-file audit confirming 0 leaked credentials in tracked code.
  3. Git tracking isolated strictly to clean application logic, public assets, templates, and placeholder `.env.example`.

---

## 3. Edge Case Registry & Handling

| # | Edge Case | Potential Problem | Platform Solution |
|---|:---|:---|:---|
| **1** | **Multiple Listings in the Same Society** | Multiple guests arriving around the same time to different flats in the same building. | **Flat-Isolated Dispatches**: Each apartment gets its own independent email with exact subject lines (`[Guest Arrival] Flat A-1204 - Rahul Sharma`, `Flat B-602 - Neha Kapoor`). Security guards can search emails by Flat # or Guest Name instantly. |
| **2** | **Cross-Guest Privacy Exposure** | Guest viewing other guests' personal IDs or booking details. | **Token Scoping**: Guest API endpoints validate token ownership and only return that specific reservation's adult slots. |
| **3** | **Partial ID Submissions (e.g. 2 of 4 IDs)** | Premature email sent to society with missing IDs, causing guard rejection. | **Completeness Gate**: System locks status in `PENDING_IDS`. Auto-dispatch is blocked until all adult IDs are uploaded. |
| **4** | **Gate Emergency / Last-Minute Arrival** | Guests stuck at security gate with 1 ID missing; guards demanding immediate proof. | **Host 1-Click Gate Override**: Host can click `🚨 Gate Override` from their phone to dispatch an immediate compliance email with whatever IDs are available. |
| **5** | **Large ID Photos Exceeding Email Limits** | Guests uploading high-res 15MB photos crashing email delivery. | **Upload Limits & MIME Validation**: Multer enforces 10MB per file, validates image/PDF MIME types, and securely sanitizes file paths. |
| **6** | **WhatsApp Received IDs** | Guest texts ID photos directly to host WhatsApp instead of the portal link. | **Host Manual Dropzone**: Host dashboard includes `👥 IDs` manifest with direct dropzone to attach files on the guest's behalf in 5 seconds. |

---

## 4. Chronological Discussion & Q&A Log

### Log Entry: 2026-09-03 — Initial System Design & Architecture
* **Topic**: Strategy selection (n8n local vs cloud vs custom app).
* **Discussion**:
  * Evaluated n8n local laptop limitations (laptop sleep prevents timers; guest mobile uploads need public IP/tunnel).
  * Agreed on **Option A (Custom Web App)** with phased execution and strict guardrails.
* **Outcome**: Full-stack platform built with Node.js Express, SQLite, Nodemailer, Host Operations Dashboard, and Guest Mobile Portal.

### Log Entry: 2026-09-03 — Privacy & Multi-Property Inquiries
* **User Inquiries**:
  1. *Who can see the list of all bookings and IDs? Are guests seeing each other's?*
     * **Clarification**: Guests are strictly isolated to their own token link. Master booking list is only visible on the host dashboard.
  2. *Once all IDs are uploaded and sent to security, then what?*
     * **Clarification**: System switches booking to `SENT`, logs dispatch in audit trail, updates guest portal with green confirmation badge, and locks against duplicate auto-sends.
  3. *What happens with multiple listing properties in the same society on conflicting arrival times?*
     * **Clarification**: Each flat generates discrete emails with distinct subject tags (`Flat A-1204`, `Flat B-602`). Guards look up entries by flat number.

### Log Entry: 2026-09-03 — Data Ingestion & Live Testing Questions
* **User Inquiries**:
  1. *How do I test with real past data and values?*
  2. *Where to set mail IDs, send and receive?*
  3. *How does the system get the info (Guest names, Adults, Check-in/out)? Are these filled by guests or scraped?*
* **Clarifications & Solutions**:
  * **Data Division**: Basic booking fields (Lead Guest, Flat, Dates, Adult count) are ingested initially (Host creates or iCal/email sync). The ID documents and other adult names are uploaded by the guests via their mobile link.
  * **Email Routing**: Configurable in dashboard `⚙️ Settings` or `.env` (`DEFAULT_SOCIETY_EMAIL`). For testing, host can set their own email address as recipient to receive actual emails with attachments.
  * **Testing Workflow**: Outlined step-by-step procedure to test with past reservations.

---

## 5. Backlog & Future Improvement Suggestions

- [ ] **Airbnb iCal Calendar Auto-Sync**: Automatically import new reservations from Airbnb iCal feeds without manual entry.
- [ ] **Gmail Airbnb Confirmation Email Parser**: Automatically parse reservation emails into booking records.
- [ ] **WhatsApp Business Webhook Integration**: Automatically reply to guest WhatsApp inquiries with their check-in link.
- [ ] **OCR ID Auto-Extraction**: Read guest name and document type automatically from uploaded Aadhaar/Passport images.
- [ ] **Post-Checkout ID Auto-Purge Cron**: Scheduled job to automatically delete ID photo files 48 hours after check-out for enhanced data privacy compliance.
- [ ] **Multi-Property Grouping / Building Selector**: Ability to assign different society security email addresses to different apartment buildings.
