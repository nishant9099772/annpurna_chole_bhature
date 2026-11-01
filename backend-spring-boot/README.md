# Annpurna Chole Bhature - Java Spring Boot Backend

Production-grade Spring Boot REST API for **Annpurna Chole Bhature** billing system, with Google Sheets synchronization, vector PDF receipt generation, and admin session security.

---

## Features

- **Strict Authoritative Pricing:** Enforces official menu prices in integer paise on the server (Chole Bhature ₹80, Lassi ₹40, Chole ₹40, Bhature ₹25, Cold Drink entered MRP validation).
- **Google Sheets Two-Tab Sync:** Automatically syncs completed bills to `Bills` and individual line items to `Bill Items` with duplicate protection.
- **Vector PDF Generation:** Generates branded, printer-ready, and mobile-friendly PDF receipts.
- **Admin Access Control:** Token-based admin session authentication configured via environment variables.
- **Asia/Kolkata Timezone:** Timestamps and receipt dates formatted in Indian Standard Time (IST).

---

## Project Structure

```
backend-spring-boot/
├── pom.xml
├── .env.example
├── README.md
└── src/
    └── main/
        ├── java/com/annpurna/billing/
        │   ├── BillingApplication.java
        │   ├── config/
        │   │   └── SecurityConfig.java
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

## Setup & Configuration

1. **Install Prerequisites:**
   - Java 17 or higher
   - Maven 3.8+

2. **Configure Environment Variables:**
   Copy `.env.example` to `.env` or set environment variables:
   ```bash
   export ADMIN_USERNAME="admin"
   export ADMIN_PASSWORD="your_secure_password"
   export ADMIN_JWT_SECRET="your_jwt_secret_token_here"
   export GOOGLE_SHEET_ID="your_google_sheet_id_here"
   export PORT=8080
   ```

3. **Build the Application:**
   ```bash
   mvn clean package -DskipTests
   ```

4. **Run the Application:**
   ```bash
   mvn spring-boot:run
   ```
   Or execute the built jar:
   ```bash
   java -jar target/billing-backend-1.0.0.jar
   ```

---

## API Endpoints

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/api/health` | Service health check & IST timestamp | No |
| `POST` | `/api/auth/login` | Admin login | No |
| `POST` | `/api/auth/logout` | Admin logout | Yes (Bearer token) |
| `GET` | `/api/auth/me` | Verify current admin session | Yes (Bearer token) |
| `POST` | `/api/bills` | Create and save bill (syncs to Sheets) | Yes (Bearer token) |
| `GET` | `/api/bills` | List bills created during shift | Yes (Bearer token) |
| `GET` | `/api/bills/{id}` | Get specific bill details | Yes (Bearer token) |
| `GET` | `/api/bills/{id}/pdf`| Download/stream PDF receipt | Yes (Bearer token) |
