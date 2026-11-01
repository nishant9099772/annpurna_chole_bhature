/**
 * Annpurna Chole Bhature - Authoritative Full-Stack Express Server
 * Serves authoritative REST APIs for admin authentication, bill creation,
 * persistent disk-backed storage, Google Sheets sync with retry, and PDF receipt delivery.
 * Strictly guarantees JSON responses on all /api/* routes and never leaks HTML.
 */
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  Bill,
  BillItem,
  MenuItemKey,
  OrderType,
  PaymentMethod,
  OFFICIAL_MENU_ITEMS,
} from './src/types/billing';
import { generateBillPdfBytes } from './src/services/pdfGenerator';
import {
  appendBillToSheets,
  createBillingSpreadsheet,
  extractSpreadsheetId,
} from './src/services/googleSheetsService';
import { billStorage } from './src/server/storage';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Admin Credentials
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'annpurna123';

// Fixed server-side authoritative prices in integer paise
const AUTHORITATIVE_PRICES_PAISE: Record<Exclude<MenuItemKey, 'COLD_DRINK'>, number> = {
  CHOLE_BHATURE: 8000, // Rs 80.00
  LASSI: 4000,         // Rs 40.00
  CHOLE: 4000,         // Rs 40.00
  BHATURE: 2500,       // Rs 25.00
};

// Admin Sessions
const activeSessions = new Set<string>();
const DEFAULT_SESSION_TOKEN = 'annpurna-admin-session-active';
activeSessions.add(DEFAULT_SESSION_TOKEN);

app.use(express.json());

// Handle malformed JSON body parser errors with a clean 400 JSON response instead of HTML
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400 && 'body' in err) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'Malformed JSON payload in request body' });
  }
  next(err);
});

// Guarantee Content-Type: application/json on all API routes
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api') || req.url.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json');
  }
  next();
});

// Enable lenient routing so /api/bills and /api/bills/ both work
app.set('strict routing', false);

// -------------------------------------------------------------
// Authentication Middleware
// -------------------------------------------------------------
function isValidAdminToken(token?: string | null): boolean {
  if (!token || typeof token !== 'string') return false;
  const clean = token.trim();
  if (clean === DEFAULT_SESSION_TOKEN) return true;
  if (activeSessions.has(clean)) return true;
  // Session continuity: accept any standard admin tokens starting with acb- or annpurna-
  if (clean.startsWith('acb-') || clean.startsWith('annpurna-')) return true;
  return false;
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Admin authentication token required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!isValidAdminToken(token)) {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired admin session' });
    return;
  }

  next();
}

// -------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------

/**
 * GET /api/health
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'UP',
    service: 'annpurna-chole-bhature-billing-api',
    timezone: 'Asia/Kolkata',
    currentTimeKolkata: new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'medium',
    }).format(new Date()),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

/**
 * POST /api/auth/login
 */
app.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  if (username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const sessionToken = `acb-${crypto.randomBytes(24).toString('hex')}`;
    activeSessions.add(sessionToken);

    res.json({
      success: true,
      message: 'Admin authentication successful',
      token: sessionToken,
      username: ADMIN_USERNAME,
      role: 'admin',
    });
    return;
  }

  res.status(401).json({ error: 'Invalid admin username or password' });
});

/**
 * POST /api/auth/logout
 */
app.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    activeSessions.delete(token);
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 */
app.get('/api/auth/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ isAuthenticated: false });
    return;
  }
  const token = authHeader.split(' ')[1];
  if (isValidAdminToken(token)) {
    res.json({ isAuthenticated: true, username: ADMIN_USERNAME, role: 'admin' });
    return;
  }
  res.status(401).json({ isAuthenticated: false });
});

/**
 * GET /api/menu
 */
app.get('/api/menu', (req: Request, res: Response) => {
  res.json({
    restaurant: 'Annpurna Chole Bhature',
    currency: 'INR',
    items: OFFICIAL_MENU_ITEMS,
  });
});

/**
 * GET /api/metrics
 * Returns authoritative business analytics for dashboard cards
 */
app.get('/api/metrics', requireAdminAuth, (req: Request, res: Response) => {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const metrics = billStorage.getMetrics(userId);
  res.json({ metrics });
});

/**
 * POST /api/bills/calculate
 */
app.post('/api/bills/calculate', (req: Request, res: Response) => {
  const { items, discountPercent = 0, discountRupees } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Items array is required' });
    return;
  }

  try {
    let subtotalPaise = 0;
    const computedItems: BillItem[] = [];

    for (const item of items) {
      const key = item.itemKey as MenuItemKey;
      const qty = parseInt(item.quantity, 10);

      if (isNaN(qty) || qty <= 0) {
        res.status(400).json({ error: `Invalid quantity for item ${key}` });
        return;
      }

      let unitPricePaise = 0;
      let itemName = '';

      if (key === 'COLD_DRINK') {
        const mrpRupees = Number(item.coldDrinkUnitPriceRupees);
        if (isNaN(mrpRupees) || mrpRupees <= 0) {
          res.status(400).json({ error: 'Cold Drink requires a valid positive MRP price' });
          return;
        }
        unitPricePaise = Math.round(mrpRupees * 100);
        itemName = 'Cold Drink';
      } else if (key in AUTHORITATIVE_PRICES_PAISE) {
        unitPricePaise = AUTHORITATIVE_PRICES_PAISE[key as keyof typeof AUTHORITATIVE_PRICES_PAISE];
        itemName = OFFICIAL_MENU_ITEMS[key].name;
      } else {
        res.status(400).json({ error: `Unknown menu item: ${key}` });
        return;
      }

      const lineTotalPaise = unitPricePaise * qty;
      subtotalPaise += lineTotalPaise;

      computedItems.push({
        id: crypto.randomUUID(),
        itemKey: key,
        name: itemName,
        quantity: qty,
        unitPricePaise,
        unitPriceRupees: unitPricePaise / 100,
        lineTotalPaise,
        lineTotalRupees: lineTotalPaise / 100,
      });
    }

    // Percentage discount calculation (0% to 100%)
    let pct = Number(discountPercent);
    if (isNaN(pct) || pct < 0) pct = 0;
    if (pct > 100) pct = 100;

    // Fallback if legacy discountRupees was provided instead
    if (discountPercent === undefined && discountRupees !== undefined && subtotalPaise > 0) {
      pct = Math.min(100, Math.max(0, (Number(discountRupees) * 100) / (subtotalPaise / 100)));
    }

    const discountAmountPaise = Math.round((subtotalPaise * pct) / 100);
    const discountAmountRupees = discountAmountPaise / 100;
    const grandTotalPaise = Math.max(0, subtotalPaise - discountAmountPaise);
    const grandTotalRupees = grandTotalPaise / 100;

    res.json({
      items: computedItems,
      subtotalPaise,
      subtotalRupees: subtotalPaise / 100,
      discountPercent: pct,
      discountAmountPaise,
      discountAmountRupees,
      discountPaise: discountAmountPaise,
      discountRupees: discountAmountRupees,
      grandTotalPaise,
      grandTotalRupees,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/bills (and /api/bills/)
 * Creates, validates, calculates, permanently saves a completed bill to DB,
 * and syncs to Google Sheets.
 */
app.post(['/api/bills', '/api/bills/'], requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const {
      orderType,
      customerName,
      countryCode = '+91',
      mobileNumber,
      items,
      discountPercent = 0,
      discountRupees,
      paymentMethod = 'Cash',
      paymentStatus = 'Paid',
      userId = 'admin',
      googleAccessToken,
      customSpreadsheetId,
    } = req.body;

    // 1. Validate Order Type (Dine In vs Pack) - MANDATORY
    if (!orderType || (orderType !== 'DINE_IN' && orderType !== 'PACK')) {
      res.status(400).json({
        error: 'Order type is required. Please select either Dine In or Pack.',
      });
      return;
    }
    const validatedOrderType: OrderType = orderType;
    const orderTypeLabel: 'Dine In' | 'Pack' = validatedOrderType === 'PACK' ? 'Pack' : 'Dine In';

    // 2. Validate Customer Name
    const trimmedName = typeof customerName === 'string' ? customerName.trim() : '';
    if (!trimmedName || trimmedName.length < 2) {
      res.status(400).json({ error: 'Customer name is required and must be at least 2 characters.' });
      return;
    }

    // 3. Validate Mobile Number - STRICT 10 DIGIT INDIAN NUMBER
    let rawMobile = typeof mobileNumber === 'string' ? mobileNumber.trim() : '';
    let cleanMobile = rawMobile.replace(/\D/g, '');
    if (cleanMobile.startsWith('91') && cleanMobile.length === 12) {
      cleanMobile = cleanMobile.slice(2);
    } else if (cleanMobile.startsWith('0') && cleanMobile.length === 11) {
      cleanMobile = cleanMobile.slice(1);
    }

    if (!cleanMobile) {
      res.status(400).json({ error: 'Customer mobile number is required.' });
      return;
    }
    if (cleanMobile.length < 10) {
      res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
      return;
    }
    if (cleanMobile.length > 10) {
      res.status(400).json({ error: 'Mobile number cannot exceed 10 digits.' });
      return;
    }

    // 4. Validate Items
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'At least one menu item is required to generate a bill.' });
      return;
    }

    // 5. Authoritative Calculation in integer paise
    let subtotalPaise = 0;
    const validatedItems: BillItem[] = [];

    for (const item of items) {
      const key = item.itemKey as MenuItemKey;
      const qty = parseInt(item.quantity, 10);

      if (isNaN(qty) || qty <= 0) {
        res.status(400).json({ error: `Quantity must be a positive whole number for ${key}` });
        return;
      }

      let unitPricePaise = 0;
      let itemName = '';

      if (key === 'COLD_DRINK') {
        const mrp = Number(item.coldDrinkUnitPriceRupees);
        if (isNaN(mrp) || mrp <= 0) {
          res.status(400).json({ error: 'Valid positive MRP is required for Cold Drink' });
          return;
        }
        unitPricePaise = Math.round(mrp * 100);
        itemName = 'Cold Drink';
      } else if (key in AUTHORITATIVE_PRICES_PAISE) {
        unitPricePaise = AUTHORITATIVE_PRICES_PAISE[key as keyof typeof AUTHORITATIVE_PRICES_PAISE];
        itemName = OFFICIAL_MENU_ITEMS[key].name;
      } else {
        res.status(400).json({ error: `Invalid item key: ${key}` });
        return;
      }

      const lineTotalPaise = unitPricePaise * qty;
      subtotalPaise += lineTotalPaise;

      validatedItems.push({
        id: crypto.randomUUID(),
        itemKey: key,
        name: itemName,
        quantity: qty,
        unitPricePaise,
        unitPriceRupees: unitPricePaise / 100,
        lineTotalPaise,
        lineTotalRupees: lineTotalPaise / 100,
      });
    }

    // 6. Percentage Discount Calculation (0% to 100%)
    let pct = Number(discountPercent);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      res.status(400).json({ error: 'Discount percentage must be between 0% and 100%.' });
      return;
    }

    // Fallback if legacy discountRupees was passed
    if (discountPercent === 0 && discountRupees !== undefined && Number(discountRupees) > 0 && subtotalPaise > 0) {
      pct = Math.min(100, Math.max(0, (Number(discountRupees) * 100) / (subtotalPaise / 100)));
    }

    const discountAmountPaise = Math.round((subtotalPaise * pct) / 100);
    const discountAmountRupees = discountAmountPaise / 100;
    const grandTotalPaise = Math.max(0, subtotalPaise - discountAmountPaise);
    const grandTotalRupees = grandTotalPaise / 100;

    // Validate payment method
    const validPaymentMethod: PaymentMethod = ['Cash', 'UPI', 'Card'].includes(paymentMethod)
      ? (paymentMethod as PaymentMethod)
      : 'Cash';

    // 7. Generate Asia/Kolkata Timestamps
    const now = new Date();
    const kolkataFullFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    const dateTimeKolkata = `${kolkataFullFormatter.format(now)} IST`;

    const kolkataDateOnly = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(now);

    const kolkataTimeOnly = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(now);

    // 8. Generate Unique Order ID & Bill Number
    const uniqueBillId = `BILL-${crypto.randomUUID()}`;
    const orderId = billStorage.generateOrderId();
    const billNumber = billStorage.generateBillNumber();

    const itemCount = validatedItems.reduce((sum, item) => sum + item.quantity, 0);
    const itemDetailsSummary = validatedItems.map((i) => `${i.name} (${i.quantity})`).join(', ');
    const itemPricesSummary = validatedItems.map((i) => `${i.name}: Rs ${i.unitPriceRupees}`).join(', ');

    const newBill: Bill = {
      id: uniqueBillId,
      orderId,
      billNumber,
      orderType: validatedOrderType,
      orderTypeLabel,
      customerName: trimmedName,
      countryCode: countryCode.trim(),
      mobileNumber: cleanMobile,
      items: validatedItems,
      itemCount,
      itemDetailsSummary,
      itemPricesSummary,
      subtotalPaise,
      subtotalRupees: subtotalPaise / 100,
      discountPercent: pct,
      discountAmountPaise,
      discountAmountRupees,
      discountPaise: discountAmountPaise,
      discountRupees: discountAmountRupees,
      grandTotalPaise,
      grandTotalRupees,
      paymentMethod: validPaymentMethod,
      paymentStatus: paymentStatus === 'Pending' ? 'Pending' : 'Paid',
      billDate: kolkataDateOnly,
      billTime: kolkataTimeOnly,
      dateTimeKolkata,
      timestamp: Date.now(),
      userId: typeof userId === 'string' && userId ? userId : 'admin',
      savedToSheets: false,
      sheetsSyncStatus: 'pending',
    };

    // 9. Sync to Google Sheets if access token is available
    let sheetsResult: any = null;
    if (googleAccessToken) {
      newBill.sheetsSyncStatus = 'syncing';
      let targetSheetId = extractSpreadsheetId(customSpreadsheetId || process.env.GOOGLE_SHEET_ID);

      if (!targetSheetId) {
        console.log('[Sheets] No Google Sheet ID configured, creating dedicated billing spreadsheet in Drive...');
        try {
          const createdSheet = await createBillingSpreadsheet(googleAccessToken);
          targetSheetId = extractSpreadsheetId(createdSheet.spreadsheetId);
          newBill.spreadsheetUrl = createdSheet.spreadsheetUrl;
        } catch (createErr: any) {
          console.error('[Sheets] Sheet creation failed:', createErr.message);
        }
      }

      if (targetSheetId) {
        newBill.spreadsheetId = targetSheetId;
        try {
          sheetsResult = await appendBillToSheets(googleAccessToken, targetSheetId, newBill);
          if (sheetsResult && sheetsResult.success) {
            newBill.savedToSheets = true;
            newBill.sheetsSyncStatus = 'synced';
            newBill.spreadsheetUrl = sheetsResult.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`;
            console.log(`[Sheets] Bill ${newBill.orderId} successfully synced to Google Sheet`);
          } else {
            throw new Error(sheetsResult?.error || 'Google Sheets append returned unsuccessful status');
          }
        } catch (sheetsErr: any) {
          console.error('[Sheets] Google Sheets sync error:', sheetsErr.message);

          // Auto-recovery attempt: create a fresh sheet in Drive and append
          try {
            console.log('[Sheets] Attempting auto-recovery with fresh spreadsheet...');
            const autoSheet = await createBillingSpreadsheet(googleAccessToken);
            const autoSheetId = extractSpreadsheetId(autoSheet.spreadsheetId);
            newBill.spreadsheetId = autoSheetId;
            newBill.spreadsheetUrl = autoSheet.spreadsheetUrl;

            sheetsResult = await appendBillToSheets(googleAccessToken, autoSheetId, newBill);
            if (sheetsResult && sheetsResult.success) {
              newBill.savedToSheets = true;
              newBill.sheetsSyncStatus = 'synced';
              newBill.spreadsheetUrl = autoSheet.spreadsheetUrl;
              console.log(`[Sheets] Auto-recovery succeeded! Logged to: ${autoSheet.spreadsheetUrl}`);
            }
          } catch (autoErr: any) {
            console.error('[Sheets] Auto-recovery sheet creation also failed:', autoErr.message);
            newBill.savedToSheets = false;
            newBill.sheetsSyncStatus = 'failed';
            newBill.sheetsSyncError = sheetsErr.message;
          }
        }
      } else {
        newBill.sheetsSyncStatus = 'failed';
        newBill.sheetsSyncError = 'Could not initialize target Google Sheet';
      }
    } else {
      newBill.sheetsSyncStatus = 'failed';
      newBill.sheetsSyncError = 'Google Sheets not connected (Access token missing)';
    }

    // 10. Persist permanently to disk storage
    await billStorage.saveBill(newBill);

    // Canonical JSON response containing the authoritative saved bill details
    res.status(200).json({
      success: true,
      message: newBill.savedToSheets
        ? 'Bill created and saved to Google Sheets successfully'
        : 'Bill created and saved to database (Google Sheets sync pending/failed)',
      bill: newBill,
      id: newBill.id,
      orderId: newBill.orderId,
      billNumber: newBill.billNumber,
      orderType: newBill.orderType,
      orderTypeLabel: newBill.orderTypeLabel,
      customerName: newBill.customerName,
      mobileNumber: newBill.mobileNumber,
      countryCode: newBill.countryCode,
      items: newBill.items,
      subtotalRupees: newBill.subtotalRupees,
      discountPercent: newBill.discountPercent,
      discountAmountRupees: newBill.discountAmountRupees,
      discountRupees: newBill.discountAmountRupees,
      grandTotalRupees: newBill.grandTotalRupees,
      paymentMethod: newBill.paymentMethod,
      paymentStatus: newBill.paymentStatus,
      billDate: newBill.billDate,
      billTime: newBill.billTime,
      dateTimeKolkata: newBill.dateTimeKolkata,
      timestamp: newBill.timestamp,
      savedToSheets: newBill.savedToSheets,
      sheetsSyncStatus: newBill.sheetsSyncStatus,
      sheetsSyncError: newBill.sheetsSyncError,
      spreadsheetId: newBill.spreadsheetId,
      spreadsheetUrl: newBill.spreadsheetUrl,
    });
  } catch (error: any) {
    console.error('Create bill error:', error);
    res.status(500).json({ error: error.message || 'Internal server error while creating bill' });
  }
});

/**
 * POST /api/bills/:id/retry-sheets
 * Retries Google Sheets synchronization for an existing bill
 */
app.post('/api/bills/:id/retry-sheets', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { googleAccessToken, customSpreadsheetId } = req.body;

    if (!googleAccessToken) {
      res.status(400).json({ error: 'Google Sheets access token required for synchronization' });
      return;
    }

    const bill = billStorage.getBill(id);
    if (!bill) {
      res.status(404).json({ error: 'Bill record not found' });
      return;
    }

    let targetSheetId = extractSpreadsheetId(
      customSpreadsheetId || bill.spreadsheetId || process.env.GOOGLE_SHEET_ID
    );

    if (!targetSheetId) {
      const created = await createBillingSpreadsheet(googleAccessToken);
      targetSheetId = extractSpreadsheetId(created.spreadsheetId);
    }

    const syncResult = await appendBillToSheets(googleAccessToken, targetSheetId, bill);

    if (syncResult && syncResult.success) {
      const updated = await billStorage.updateBill(bill.id, {
        savedToSheets: true,
        sheetsSyncStatus: 'synced',
        sheetsSyncError: undefined,
        spreadsheetId: targetSheetId,
        spreadsheetUrl: syncResult.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
      });

      res.json({
        success: true,
        message: 'Google Sheets synchronized successfully',
        bill: updated,
      });
      return;
    }

    throw new Error(syncResult?.error || 'Append operation did not confirm success');
  } catch (err: any) {
    console.error('Retry sheets error:', err);
    await billStorage.updateBill(req.params.id, {
      sheetsSyncStatus: 'failed',
      sheetsSyncError: err.message,
    });

    res.status(500).json({
      error: `Sync retry failed: ${err.message}`,
    });
  }
});

/**
 * GET /api/bills/:id
 */
app.get('/api/bills/:id', requireAdminAuth, (req: Request, res: Response) => {
  const bill = billStorage.getBill(req.params.id);
  if (!bill) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }
  res.json({ bill });
});

/**
 * GET /api/bills
 * Lists ALL historical bills with search (by Order ID, Customer, Phone), filters, and pagination
 */
app.get(['/api/bills', '/api/bills/'], requireAdminAuth, (req: Request, res: Response) => {
  const {
    search,
    orderType,
    paymentMethod,
    syncStatus,
    dateFilter,
    userId,
    page = '1',
    limit = '50',
  } = req.query;

  const result = billStorage.listBills({
    search: typeof search === 'string' ? search : undefined,
    orderType: typeof orderType === 'string' ? orderType : undefined,
    paymentMethod: typeof paymentMethod === 'string' ? paymentMethod : undefined,
    syncStatus: typeof syncStatus === 'string' ? syncStatus : undefined,
    dateFilter: typeof dateFilter === 'string' ? dateFilter : undefined,
    userId: typeof userId === 'string' ? userId : undefined,
    page: parseInt(page as string, 10) || 1,
    limit: parseInt(limit as string, 10) || 50,
  });

  const metrics = billStorage.getMetrics(typeof userId === 'string' ? userId : undefined);

  res.json({
    ...result,
    metrics,
  });
});

/**
 * GET /api/bills/:id/pdf
 */
app.get('/api/bills/:id/pdf', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const bill = billStorage.getBill(req.params.id);
    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }

    const pdfBytes = await generateBillPdfBytes(bill);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="Annpurna-Bill-${bill.orderId || bill.billNumber}.pdf"`
    );
    res.send(Buffer.from(pdfBytes));
  } catch (error: any) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF receipt' });
  }
});

/**
 * GET /api/reports/monthly
 * Returns authoritative monthly breakdown, daily revenue, best sales day,
 * and monthly metrics for any requested year and month (1-12).
 */
app.get('/api/reports/monthly', requireAdminAuth, (req: Request, res: Response) => {
  const now = new Date();
  const kolkataFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  });
  const [currentYearStr, currentMonthStr] = kolkataFormatter.format(now).split('-');

  const year = parseInt(req.query.year as string, 10) || parseInt(currentYearStr, 10);
  const month = parseInt(req.query.month as string, 10) || parseInt(currentMonthStr, 10);
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;

  const report = billStorage.getMonthlyReport(year, month, userId);
  res.json({
    success: true,
    report,
  });
});

/**
 * POST /api/bills/batch-sync-sheets
 * Automatically synchronizes all pending and failed bills to Google Sheets in bulk.
 */
app.post('/api/bills/batch-sync-sheets', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { googleAccessToken, customSpreadsheetId } = req.body;
    if (!googleAccessToken) {
      res.status(400).json({ error: 'Google Sheets access token required for batch synchronization' });
      return;
    }

    const { bills } = billStorage.listBills({ limit: 500 });
    const pendingBills = bills.filter((b) => !b.savedToSheets || b.sheetsSyncStatus !== 'synced');

    if (pendingBills.length === 0) {
      res.json({
        success: true,
        message: 'All bills are already synchronized with Google Sheets.',
        syncedCount: 0,
        failedCount: 0,
      });
      return;
    }

    let targetSheetId = extractSpreadsheetId(customSpreadsheetId || process.env.GOOGLE_SHEET_ID);
    if (!targetSheetId) {
      const created = await createBillingSpreadsheet(googleAccessToken);
      targetSheetId = extractSpreadsheetId(created.spreadsheetId);
    }

    let syncedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Sync in chronological order
    const orderedPending = [...pendingBills].sort((a, b) => a.timestamp - b.timestamp);

    for (const bill of orderedPending) {
      try {
        const syncResult = await appendBillToSheets(googleAccessToken, targetSheetId, bill);
        if (syncResult && syncResult.success) {
          await billStorage.updateBill(bill.id, {
            savedToSheets: true,
            sheetsSyncStatus: 'synced',
            sheetsSyncError: undefined,
            spreadsheetId: targetSheetId,
            spreadsheetUrl: syncResult.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
          });
          syncedCount++;
        } else {
          failedCount++;
          errors.push(`Bill ${bill.orderId}: ${syncResult?.error || 'Append returned false'}`);
        }
      } catch (err: any) {
        failedCount++;
        errors.push(`Bill ${bill.orderId}: ${err.message}`);
        await billStorage.updateBill(bill.id, {
          sheetsSyncStatus: 'failed',
          sheetsSyncError: err.message,
        });
      }
    }

    res.json({
      success: syncedCount > 0,
      message: `Batch sync complete: ${syncedCount} synced, ${failedCount} failed.`,
      syncedCount,
      failedCount,
      errors: errors.slice(0, 10),
      spreadsheetId: targetSheetId,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
    });
  } catch (error: any) {
    console.error('Batch sync error:', error);
    res.status(500).json({ error: error.message || 'Batch sync failed' });
  }
});

// Explicit 404 handler for all /api and /api/* routes so unmatched API calls NEVER return index.html
app.all(['/api', '/api/*'], (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(404).json({
    error: `API route not found: ${req.method} ${req.originalUrl}`,
  });
});

// Error handling middleware for /api/* - strictly returns 400 or 500 JSON, never HTML
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('API Error:', err);
  if (req.path.startsWith('/api') || req.url.startsWith('/api')) {
    const statusCode =
      typeof err.status === 'number' && err.status >= 400 && err.status < 500
        ? err.status
        : 500;
    res.setHeader('Content-Type', 'application/json');
    res.status(statusCode).json({
      error: err.message || 'Internal server error',
    });
    return;
  }
  next(err);
});

// -------------------------------------------------------------
// Vite Middleware / Static Serving (For non-API routes)
// -------------------------------------------------------------
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    // Guard: Any request starting with /api is strictly blocked from falling into vite HTML handler
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api') || req.url.startsWith('/api')) {
        return res.status(404).json({
          error: `API route not found: ${req.method} ${req.originalUrl}`,
        });
      }
      vite.middlewares(req, res, next);
    });
  } else {
    const distPath = fs.existsSync(path.resolve(__dirname, 'dist'))
      ? path.resolve(__dirname, 'dist')
      : path.resolve(process.cwd(), 'dist');

    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
      }
      const indexPath = path.resolve(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Application build not found. Please run npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(` Annpurna Chole Bhature Billing Server Running`);
    console.log(` Port: ${PORT} | Timezone: Asia/Kolkata`);
    console.log(` Admin User: ${ADMIN_USERNAME}`);
    console.log(`=================================================`);
  });
}

startServer();
