# Annpurna Chole Bhature — Admin Billing & Receipt System

A simple, fast, admin-only billing application custom-built for **Annpurna Chole Bhature**. Designed for lightning-fast order entry during rush hour service on phones and tablets, with light mode aesthetics, Order Type selection (Dine In / Pack), automated Google Sheets logging (two tabs: `Bills` and `Bill Items`), vector PDF receipts, WhatsApp sharing, and an interactive 3D procedural Annpurna Thali showcase.

---

## Key Highlights

- **Fast Touch Billing:** Large, responsive touch targets with instant `+1`, `+2`, `+5`, and `-` increment buttons for rush-hour counter service.
- **Authoritative Integer Paise Pricing:** Fixed prices enforced on the backend in integer paise to eliminate floating-point rounding errors:
  - **Chole Bhature:** ₹80 (8,000 paise)
  - **Lassi:** ₹40 (4,000 paise)
  - **Chole:** ₹40 (4,000 paise)
  - **Bhature:** ₹25 (2,500 paise)
  - **Cold Drink:** Admin enters positive MRP per bill
- **Two-Tab Google Sheets Storage:** Every completed bill is logged to Google Sheets using the Google Sheets API:
  - **`Bills` tab:** Bill Number, Date & Time (IST), Customer Name, Mobile Number, Grand Total (₹), Unique Bill ID, Item Count.
  - **`Bill Items` tab:** Bill Number, Item Name, Quantity, Unit Price (₹), Line Total (₹), Unique Bill ID, Timestamp (IST).
  - Includes duplicate protection using the unique Bill ID.
- **Vector PDF Receipt Generation:** Generates crisp, branded receipts using `pdf-lib` (Node/Browser) and OpenPDF (Java Spring Boot), formatted for mobile viewing and thermal printers.
- **WhatsApp Sharing:** Native share sheet integration (`navigator.share`) for devices that support direct file sharing, with automatic fallback (downloads PDF, pre-populates customer message, and opens WhatsApp chat).
- **Interactive 3D Annpurna Thali:** Built with Three.js conforming to PBR studio standards: 3–12 part procedural model (lathed brass platter, blistered puffed bhaturas, chickpea curry bowl, terracotta lassi kulhad, pickled onion rings, green chili, lemon), `RoomEnvironment`, `ACESFilmicToneMapping`, and a collapsible bottom control dock.
- **Admin Access Security:** Protected via token-based admin session configured through backend environment variables (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET`).

---

## Project Structure

```
├── .env.example                     # Environment configuration template
├── package.json                     # Frontend & Full-Stack dependencies
├── index.html                       # HTML entry point with metadata
├── server.ts                        # Full-stack Node/Express server for AI Studio
├── vite.config.ts                   # Vite build configuration
├── src/
│   ├── App.tsx                      # App orchestrator
│   ├── main.tsx                     # React root mount
│   ├── index.css                    # Tailwind CSS 4 & typography styles
│   ├── types/
│   │   └── billing.ts               # Authoritative menu, bill, and item types
│   ├── services/
│   │   ├── firebaseAuth.ts          # Google Workspace OAuth & token cache
│   │   ├── googleSheetsService.ts   # Google Sheets API v4 integration
│   │   └── pdfGenerator.ts          # Vector PDF receipt generator
│   └── components/
│       ├── AdminLogin.tsx           # Admin authentication screen
│       ├── BillingDashboard.tsx     # Main counter billing dashboard
│       ├── BillSuccessModal.tsx     # Success view, confetti, WhatsApp share
│       ├── PdfPreviewModal.tsx      # In-browser PDF receipt viewer
│       ├── RecentBillsDrawer.tsx    # Shift history drawer
│       └── ThaliCanvas3D.tsx        # Procedural 3D Thali with Three.js
└── backend-spring-boot/             # Standalone Java Spring Boot Backend
    ├── pom.xml                      # Maven dependencies
    ├── .env.example                 # Java backend environment variables
    ├── README.md                    # Java backend instructions
    └── src/main/
        ├── java/com/annpurna/billing/
        │   ├── BillingApplication.java
        │   ├── config/SecurityConfig.java
        │   ├── controller/
        │   │   ├── AuthController.java
        │   │   ├── BillController.java
        │   │   └── HealthController.java
        │   ├── model/
        │   │   ├── AuthResponse.java
        │   │   ├── Bill.java
        │   │   ├── BillItem.java
        │   │   ├── CreateBillRequest.java
        │   │   ├── LoginRequest.java
        │   │   └── MenuItem.java
        │   └── service/
        │       ├── BillService.java
        │       ├── GoogleSheetsService.java
        │       └── PdfGenerationService.java
        └── resources/
            └── application.properties
```

---

## Quick Start & Setup Instructions

### Option A: Running the Full-Stack App (AI Studio / Node.js)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Default credentials:
   - Admin Username: `admin`
   - Admin Password: `annpurna123`

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Option B: Running the Java Spring Boot Backend

The repository includes a complete, standalone Java Spring Boot 3.3.x REST API in the `backend-spring-boot/` directory:

1. **Prerequisites:**
   - Java 17 or 21 JDK
   - Maven 3.8+

2. **Navigate to the backend directory:**
   ```bash
   cd backend-spring-boot
   ```

3. **Build the package:**
   ```bash
   mvn clean package -DskipTests
   ```

4. **Run Spring Boot:**
   ```bash
   mvn spring-boot:run
   ```
   The Spring Boot REST API will start on port `8080`.

---

## Billing Flow Walkthrough

1. **Admin Login:** Enter admin credentials (`admin` / `annpurna123`).
2. **Enter Customer Information:**
   - Customer name (trimmed, non-empty, validated).
   - WhatsApp mobile number with country code support (+91 default).
3. **Select Menu Items:**
   - Tap `+` or quick add `+2`, `+5` buttons for Chole Bhature, Lassi, Chole, Bhature.
   - For Cold Drink, enter the bottle MRP (e.g. ₹40) and set quantity.
4. **Review Itemized Total:**
   - Instant calculation in integer paise with rupees formatting.
   - Grand Total highlighted in bold saffron badge.
5. **Save Bill:**
   - Click **Save & Complete Bill**.
   - Server applies official prices, formats date in Asia/Kolkata (`dd MMM yyyy, hh:mm:ss a IST`), and writes rows to Google Sheets `Bills` and `Bill Items`.
6. **PDF & WhatsApp Sharing:**
   - High-resolution PDF receipt is generated instantly.
   - Click **Share Receipt on WhatsApp**:
     - On mobile/tablet devices supporting web share, opens the native share sheet with the attached PDF.
     - On desktop/browsers without file share support, automatically downloads the PDF, opens the customer's WhatsApp chat with pre-written bill details, and prompts the admin to send the attached file.
   - Click **Create Next Bill** to reset the counter in 1 click for the next customer in line.
