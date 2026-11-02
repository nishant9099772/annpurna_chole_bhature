/**
 * Annpurna Chole Bhature - Production Express API Application
 * Pure production API module with zero development/Vite dependencies.
 * Imported by both the local/container server (server.ts) and the Netlify Serverless Function (netlify/functions/api.ts).
 */
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';
import {
  Bill,
  BillItem,
  MenuItemKey,
  OrderType,
  PaymentMethod,
  OFFICIAL_MENU_ITEMS,
} from '../types/billing';
import { generateBillPdfBytes } from '../services/pdfGenerator';
import {
  syncBillToGoogleSheets,
  getSheetsConnectionStatus,
  fetchBillsFromGoogleSheets,
} from '../services/googleSheetsService';
import { billStorage } from './storage';
import { formatCustomerNameWithJi } from '../utils/customerFormat';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

/**
 * Strips accidental surrounding quotes ("..." or '...') and whitespace
 * that often occur when environment variables are pasted into Netlify's dashboard.
 */
function cleanEnvValue(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  let trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Normalizes a User ID for case-insensitive and separator-tolerant matching
 * (e.g. "Annpurna_Chole_Bhature", "annpurna chole bhature", "admin").
 */
function normalizeUserSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

// Cryptographic scrypt parameters (No plaintext passwords stored in code)
const ACB_SCRYPT_SALT = 'acb-auth-v1-salt-annpurna-2026';

// Pre-computed one-way scrypt hashes (64-byte hex) for existing authorized accounts:
// 1. Primary AI Studio / Production account (annpurna_chole_bhature)
// 2. Standard default admin account (admin)
const AUTHORIZED_SCRYPT_HASHES_HEX: readonly string[] = [
  '9da0f18b241aec27d759875c9ed1ae8f73140873916ba972fb3a66445685f9d8de75df878a14dd2f44a8136ebe7b8c8504d8072b4c48b31d388e39d9aa1b8aea',
  '9ece98cf9631c43f053fe096e231eae1af6692b8dbaa883f091fa22988546222482e32a6cb252d3f242c517a9ebdfd8b8b560f941a52b0c486ad709617ed499d',
];

const AUTHORIZED_SCRYPT_BUFFERS: Buffer[] = AUTHORIZED_SCRYPT_HASHES_HEX.map((hex) =>
  Buffer.from(hex, 'hex')
);

function getConfiguredAdminUsername(): string {
  return (
    cleanEnvValue(
      process.env.ADMIN_USERNAME ||
        process.env.APP_ADMIN_USERNAME ||
        process.env.VITE_ADMIN_USERNAME
    ) || 'annpurna_chole_bhature'
  );
}

const ADMIN_USERNAME = getConfiguredAdminUsername();

function getSessionSecret(): string {
  const envSecret = cleanEnvValue(process.env.ADMIN_JWT_SECRET);
  if (envSecret) return envSecret;
  return crypto
    .createHash('sha256')
    .update(`acb-stateless-jwt-secret-v2:${ACB_SCRYPT_SALT}:${AUTHORIZED_SCRYPT_HASHES_HEX[0]}`)
    .digest('hex');
}

// 24-Hour Session Validity
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function matchesScryptTargetConstantTime(candidatePassword: string, targetHashBuf: Buffer): boolean {
  try {
    const candidateHash = crypto.scryptSync(candidatePassword, ACB_SCRYPT_SALT, 64);
    if (candidateHash.length !== targetHashBuf.length) return false;
    return crypto.timingSafeEqual(candidateHash, targetHashBuf);
  } catch {
    return false;
  }
}

/**
 * Verifies a password in constant time using scrypt against:
 * 1. Any custom ADMIN_PASSWORD / STAFF_PASSWORD configured in Netlify environment variables
 * 2. Pre-computed scrypt hashes of the existing authorized accounts
 */
function verifyPasswordConstantTime(candidatePassword: string): boolean {
  if (typeof candidatePassword !== 'string' || !candidatePassword) return false;

  const candidatesToCheck = [candidatePassword];
  const trimmedCandidate = candidatePassword.trim();
  if (trimmedCandidate && trimmedCandidate !== candidatePassword) {
    candidatesToCheck.push(trimmedCandidate);
  }

  // Build active target hashes dynamically so Netlify env var changes are respected immediately
  const activeTargetBuffers: Buffer[] = [...AUTHORIZED_SCRYPT_BUFFERS];

  const rawEnvPass = process.env.ADMIN_PASSWORD || process.env.APP_ADMIN_PASSWORD || process.env.STAFF_PASSWORD;
  if (rawEnvPass && typeof rawEnvPass === 'string') {
    const cleanedEnvPass = cleanEnvValue(rawEnvPass);
    if (cleanedEnvPass) {
      activeTargetBuffers.unshift(crypto.scryptSync(cleanedEnvPass, ACB_SCRYPT_SALT, 64));
    }
    if (rawEnvPass !== cleanedEnvPass && rawEnvPass.length > 0) {
      activeTargetBuffers.unshift(crypto.scryptSync(rawEnvPass, ACB_SCRYPT_SALT, 64));
    }
  }

  let matched = false;
  for (const candidate of candidatesToCheck) {
    for (const targetBuf of activeTargetBuffers) {
      if (matchesScryptTargetConstantTime(candidate, targetBuf)) {
        matched = true;
      }
    }
  }
  return matched;
}

/**
 * Verifies whether the supplied User ID belongs to an authorized admin or counter user.
 */
function isAuthorizedUserId(candidateUsername: string): { authorized: boolean; canonicalUser: string; role: 'admin' | 'staff' } {
  if (typeof candidateUsername !== 'string') {
    return { authorized: false, canonicalUser: '', role: 'admin' };
  }
  const slug = normalizeUserSlug(candidateUsername);
  if (!slug) {
    return { authorized: false, canonicalUser: '', role: 'admin' };
  }

  const configuredAdminSlug = normalizeUserSlug(getConfiguredAdminUsername());
  const configuredStaffSlug = normalizeUserSlug(
    cleanEnvValue(process.env.STAFF_USERNAME || process.env.REGULAR_USERNAME || '')
  );

  const validAdminSlugs = new Set<string>([
    configuredAdminSlug,
    'annpurna_chole_bhature',
    'annapurna_chole_bhature',
    'annpurna',
    'annapurna',
    'admin',
  ]);

  const validStaffSlugs = new Set<string>(
    ['cashier', 'staff', 'counter', configuredStaffSlug].filter(Boolean)
  );

  if (validAdminSlugs.has(slug)) {
    return {
      authorized: true,
      canonicalUser: slug === 'annapurna_chole_bhature' ? 'annpurna_chole_bhature' : candidateUsername.trim(),
      role: 'admin',
    };
  }

  if (validStaffSlugs.has(slug)) {
    return {
      authorized: true,
      canonicalUser: candidateUsername.trim(),
      role: 'staff',
    };
  }

  return { authorized: false, canonicalUser: '', role: 'admin' };
}

// Revoked tokens set (for explicit logouts before 24h expiry)
const revokedTokens = new Set<string>();

interface SignedSessionPayload {
  sub: string;
  role: 'admin' | 'staff';
  iat: number;
  exp: number;
  jti: string;
}

function createSignedSessionToken(
  username: string,
  role: 'admin' | 'staff' = 'admin'
): { token: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const payload: SignedSessionPayload = {
    sub: username,
    role,
    iat: now,
    exp: expiresAt,
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signatureB64 = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return {
    token: `acb.${payloadB64}.${signatureB64}`,
    expiresAt,
  };
}

function verifySignedSessionToken(token?: string | null): SignedSessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const clean = cleanEnvValue(token);
  if (!clean || revokedTokens.has(clean)) return null;

  const parts = clean.split('.');
  if (parts.length !== 3 || parts[0] !== 'acb') return null;

  const [, payloadB64, signatureB64] = parts;
  if (!payloadB64 || !signatureB64) return null;

  try {
    const expectedSig = crypto
      .createHmac('sha256', getSessionSecret())
      .update(payloadB64)
      .digest('base64url');

    const sigBuf = Buffer.from(signatureB64, 'utf-8');
    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as SignedSessionPayload;
    if (!decoded || typeof decoded.exp !== 'number' || Date.now() > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

// Fixed server-side authoritative prices in integer paise
const AUTHORITATIVE_PRICES_PAISE: Record<Exclude<MenuItemKey, 'COLD_DRINK'>, number> = {
  CHOLE_BHATURE: 8000, // Rs 80.00
  LASSI: 4000,         // Rs 40.00
  CHOLE: 4000,         // Rs 40.00
  BHATURE: 2500,       // Rs 25.00
};

// CORS & Preflight Middleware for API routes (ensures Netlify & Capacitor Android WebView compatibility)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api') || req.url.startsWith('/api')) {
    const reqOrigin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', reqOrigin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept, X-Google-Token, X-Requested-With, Origin'
    );
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    if (reqOrigin) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Content-Length', '0');
      res.status(200).end();
      return;
    }
  }
  next();
});

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
function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Please log in with your User ID and Password.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const session = verifySignedSessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired session. Please log in again.' });
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
app.post(['/api/auth/login', '/api/auth/login/'], (req: Request, res: Response) => {
  let payload: any = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  } else if (Buffer.isBuffer(payload)) {
    try {
      payload = JSON.parse(payload.toString('utf-8'));
    } catch {
      payload = {};
    }
  }

  const rawUsername = payload?.username ?? payload?.userId ?? '';
  const rawPassword = payload?.password ?? '';

  if (
    !rawUsername ||
    !rawPassword ||
    typeof rawUsername !== 'string' ||
    typeof rawPassword !== 'string'
  ) {
    res.status(400).json({ error: 'Both User ID and Password are required.' });
    return;
  }

  const userCheck = isAuthorizedUserId(rawUsername);
  const passwordValid = verifyPasswordConstantTime(rawPassword);

  if (userCheck.authorized && passwordValid) {
    const { token: sessionToken, expiresAt } = createSignedSessionToken(
      userCheck.canonicalUser,
      userCheck.role
    );

    res.status(200).json({
      success: true,
      message: 'Authentication successful',
      token: sessionToken,
      username: userCheck.canonicalUser,
      role: userCheck.role,
      expiresAt,
    });
    return;
  }

  res.status(401).json({ error: 'Invalid User ID or Password. Access denied.' });
});

/**
 * POST /api/auth/logout
 */
app.post(['/api/auth/logout', '/api/auth/logout/'], (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1]?.trim();
    if (token) {
      revokedTokens.add(token);
    }
  }
  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * GET /api/auth/me
 */
app.get(['/api/auth/me', '/api/auth/me/'], (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ isAuthenticated: false, error: 'Authentication token required' });
    return;
  }
  const token = authHeader.split(' ')[1];
  const session = verifySignedSessionToken(token);
  if (session) {
    res.json({
      isAuthenticated: true,
      username: session.sub,
      role: session.role,
      expiresAt: session.exp,
    });
    return;
  }
  res.status(401).json({ isAuthenticated: false, error: 'Invalid or expired session' });
});

/**
 * GET /api/menu
 */
app.get('/api/menu', requireAdminAuth, (req: Request, res: Response) => {
  res.json({
    restaurant: 'Annpurna Chole Bhature',
    currency: 'INR',
    items: OFFICIAL_MENU_ITEMS,
  });
});

// Throttled background hydration from Google Sheets so stateless Netlify cold starts always load historical bills
let lastSheetsHydrationTime = 0;
async function maybeHydrateFromSheets(clientToken?: string | null, customSheetId?: string | null): Promise<number> {
  const now = Date.now();
  if (now - lastSheetsHydrationTime < 45_000 && !clientToken) {
    return 0;
  }
  lastSheetsHydrationTime = now;
  try {
    const remoteBills = await fetchBillsFromGoogleSheets({
      clientAccessToken: clientToken,
      customSpreadsheetId: customSheetId,
    });
    if (remoteBills.length > 0) {
      return billStorage.mergeBillsFromSheets(remoteBills);
    }
  } catch (err: any) {
    console.log('[Sheets Hydration] Skipped:', err.message);
  }
  return 0;
}

/**
 * GET /api/sheets/status
 * Returns authoritative server-side + client Google Sheets & WhatsApp Cloud API connection status
 */
app.get('/api/sheets/status', requireAdminAuth, async (req: Request, res: Response) => {
  const clientToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
  const customSheetId = typeof req.query.sheetId === 'string' ? req.query.sheetId : undefined;
  const status = getSheetsConnectionStatus(clientToken, customSheetId);
  const whatsappCloudConfigured = Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  );
  res.json({
    ...status,
    whatsappCloudConfigured,
    businessWhatsappNumber: '+91 8800896679',
  });
});

/**
 * GET /api/metrics
 * Returns authoritative business analytics (including 24-hour rolling window stats) for dashboard cards
 */
app.get(['/api/metrics', '/api/metrics/'], requireAdminAuth, async (req: Request, res: Response) => {
  const clientToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
  const customSheetId = typeof req.query.sheetId === 'string' ? req.query.sheetId : undefined;
  await maybeHydrateFromSheets(clientToken, customSheetId);
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const metrics = billStorage.getMetrics(userId);
  res.json({ metrics, bills: billStorage.getAllBills() });
});

/**
 * POST /api/bills/hydrate
 * Bidirectionally merges client-persisted bills, backend storage, and Google Sheets records,
 * deduplicating by Order ID / Bill Number / ID, and returns authoritative 24h rolling metrics + full bill history.
 */
app.post(['/api/bills/hydrate', '/api/bills/hydrate/'], requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { clientBills, googleAccessToken, customSpreadsheetId } = req.body || {};
    const headerToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
    const effectiveToken = googleAccessToken || headerToken;

    if (Array.isArray(clientBills) && clientBills.length > 0) {
      billStorage.mergeClientBills(clientBills);
    }

    await maybeHydrateFromSheets(effectiveToken, customSpreadsheetId);

    const metrics = billStorage.getMetrics();
    const bills = billStorage.getAllBills();

    res.json({
      success: true,
      metrics,
      bills,
    });
  } catch (err: any) {
    console.error('[Bills Hydrate Error]:', err);
    res.status(500).json({ error: err.message || 'Failed to hydrate bills' });
  }
});

/**
 * POST /api/bills/calculate
 */
app.post('/api/bills/calculate', requireAdminAuth, (req: Request, res: Response) => {
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

    // 2. Validate Customer Name & Automatically Append " Ji"
    const rawTrimmedName = typeof customerName === 'string' ? customerName.trim() : '';
    if (!rawTrimmedName || rawTrimmedName.length < 2) {
      res.status(400).json({ error: 'Customer name is required and must be at least 2 characters.' });
      return;
    }
    const trimmedName = formatCustomerNameWithJi(rawTrimmedName);

    // 3. Validate Mobile Number - STRICT 10 DIGIT INDIAN NUMBER
    const rawMobile = typeof mobileNumber === 'string' ? mobileNumber.trim() : '';
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

    // 9. Sync to Google Sheets (supports Server Service Account, Apps Script Web App, or Client OAuth Token)
    newBill.sheetsSyncStatus = 'syncing';
    const syncResult = await syncBillToGoogleSheets(newBill, {
      clientAccessToken: googleAccessToken,
      customSpreadsheetId,
    });

    if (syncResult.success) {
      newBill.savedToSheets = true;
      newBill.sheetsSyncStatus = 'synced';
      newBill.sheetsSyncError = undefined;
      newBill.spreadsheetId = syncResult.spreadsheetId;
      newBill.spreadsheetUrl = syncResult.spreadsheetUrl;
      console.log(
        `[Sheets] Bill ${newBill.orderId} successfully recorded in Google Sheets (${syncResult.mode || 'verified'})`
      );
    } else {
      newBill.savedToSheets = false;
      newBill.sheetsSyncStatus = 'failed';
      newBill.sheetsSyncError = syncResult.error || 'Google Sheets synchronization pending';
      if (syncResult.spreadsheetId) {
        newBill.spreadsheetId = syncResult.spreadsheetId;
        newBill.spreadsheetUrl = syncResult.spreadsheetUrl;
      }
      console.warn(`[Sheets] Bill ${newBill.orderId} saved locally; Sheets sync pending: ${newBill.sheetsSyncError}`);
    }

    // 10. Persist permanently to disk storage
    await billStorage.saveBill(newBill);

    // Canonical JSON response containing the authoritative saved bill details
    res.status(200).json({
      success: true,
      message: newBill.savedToSheets
        ? 'Bill created and saved to Google Sheets successfully'
        : 'Bill saved locally (Pending Google Sheets synchronization)',
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
 * Retries Google Sheets synchronization for an existing bill (or client-queued bill)
 */
app.post('/api/bills/:id/retry-sheets', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { googleAccessToken, customSpreadsheetId, billPayload } = req.body || {};

    let bill = billStorage.getBill(id);
    if (!bill && billPayload && typeof billPayload === 'object' && billPayload.orderId) {
      bill = await billStorage.saveBill(billPayload as Bill);
    }

    if (!bill) {
      res.status(404).json({ error: 'Bill record not found' });
      return;
    }

    const syncResult = await syncBillToGoogleSheets(bill, {
      clientAccessToken: googleAccessToken,
      customSpreadsheetId: customSpreadsheetId || bill.spreadsheetId,
    });

    if (syncResult && syncResult.success) {
      const updated = await billStorage.updateBill(bill.id, {
        savedToSheets: true,
        sheetsSyncStatus: 'synced',
        sheetsSyncError: undefined,
        spreadsheetId: syncResult.spreadsheetId,
        spreadsheetUrl: syncResult.spreadsheetUrl,
      });

      res.json({
        success: true,
        message: 'Google Sheets synchronized successfully',
        bill: updated,
      });
      return;
    }

    throw new Error(syncResult?.error || 'Google Sheets did not confirm row write');
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
 * POST /api/bills/:id/send-whatsapp
 * Sends the bill receipt via Official WhatsApp Business Cloud API (if WHATSAPP_ACCESS_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID are configured in Netlify) or returns honest Click-to-Chat fallback details.
 */
app.post('/api/bills/:id/send-whatsapp', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const bill = billStorage.getBill(req.params.id) || (req.body?.bill as Bill | undefined);
    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }

    const formattedCustomerName = formatCustomerNameWithJi(bill.customerName);
    const cleanCountry = (bill.countryCode || '+91').replace(/\D/g, '') || '91';
    const cleanMobile = (bill.mobileNumber || '').replace(/\D/g, '').slice(-10);
    if (cleanMobile.length !== 10) {
      res.status(400).json({ error: 'Valid 10-digit customer mobile number is required for WhatsApp delivery.' });
      return;
    }

    const recipientPhone = `${cleanCountry}${cleanMobile}`;
    const itemsList = bill.items
      .map((i) => `• ${i.name} x ${i.quantity} (₹${i.unitPriceRupees.toFixed(2)}) = ₹${i.lineTotalRupees.toFixed(2)}`)
      .join('\n');

    const discountAmt = bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;
    const discountPct = bill.discountPercent || 0;

    const receiptMessage = `*ANNAPURNA CHOLE BHATURE*
POS Tax Invoice & Customer Receipt
Contact / WhatsApp: +91 8800896679
--------------------------------
Order ID: *${bill.orderId || bill.id}*
Bill No: ${bill.billNumber}
Order Type: ${bill.orderTypeLabel}
Date & Time: ${bill.dateTimeKolkata}
Customer: *${formattedCustomerName}*
Mobile: +${cleanCountry} ${cleanMobile}
--------------------------------
*ITEMS PURCHASED:*
${itemsList}
--------------------------------
Subtotal: ₹${bill.subtotalRupees.toFixed(2)}
Discount (${discountPct}%): -₹${discountAmt.toFixed(2)}
*FINAL PAYABLE AMOUNT: ₹${bill.grandTotalRupees.toFixed(2)}*
Payment Method: ${bill.paymentMethod || 'Cash'} (${bill.paymentStatus || 'Paid'})
--------------------------------
Thank you for visiting *ANNAPURNA CHOLE BHATURE*! We look forward to serving you again.`;

    const waClickToChatUrl = `https://wa.me/${recipientPhone}?text=${encodeURIComponent(receiptMessage)}`;

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();

    if (!accessToken || !phoneNumberId) {
      res.status(200).json({
        success: true,
        deliveredAutomatically: false,
        mode: 'click_to_chat',
        message:
          'WhatsApp Click-to-Chat link prepared. Please press Send inside WhatsApp to complete delivery to the customer.',
        waUrl: waClickToChatUrl,
        recipientPhone: `+${cleanCountry} ${cleanMobile}`,
        businessWhatsappNumber: '+91 8800896679',
      });
      return;
    }

    // Official Meta WhatsApp Business Cloud API request
    const graphUrl = `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`;
    const cloudRes = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'text',
        text: {
          preview_url: false,
          body: receiptMessage,
        },
      }),
    });

    const cloudData = await cloudRes.json();
    if (!cloudRes.ok) {
      const apiErr = cloudData?.error?.message || `HTTP ${cloudRes.status}`;
      res.status(502).json({
        success: false,
        deliveredAutomatically: false,
        mode: 'cloud_api_failed',
        error: `WhatsApp Cloud API error: ${apiErr}`,
        waUrl: waClickToChatUrl,
      });
      return;
    }

    res.status(200).json({
      success: true,
      deliveredAutomatically: true,
      mode: 'cloud_api',
      messageId: cloudData?.messages?.[0]?.id || undefined,
      message: `Bill receipt automatically sent via WhatsApp Business API to +${cleanCountry} ${cleanMobile}.`,
      waUrl: waClickToChatUrl,
    });
  } catch (err: any) {
    console.error('WhatsApp send error:', err);
    res.status(500).json({ error: err.message || 'Failed to process WhatsApp delivery' });
  }
});

/**
 * GET /api/bills/:id
 */
app.get('/api/bills/:id', requireAdminAuth, async (req: Request, res: Response) => {
  let bill = billStorage.getBill(req.params.id);
  if (!bill) {
    const clientToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
    await maybeHydrateFromSheets(clientToken);
    bill = billStorage.getBill(req.params.id);
  }
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
app.get(['/api/bills', '/api/bills/'], requireAdminAuth, async (req: Request, res: Response) => {
  const clientToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
  await maybeHydrateFromSheets(clientToken);

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
      `inline; filename="Annapurna-Bill-${bill.orderId || bill.billNumber}.pdf"`
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
app.get('/api/reports/monthly', requireAdminAuth, async (req: Request, res: Response) => {
  const clientToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
  await maybeHydrateFromSheets(clientToken);

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
 * Automatically synchronizes all pending and failed bills to Google Sheets in bulk,
 * and also pulls any remote bills from Google Sheets into local storage.
 */
app.post('/api/bills/batch-sync-sheets', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { googleAccessToken, customSpreadsheetId, clientPendingBills } = req.body || {};

    // Merge any client-side pending bills from localStorage first
    if (Array.isArray(clientPendingBills) && clientPendingBills.length > 0) {
      billStorage.mergeBillsFromSheets(clientPendingBills);
    }

    const sheetsStatus = getSheetsConnectionStatus(googleAccessToken, customSpreadsheetId);
    if (!sheetsStatus.configured) {
      res.status(400).json({
        error:
          'Google Sheets is not connected. Connect your Google Account or configure GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID in Netlify.',
      });
      return;
    }

    // Pull existing remote bills from Google Sheets first so we don't duplicate
    await maybeHydrateFromSheets(googleAccessToken, customSpreadsheetId);

    const { bills } = billStorage.listBills({ limit: 500 });
    const pendingBills = bills.filter((b) => !b.savedToSheets || b.sheetsSyncStatus !== 'synced');

    if (pendingBills.length === 0) {
      res.json({
        success: true,
        message: 'All bills are synchronized with Google Sheets.',
        syncedCount: 0,
        failedCount: 0,
        spreadsheetId: sheetsStatus.spreadsheetId,
        spreadsheetUrl: sheetsStatus.spreadsheetUrl,
      });
      return;
    }

    let syncedCount = 0;
    let failedCount = 0;
    let finalSheetId = sheetsStatus.spreadsheetId;
    let finalSheetUrl = sheetsStatus.spreadsheetUrl;
    const errors: string[] = [];

    // Sync in chronological order
    const orderedPending = [...pendingBills].sort((a, b) => a.timestamp - b.timestamp);

    for (const bill of orderedPending) {
      try {
        const syncResult = await syncBillToGoogleSheets(bill, {
          clientAccessToken: googleAccessToken,
          customSpreadsheetId: finalSheetId || customSpreadsheetId,
        });
        if (syncResult && syncResult.success) {
          finalSheetId = syncResult.spreadsheetId || finalSheetId;
          finalSheetUrl = syncResult.spreadsheetUrl || finalSheetUrl;
          await billStorage.updateBill(bill.id, {
            savedToSheets: true,
            sheetsSyncStatus: 'synced',
            sheetsSyncError: undefined,
            spreadsheetId: finalSheetId,
            spreadsheetUrl: finalSheetUrl,
          });
          syncedCount++;
        } else {
          failedCount++;
          const errMsg = syncResult?.error || 'Append returned unsuccessful status';
          errors.push(`Bill ${bill.orderId}: ${errMsg}`);
          await billStorage.updateBill(bill.id, {
            sheetsSyncStatus: 'failed',
            sheetsSyncError: errMsg,
          });
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
      success: syncedCount > 0 || failedCount === 0,
      message: `Batch sync complete: ${syncedCount} synced, ${failedCount} failed.`,
      syncedCount,
      failedCount,
      errors: errors.slice(0, 10),
      spreadsheetId: finalSheetId,
      spreadsheetUrl: finalSheetUrl,
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

export { app, PORT, ADMIN_USERNAME };
export default app;
