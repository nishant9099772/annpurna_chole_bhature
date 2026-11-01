# Implementation Plan — Annpurna Chole Bhature Billing Upgrade & Security Hardening

## 1. Overview & Objectives

We will upgrade the existing **Annpurna Chole Bhature Billing Application** while preserving all existing functionality, historical bills, and Google Sheets integration:

1. **Automatically Append `" Ji"` to Customer Names**:
   - Format both newly entered customer names and existing historical bill records so every customer name ends with `" Ji"` (e.g., `Rahul` → `Rahul Ji`, `Amit Kumar` → `Amit Kumar Ji`).
   - Prevent duplicate suffixes (`Rahul Ji` or `rahul ji` normalizes cleanly to `Rahul Ji`, never `Rahul Ji Ji`).
   - Apply consistently across the New Bill form, generated bills, Bill History, Monthly Sales Calendar, WhatsApp receipts, PDF receipts, local database (`data/bills.json`), and Google Sheets rows.

2. **Mobile Number Copy Button (`+91` Country Code Included)**:
   - Add a mobile-friendly copy icon button next to every displayed mobile number across the app.
   - Clicking copies the full mobile number including country code (e.g., `+91 9876543210`) to the clipboard.
   - Stop event propagation (`e.stopPropagation()` and `e.preventDefault()`) so clicking the copy button never accidentally triggers parent row actions, modals, or WhatsApp links.
   - Display a confirmation toast message (`"Mobile number copied successfully!"`) and brief checkmark state.

3. **Mandatory Login, 24-Hour Session Management & Netlify Deployment Support**:
   - Require authentication (`User ID` and `Password`) whenever anyone opens the application before accessing any dashboard, billing, history, or report view.
   - Remove the hardcoded `'annpurna-admin-session-active'` bypass token and remove all exposed credential hints from the frontend login UI.
   - Verify passwords on the backend using cryptographic hashing (`crypto.scryptSync` + `crypto.timingSafeEqual`) and issue HMAC-SHA256 signed session tokens valid for **24 hours**.
   - Protect all backend `/api/*` endpoints (billing, history, metrics, monthly reports, PDF, and Google Sheets sync) with `requireAdminAuth`.
   - Add Netlify serverless function support (`netlify/functions/api.ts` and `netlify.toml`) so backend login and API routes work seamlessly on both Netlify and Google AI Studio / Cloud Run.

---

## 2. Technical Architecture & File-by-File Changes

### A. Customer Name `" Ji"` Formatting Utility
- **New File**: `src/utils/customerFormat.ts`
  - `formatCustomerNameWithJi(rawName: string): string`
    - Trims whitespace and collapses multiple spaces.
    - Checks case-insensitively whether the name already ends with `" ji"` (or `"ji."`).
    - If present, normalizes the suffix casing to `" Ji"`; otherwise appends `" Ji"`.
  - `formatFullMobileNumber(countryCode?: string, mobileNumber?: string): string`
    - Formats the complete phone number with country code (e.g., `+91 9876543210`) for clipboard copying and display.

### B. Reusable Mobile Copy Button Component
- **New File**: `src/components/CopyMobileButton.tsx`
  - Renders an accessible, touch-friendly (`min-h-[32px] min-w-[32px]` / mobile tap target) copy button beside mobile numbers.
  - Calls `e.stopPropagation()` and `e.preventDefault()` on click.
  - Copies `${countryCode} ${mobileNumber}` using `navigator.clipboard.writeText` (with a fallback hidden textarea copy for iframe compatibility).
  - Triggers a `"Mobile number copied successfully!"` confirmation toast and switches the icon from `Copy` to `Check` for 2 seconds.

### C. Backend Security, Authentication & `" Ji"` Normalization
- **Modified File**: `server.ts`
  - **Cryptographic Password Verification**:
    - Hash the configured `ADMIN_PASSWORD` at startup using `crypto.scryptSync` with a server salt and verify incoming login passwords using `crypto.timingSafeEqual`.
  - **24-Hour Signed Session Tokens**:
    - Issue HMAC-SHA256 signed tokens (`acb.<payloadBase64Url>.<signatureBase64Url>`) containing `{ sub: username, role: 'admin', iat, exp }` where `exp = iat + 24 * 60 * 60 * 1000` (24 hours).
    - Maintain a revoked-token set for explicit logouts (`POST /api/auth/logout`).
    - Remove `DEFAULT_SESSION_TOKEN` and insecure prefix matching so only cryptographically verified, non-expired tokens pass `requireAdminAuth`.
  - **Full API Route Protection**:
    - Enforce `requireAdminAuth` on `/api/menu`, `/api/metrics`, `/api/bills/calculate`, `/api/bills`, `/api/bills/:id`, `/api/bills/:id/pdf`, `/api/bills/:id/retry-sheets`, `/api/bills/batch-sync-sheets`, and `/api/reports/monthly`.
  - **Server-Side `" Ji"` Enforcement**:
    - Format `customerName` with `formatCustomerNameWithJi(trimmedName)` in `POST /api/bills` before saving to `billStorage` and syncing to Google Sheets.
  - **Export Express App for Serverless**:
    - Export `app` so Netlify Functions can wrap the exact same Express routes while keeping direct server startup for AI Studio Preview and Cloud Run.

- **Modified File**: `src/server/storage.ts`
  - Normalize existing loaded bills and newly saved bills with `formatCustomerNameWithJi` so all historical and future records consistently include `" Ji"`.
  - Automatically fall back to `/tmp/data/bills.json` if running in a read-only serverless filesystem (such as Netlify Functions).

- **New Files for Netlify Compatibility**:
  - `netlify/functions/api.ts`: Wraps the Express `app` in a Netlify-compatible handler for `/.netlify/functions/api/*`.
  - `netlify.toml`: Configures build output (`dist`), functions directory (`netlify/functions`), `/api/*` redirect to `/.netlify/functions/api/:splat` (status 200), and SPA fallback to `/index.html`.

### D. Frontend Components & Views
- **Modified File**: `src/App.tsx`
  - Initialize `adminToken` strictly from `localStorage.getItem('annpurna_admin_token')` (default `null`, never `'annpurna-admin-session-active'`).
  - Add session verification on startup via `GET /api/auth/me`: show a brief verification loader on initial mount if a token exists, and immediately clear the token and render `<AdminLogin />` if the token is missing, invalid, or expired (24h).
  - Format customer names with `formatCustomerNameWithJi` in WhatsApp share messages and pass the toast callback to child components for mobile copy confirmations.

- **Modified File**: `src/components/AdminLogin.tsx`
  - Require both **User ID** and **Password** (initialize User ID empty instead of pre-populated).
  - Remove all hardcoded password hints and environment variable references from the login screen UI.

- **Modified File**: `src/components/BillingDashboard.tsx`
  - Auto-append `" Ji"` when the Customer Name input loses focus (`onBlur`) and when submitting a new bill (`handleSaveBill`).
  - Add `<CopyMobileButton />` beside the mobile number field when 10 digits are entered.
  - Remove the `'annpurna-admin-session-active'` fallback in `handleSaveBill` and trigger `onLogout()` if the backend returns `401 Unauthorized`.
  - Make the header **Logout** button clearly labeled and visible on both mobile and desktop.

- **Modified Files**:
  - `src/components/BillHistoryView.tsx`
  - `src/components/BillDetailsModal.tsx`
  - `src/components/BillSuccessModal.tsx`
  - `src/components/RecentBillsDrawer.tsx`
  - `src/components/MonthlySalesCalendar.tsx`
  - `src/components/PdfPreviewModal.tsx`
  - `src/services/pdfGenerator.ts`
  - `src/services/googleSheetsService.ts`
  - Apply `formatCustomerNameWithJi(bill.customerName)` and place `<CopyMobileButton countryCode={bill.countryCode} mobileNumber={bill.mobileNumber} />` beside every displayed customer mobile number.

---

## 3. Verification Plan
1. **Customer Name `" Ji"` Verification**:
   - Test `Rahul` → `Rahul Ji`, `Amit Kumar` → `Amit Kumar Ji`, `Rahul Ji` → `Rahul Ji`, and `rahul ji` → `Rahul Ji` across new bills, historical bills, PDF generation, WhatsApp messages, and Google Sheets payload.
2. **Mobile Copy Button Verification**:
   - Verify copy button appears in Bill History, Bill Details Modal, Bill Success Modal, Shift Bills Drawer, and Monthly Sales Calendar, copies `+91 <10-digit-number>`, shows `"Mobile number copied successfully!"`, and does not trigger WhatsApp or modal navigation.
3. **Authentication & Security Verification**:
   - Verify unauthenticated requests to `/api/bills`, `/api/metrics`, and `/api/reports/monthly` return `HTTP 401`.
   - Verify valid login issues a 24-hour signed token, persists across page refreshes via `/api/auth/me`, and invalidates immediately upon clicking Logout.
   - Run `lint_applet` and `compile_applet` to confirm zero TypeScript or build errors.
