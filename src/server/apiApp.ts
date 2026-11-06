/**
 * Annpurna Chole Bhature - Production Express API Application
 * Pure production API module with zero development/Vite dependencies.
 * Imported by both the local/container server (server.ts) and the Netlify Serverless Function (netlify/functions/api.ts).
 */
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import dotenv from 'dotenv';
import {
  Bill,
  BillItem,
  MenuItemKey,
  OrderType,
  PaymentMethod,
  UserRole,
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
import { billToKitchenOrder } from '../utils/orderTimers';

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
 * Normalizes a User ID for case-insensitive and separator-tolerant matching.
 */
function normalizeUserSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

// Cryptographic scrypt parameters (No plaintext passwords stored in code)
const ACB_SCRYPT_SALT = 'acb-auth-v1-salt-annpurna-2026';

// Pre-computed one-way scrypt hashes (64-byte hex) for the 3 distinct profiles:
// 1. Annapurna Admin (`annapurna_admin`) + legacy admin hashes
const DEFAULT_ADMIN_SCRYPT_HASHES_HEX: readonly string[] = [
  '0245bba05441c6ac4f015d893011e9a4aa43465ec2bb6079001a0aa930a7de14b973d58128f11d715062f182fa5db00135648dece584f2a95a1f38187abab112',
  '9da0f18b241aec27d759875c9ed1ae8f73140873916ba972fb3a66445685f9d8de75df878a14dd2f44a8136ebe7b8c8504d8072b4c48b31d388e39d9aa1b8aea',
  '9ece98cf9631c43f053fe096e231eae1af6692b8dbaa883f091fa22988546222482e32a6cb252d3f242c517a9ebdfd8b8b560f941a52b0c486ad709617ed499d',
];

// 2. Annapurna Billing (`annapurna_billing`)
const DEFAULT_BILLING_SCRYPT_HASH_HEX =
  'b627ae0ab19cf54f56349cadef23c7211687a05b687d543d8a291c92f0279fecdfee04c9d466fc8f202422b7de7b9212d77e00430c4d2bb4310e43fad26e9a39';

// 3. Annapurna Order (`annapurna_order`)
const DEFAULT_ORDER_SCRYPT_HASH_HEX =
  'e8974a0ccebc6ca43241b8f52fa18ecf9ea76863d4aff6714083ced05c2b5e9f6b0ffae351381709fbfb31096ce38130430abaf74177963e4e5190f21ca41d19';

// Persistent custom scrypt credential overrides file (stores ONLY scrypt hashes when passwords are changed via UI/API)
const PRIMARY_CREDENTIALS_FILE = path.resolve(process.cwd(), 'data', 'credentials.json');
const TMP_CREDENTIALS_FILE = path.resolve(os.tmpdir(), 'annpurna-billing-data', 'credentials.json');

interface StoredCredentialOverrides {
  adminHashHex?: string;
  billingHashHex?: string;
  orderHashHex?: string;
  updatedAt?: number;
}

function loadCredentialOverrides(): StoredCredentialOverrides {
  for (const file of [PRIMARY_CREDENTIALS_FILE, TMP_CREDENTIALS_FILE]) {
    try {
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        if (raw.trim()) {
          return JSON.parse(raw) as StoredCredentialOverrides;
        }
      }
    } catch {
      // ignore read errors
    }
  }
  return {};
}

function saveCredentialOverrides(overrides: StoredCredentialOverrides): void {
  const payload = JSON.stringify({ ...overrides, updatedAt: Date.now() }, null, 2);
  try {
    const dir = path.dirname(PRIMARY_CREDENTIALS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PRIMARY_CREDENTIALS_FILE, payload, 'utf-8');
  } catch {
    try {
      const tmpDir = path.dirname(TMP_CREDENTIALS_FILE);
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(TMP_CREDENTIALS_FILE, payload, 'utf-8');
    } catch (err) {
      console.error('[Auth] Could not persist credential overrides:', err);
    }
  }
}

function getConfiguredAdminUsername(): string {
  return (
    cleanEnvValue(
      process.env.ADMIN_USERNAME ||
        process.env.APP_ADMIN_USERNAME ||
        process.env.VITE_ADMIN_USERNAME
    ) || 'annapurna_admin'
  );
}

const ADMIN_USERNAME = getConfiguredAdminUsername();

function getSessionSecret(): string {
  const envSecret = cleanEnvValue(process.env.ADMIN_JWT_SECRET);
  if (envSecret) return envSecret;
  return crypto
    .createHash('sha256')
    .update(`acb-stateless-jwt-secret-v2:${ACB_SCRYPT_SALT}:${DEFAULT_ADMIN_SCRYPT_HASHES_HEX[1]}`)
    .digest('hex');
}

// 24-Hour Session Validity (86,400,000 ms)
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
 * Resolves the active scrypt hash buffers for a specific role ('admin' | 'billing' | 'order').
 * Respects:
 * 1. Any password changed via `/api/auth/change-password` (stored as scrypt hash in `credentials.json`)
 * 2. Environment variables (`ADMIN_PASSWORD`, `BILLING_PASSWORD`, `ORDER_PASSWORD`)
 * 3. Pre-computed scrypt hashes for each role
 */
function getTargetScryptBuffersForRole(role: UserRole): Buffer[] {
  const overrides = loadCredentialOverrides();
  const buffers: Buffer[] = [];

  if (role === 'admin') {
    if (overrides.adminHashHex && overrides.adminHashHex.length === 128) {
      buffers.push(Buffer.from(overrides.adminHashHex, 'hex'));
    }
    const rawEnvPass = process.env.ADMIN_PASSWORD || process.env.APP_ADMIN_PASSWORD;
    if (rawEnvPass && typeof rawEnvPass === 'string') {
      const cleaned = cleanEnvValue(rawEnvPass);
      if (cleaned) buffers.push(crypto.scryptSync(cleaned, ACB_SCRYPT_SALT, 64));
    }
    for (const hex of DEFAULT_ADMIN_SCRYPT_HASHES_HEX) {
      buffers.push(Buffer.from(hex, 'hex'));
    }
  } else if (role === 'billing') {
    if (overrides.billingHashHex && overrides.billingHashHex.length === 128) {
      buffers.push(Buffer.from(overrides.billingHashHex, 'hex'));
    }
    const rawEnvPass = process.env.BILLING_PASSWORD || process.env.STAFF_PASSWORD;
    if (rawEnvPass && typeof rawEnvPass === 'string') {
      const cleaned = cleanEnvValue(rawEnvPass);
      if (cleaned) buffers.push(crypto.scryptSync(cleaned, ACB_SCRYPT_SALT, 64));
    }
    buffers.push(Buffer.from(DEFAULT_BILLING_SCRYPT_HASH_HEX, 'hex'));
  } else if (role === 'order') {
    if (overrides.orderHashHex && overrides.orderHashHex.length === 128) {
      buffers.push(Buffer.from(overrides.orderHashHex, 'hex'));
    }
    const rawEnvPass = process.env.ORDER_PASSWORD || process.env.KITCHEN_PASSWORD;
    if (rawEnvPass && typeof rawEnvPass === 'string') {
      const cleaned = cleanEnvValue(rawEnvPass);
      if (cleaned) buffers.push(crypto.scryptSync(cleaned, ACB_SCRYPT_SALT, 64));
    }
    buffers.push(Buffer.from(DEFAULT_ORDER_SCRYPT_HASH_HEX, 'hex'));
  }

  return buffers;
}

/**
 * Verifies a password in constant time using scrypt for a specific profile role.
 */
function verifyRolePasswordConstantTime(candidatePassword: string, role: UserRole): boolean {
  if (typeof candidatePassword !== 'string' || !candidatePassword) return false;

  const candidatesToCheck = [candidatePassword];
  const trimmedCandidate = candidatePassword.trim();
  if (trimmedCandidate && trimmedCandidate !== candidatePassword) {
    candidatesToCheck.push(trimmedCandidate);
  }

  const targetBuffers = getTargetScryptBuffersForRole(role);
  let matched = false;
  for (const candidate of candidatesToCheck) {
    for (const targetBuf of targetBuffers) {
      if (matchesScryptTargetConstantTime(candidate, targetBuf)) {
        matched = true;
      }
    }
  }
  return matched;
}

export function getProfileDisplayLabel(role: UserRole): string {
  if (role === 'admin') return 'Annapurna Admin';
  if (role === 'billing') return 'Annapurna Billing';
  return 'Annapurna Order';
}

/**
 * Resolves which of the 3 profiles (`admin`, `billing`, `order`) a User ID belongs to.
 */
function resolveAuthorizedProfile(candidateUsername: string): {
  authorized: boolean;
  canonicalUser: string;
  role: UserRole;
  profileLabel: string;
} {
  if (typeof candidateUsername !== 'string') {
    return { authorized: false, canonicalUser: '', role: 'admin', profileLabel: '' };
  }
  const slug = normalizeUserSlug(candidateUsername);
  if (!slug) {
    return { authorized: false, canonicalUser: '', role: 'admin', profileLabel: '' };
  }

  const configuredAdminSlug = normalizeUserSlug(getConfiguredAdminUsername());
  const configuredBillingSlug = normalizeUserSlug(
    cleanEnvValue(process.env.BILLING_USERNAME || process.env.STAFF_USERNAME || '')
  );
  const configuredOrderSlug = normalizeUserSlug(
    cleanEnvValue(process.env.ORDER_USERNAME || process.env.KITCHEN_USERNAME || '')
  );

  const validAdminSlugs = new Set<string>(
    [
      configuredAdminSlug,
      'annapurna_admin',
      'annpurna_admin',
      'annpurna_chole_bhature',
      'annapurna_chole_bhature',
      'annpurna',
      'annapurna',
      'admin',
    ].filter(Boolean)
  );

  const validBillingSlugs = new Set<string>(
    [
      configuredBillingSlug,
      'annapurna_billing',
      'annpurna_billing',
      'billing',
      'cashier',
      'counter',
    ].filter(Boolean)
  );

  const validOrderSlugs = new Set<string>(
    [
      configuredOrderSlug,
      'annapurna_order',
      'annpurna_order',
      'order',
      'kitchen',
      'worker',
    ].filter(Boolean)
  );

  if (validAdminSlugs.has(slug)) {
    return {
      authorized: true,
      canonicalUser: 'annapurna_admin',
      role: 'admin',
      profileLabel: 'Annapurna Admin',
    };
  }

  if (validBillingSlugs.has(slug)) {
    return {
      authorized: true,
      canonicalUser: 'annapurna_billing',
      role: 'billing',
      profileLabel: 'Annapurna Billing',
    };
  }

  if (validOrderSlugs.has(slug)) {
    return {
      authorized: true,
      canonicalUser: 'annapurna_order',
      role: 'order',
      profileLabel: 'Annapurna Order',
    };
  }

  return { authorized: false, canonicalUser: '', role: 'admin', profileLabel: '' };
}

// Revoked tokens set (for explicit logouts before 24h expiry)
const revokedTokens = new Set<string>();

export interface SignedSessionPayload {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
  jti: string;
}

function normalizeTokenRole(rawRole?: string): UserRole {
  if (rawRole === 'billing' || rawRole === 'staff') return 'billing';
  if (rawRole === 'order') return 'order';
  return 'admin';
}

function createSignedSessionToken(
  username: string,
  role: UserRole = 'admin'
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

    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    ) as SignedSessionPayload;
    if (!decoded || typeof decoded.exp !== 'number' || Date.now() > decoded.exp) {
      return null;
    }
    return {
      ...decoded,
      role: normalizeTokenRole(decoded.role),
    };
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
// Authentication & Role-Based Authorization Middleware
// -------------------------------------------------------------
function getVerifiedSessionFromRequest(req: Request): SignedSessionPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  return verifySignedSessionToken(token);
}

function requireRoles(allowedRoles: readonly UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = getVerifiedSessionFromRequest(req);
    if (!session) {
      res.status(401).json({
        error: 'Unauthorized: Invalid or expired 24-hour session. Please log in again.',
      });
      return;
    }

    if (!allowedRoles.includes(session.role)) {
      res.status(403).json({
        error: `Forbidden: The ${getProfileDisplayLabel(session.role)} profile is not authorized to access this resource.`,
      });
      return;
    }

    (req as any).authSession = session;
    next();
  };
}

const requireAdminOnly = requireRoles(['admin']);
const requireAdminOrBilling = requireRoles(['admin', 'billing']);
const requireAdminOrOrder = requireRoles(['admin', 'order']);
const requireAnyAuthenticatedProfile = requireRoles(['admin', 'billing', 'order']);

function sanitizeBillForBillingProfile(bill: Bill): Bill {
  const clone: Bill = { ...bill };
  delete clone.spreadsheetId;
  delete clone.spreadsheetUrl;
  return clone;
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
 * Authenticates one of the 3 distinct profiles:
 * 1. Annapurna Admin (`annapurna_admin`)
 * 2. Annapurna Billing (`annapurna_billing`)
 * 3. Annapurna Order (`annapurna_order`)
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
  const expectedProfileRole = payload?.expectedRole as UserRole | undefined;

  if (
    !rawUsername ||
    !rawPassword ||
    typeof rawUsername !== 'string' ||
    typeof rawPassword !== 'string'
  ) {
    res.status(400).json({ error: 'Both User ID and Password are required.' });
    return;
  }

  const profileCheck = resolveAuthorizedProfile(rawUsername);
  if (!profileCheck.authorized) {
    res.status(401).json({ error: 'Invalid User ID or Password. Access denied.' });
    return;
  }

  // If the user selected a specific profile tab on the login screen, ensure the User ID matches that profile
  if (
    expectedProfileRole &&
    ['admin', 'billing', 'order'].includes(expectedProfileRole) &&
    profileCheck.role !== expectedProfileRole
  ) {
    res.status(401).json({
      error: `User ID "${rawUsername.trim()}" belongs to ${profileCheck.profileLabel}, not ${getProfileDisplayLabel(expectedProfileRole)}. Please switch to the ${profileCheck.profileLabel} tab.`,
    });
    return;
  }

  const passwordValid = verifyRolePasswordConstantTime(rawPassword, profileCheck.role);

  if (passwordValid) {
    const { token: sessionToken, expiresAt } = createSignedSessionToken(
      profileCheck.canonicalUser,
      profileCheck.role
    );

    res.status(200).json({
      success: true,
      message: `Authenticated as ${profileCheck.profileLabel}`,
      token: sessionToken,
      username: profileCheck.canonicalUser,
      role: profileCheck.role,
      profileLabel: profileCheck.profileLabel,
      expiresAt,
    });
    return;
  }

  res.status(401).json({ error: 'Invalid User ID or Password. Access denied.' });
});

/**
 * POST /api/auth/change-password
 * Allows Admin to update the password for any of the three profiles (`admin`, `billing`, `order`),
 * or allows a logged-in profile to change its own password by verifying `currentPassword`.
 * Stores only the one-way 64-byte scrypt hash — never plaintext.
 */
app.post(
  ['/api/auth/change-password', '/api/auth/change-password/'],
  requireAdminOnly,
  (req: Request, res: Response) => {
    const session: SignedSessionPayload = (req as any).authSession;
    const { targetRole, currentPassword, newPassword } = req.body || {};

    const roleToUpdate: UserRole =
      targetRole && ['admin', 'billing', 'order'].includes(targetRole)
        ? (targetRole as UserRole)
        : session.role;

    if (typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      res.status(400).json({
        error: 'New password must be at least 6 characters long.',
      });
      return;
    }

    // Verify currentPassword of the caller's profile
    if (
      typeof currentPassword !== 'string' ||
      !verifyRolePasswordConstantTime(currentPassword, session.role)
    ) {
      res.status(401).json({
        error: 'Current password verification failed.',
      });
      return;
    }

    const derivedHex = crypto
      .scryptSync(newPassword.trim(), ACB_SCRYPT_SALT, 64)
      .toString('hex');
    const overrides = loadCredentialOverrides();
    if (roleToUpdate === 'admin') {
      overrides.adminHashHex = derivedHex;
    } else if (roleToUpdate === 'billing') {
      overrides.billingHashHex = derivedHex;
    } else {
      overrides.orderHashHex = derivedHex;
    }
    saveCredentialOverrides(overrides);

    res.json({
      success: true,
      message: `Password for ${getProfileDisplayLabel(roleToUpdate)} updated securely.`,
      updatedRole: roleToUpdate,
    });
  }
);

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
  const session = getVerifiedSessionFromRequest(req);
  if (session) {
    res.json({
      isAuthenticated: true,
      username: session.sub,
      role: session.role,
      profileLabel: getProfileDisplayLabel(session.role),
      expiresAt: session.exp,
    });
    return;
  }
  res.status(401).json({ isAuthenticated: false, error: 'Invalid or expired 24-hour session' });
});

/**
 * GET /api/menu
 */
app.get('/api/menu', requireAdminOrBilling, (req: Request, res: Response) => {
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
 * GET /api/sheets/status (Admin Only)
 * Returns authoritative server-side + client Google Sheets & WhatsApp Cloud API connection status
 */
app.get('/api/sheets/status', requireAdminOnly, async (req: Request, res: Response) => {
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
 * GET /api/metrics (Admin Only)
 * Returns authoritative business analytics (including 24-hour rolling window stats) for dashboard cards
 */
app.get(['/api/metrics', '/api/metrics/'], requireAdminOnly, async (req: Request, res: Response) => {
  const clientToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
  const customSheetId = typeof req.query.sheetId === 'string' ? req.query.sheetId : undefined;
  await maybeHydrateFromSheets(clientToken, customSheetId);
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const metrics = billStorage.getMetrics(userId);
  res.json({
    metrics,
    bills: billStorage.getAllBills(),
    lastResetTimestamp: billStorage.getLastResetTimestamp(),
  });
});

/**
 * POST /api/bills/hydrate (Admin and Billing; financial metrics stripped for Billing)
 */
app.post(['/api/bills/hydrate', '/api/bills/hydrate/'], requireAdminOrBilling, async (req: Request, res: Response) => {
  try {
    const session: SignedSessionPayload = (req as any).authSession;
    const { clientBills, googleAccessToken, customSpreadsheetId } = req.body || {};
    const headerToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
    const effectiveToken = googleAccessToken || headerToken;

    if (Array.isArray(clientBills) && clientBills.length > 0) {
      billStorage.mergeClientBills(clientBills);
    }

    if (session.role === 'admin') {
      await maybeHydrateFromSheets(effectiveToken, customSpreadsheetId);
    } else {
      await maybeHydrateFromSheets();
    }

    const allBills = billStorage.getAllBills();
    const lastResetTimestamp = billStorage.getLastResetTimestamp();

    if (session.role === 'billing') {
      res.json({
        success: true,
        bills: allBills.map(sanitizeBillForBillingProfile),
        lastResetTimestamp,
      });
      return;
    }

    const metrics = billStorage.getMetrics();
    res.json({
      success: true,
      metrics,
      bills: allBills,
      lastResetTimestamp,
    });
  } catch (err: any) {
    console.error('[Bills Hydrate Error]:', err);
    res.status(500).json({ error: err.message || 'Failed to hydrate bills' });
  }
});

/**
 * POST /api/bills/calculate
 */
app.post('/api/bills/calculate', requireAdminOrBilling, (req: Request, res: Response) => {
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
app.post(['/api/bills', '/api/bills/'], requireAdminOrBilling, async (req: Request, res: Response) => {
  try {
    const session: SignedSessionPayload = (req as any).authSession;
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
      specialInstructions,
      idempotencyKey,
      userId,
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

    // 8. Idempotency & Duplicate Submission Protection
    const itemCount = validatedItems.reduce((sum, item) => sum + item.quantity, 0);
    const itemDetailsSummary = validatedItems.map((i) => `${i.name} (${i.quantity})`).join(', ');
    const itemPricesSummary = validatedItems.map((i) => `${i.name}: Rs ${i.unitPriceRupees}`).join(', ');
    const nowMs = Date.now();
    const cleanedIdempotencyKey =
      typeof idempotencyKey === 'string' && idempotencyKey.trim()
        ? idempotencyKey.trim().slice(0, 128)
        : undefined;

    const existingDuplicate = billStorage.findExistingDuplicateBill({
      idempotencyKey: cleanedIdempotencyKey,
      customerName: trimmedName,
      mobileNumber: cleanMobile,
      orderType: validatedOrderType,
      grandTotalPaise,
      itemDetailsSummary,
      nowMs,
    });

    if (existingDuplicate) {
      const dupResponseBill =
        session.role === 'billing'
          ? sanitizeBillForBillingProfile(existingDuplicate)
          : existingDuplicate;
      res.status(200).json({
        success: true,
        duplicatePrevented: true,
        message: 'Bill already created (duplicate submission prevented)',
        bill: dupResponseBill,
        order: billToKitchenOrder(existingDuplicate, nowMs),
        id: dupResponseBill.id,
        orderId: dupResponseBill.orderId,
        billNumber: dupResponseBill.billNumber,
        orderType: dupResponseBill.orderType,
        orderTypeLabel: dupResponseBill.orderTypeLabel,
        customerName: dupResponseBill.customerName,
        mobileNumber: dupResponseBill.mobileNumber,
        countryCode: dupResponseBill.countryCode,
        items: dupResponseBill.items,
        subtotalRupees: dupResponseBill.subtotalRupees,
        discountPercent: dupResponseBill.discountPercent,
        discountAmountRupees: dupResponseBill.discountAmountRupees,
        discountRupees: dupResponseBill.discountAmountRupees,
        grandTotalRupees: dupResponseBill.grandTotalRupees,
        paymentMethod: dupResponseBill.paymentMethod,
        paymentStatus: dupResponseBill.paymentStatus,
        billDate: dupResponseBill.billDate,
        billTime: dupResponseBill.billTime,
        dateTimeKolkata: dupResponseBill.dateTimeKolkata,
        timestamp: dupResponseBill.timestamp,
        orderStatus: dupResponseBill.orderStatus,
        orderCreatedAt: dupResponseBill.orderCreatedAt,
        savedToSheets: dupResponseBill.savedToSheets,
        sheetsSyncStatus: dupResponseBill.sheetsSyncStatus,
        sheetsSyncError: dupResponseBill.sheetsSyncError,
        spreadsheetId: dupResponseBill.spreadsheetId,
        spreadsheetUrl: dupResponseBill.spreadsheetUrl,
      });
      return;
    }

    // Generate Unique Order ID & Bill Number
    const uniqueBillId = `BILL-${crypto.randomUUID()}`;
    const orderId = billStorage.generateOrderId();
    const billNumber = billStorage.generateBillNumber();

    const cleanedInstructions =
      typeof specialInstructions === 'string' && specialInstructions.trim()
        ? specialInstructions.trim().slice(0, 240)
        : undefined;

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
      timestamp: nowMs,
      userId:
        typeof userId === 'string' && userId
          ? userId
          : session?.sub || 'annapurna_admin',
      savedToSheets: false,
      sheetsSyncStatus: 'pending',
      orderStatus: 'WAITING',
      orderCreatedAt: nowMs,
      specialInstructions: cleanedInstructions,
      idempotencyKey: cleanedIdempotencyKey,
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

    const responseBill =
      session.role === 'billing' ? sanitizeBillForBillingProfile(newBill) : newBill;

    // Canonical JSON response containing the authoritative saved bill details + kitchen order
    res.status(200).json({
      success: true,
      message: newBill.savedToSheets
        ? 'Bill created and saved to Google Sheets successfully'
        : 'Bill saved locally (Pending Google Sheets synchronization)',
      bill: responseBill,
      order: billToKitchenOrder(newBill, nowMs),
      id: responseBill.id,
      orderId: responseBill.orderId,
      billNumber: responseBill.billNumber,
      orderType: responseBill.orderType,
      orderTypeLabel: responseBill.orderTypeLabel,
      customerName: responseBill.customerName,
      mobileNumber: responseBill.mobileNumber,
      countryCode: responseBill.countryCode,
      items: responseBill.items,
      subtotalRupees: responseBill.subtotalRupees,
      discountPercent: responseBill.discountPercent,
      discountAmountRupees: responseBill.discountAmountRupees,
      discountRupees: responseBill.discountAmountRupees,
      grandTotalRupees: responseBill.grandTotalRupees,
      paymentMethod: responseBill.paymentMethod,
      paymentStatus: responseBill.paymentStatus,
      billDate: responseBill.billDate,
      billTime: responseBill.billTime,
      dateTimeKolkata: responseBill.dateTimeKolkata,
      timestamp: responseBill.timestamp,
      orderStatus: responseBill.orderStatus,
      orderCreatedAt: responseBill.orderCreatedAt,
      savedToSheets: responseBill.savedToSheets,
      sheetsSyncStatus: responseBill.sheetsSyncStatus,
      sheetsSyncError: responseBill.sheetsSyncError,
      spreadsheetId: responseBill.spreadsheetId,
      spreadsheetUrl: responseBill.spreadsheetUrl,
    });
  } catch (error: any) {
    console.error('Create bill error:', error);
    res.status(500).json({ error: error.message || 'Internal server error while creating bill' });
  }
});

/**
 * POST /api/bills/:id/retry-sheets (Admin Only)
 * Retries Google Sheets synchronization for an existing bill (or client-queued bill)
 */
app.post('/api/bills/:id/retry-sheets', requireAdminOnly, async (req: Request, res: Response) => {
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
 * POST /api/bills/:id/send-whatsapp (Admin and Billing)
 */
app.post('/api/bills/:id/send-whatsapp', requireAdminOrBilling, async (req: Request, res: Response) => {
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

// -------------------------------------------------------------
// Live Kitchen Order Endpoints (Shared across Admin, Billing & Order)
// -------------------------------------------------------------

/**
 * GET /api/orders
 * Returns sanitized live KitchenOrder[] records (zero financial data).
 * Accessible to Admin, Billing (for order status visibility), and Order (Kitchen Worker).
 */
app.get(['/api/orders', '/api/orders/'], requireAnyAuthenticatedProfile, async (req: Request, res: Response) => {
  try {
    const nowMs = Date.now();
    const orders = billStorage.getKitchenOrders(nowMs);
    const fifoOrders = orders
      .filter((o) => o.status !== 'COMPLETED')
      .sort((a, b) => a.createdAt - b.createdAt);
    const completedOrders = orders
      .filter((o) => o.status === 'COMPLETED')
      .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt));

    res.json({
      success: true,
      orders,
      fifoOrders,
      completedOrders,
      counts: {
        total: orders.length,
        waiting: orders.filter((o) => o.status === 'WAITING').length,
        preparing: orders.filter((o) => o.status === 'PREPARING').length,
        late: orders.filter((o) => o.status === 'LATE').length,
        completed: completedOrders.length,
      },
      serverTime: nowMs,
      lastResetTimestamp: billStorage.getLastResetTimestamp(),
    });
  } catch (err: any) {
    console.error('Get kitchen orders error:', err);
    res.status(500).json({ error: err.message || 'Failed to load kitchen orders' });
  }
});

/**
 * POST /api/orders/:id/start
 * Transitions an order from WAITING -> PREPARING, recording the exact start timestamp
 * and starting the 3-minute preparation timer.
 * Permitted ONLY for Order (kitchen worker) and Admin profiles. Blocked for Billing.
 */
app.post('/api/orders/:id/start', requireAdminOrOrder, async (req: Request, res: Response) => {
  try {
    const session: SignedSessionPayload = (req as any).authSession;
    const { id } = req.params;
    const nowMs = Date.now();

    const result = await billStorage.startKitchenOrder(id, session.sub, nowMs);
    if (!result) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json({
      success: true,
      alreadyStarted: result.alreadyStarted,
      message: result.alreadyStarted
        ? `Order ${result.order.orderNumber} is already in preparation`
        : `Order ${result.order.orderNumber} started! 3-minute preparation timer running.`,
      order: result.order,
      bill: session.role === 'admin' ? result.bill : undefined,
      serverTime: nowMs,
    });
  } catch (err: any) {
    console.error('Start order error:', err);
    res.status(500).json({ error: err.message || 'Failed to start order' });
  }
});

/**
 * POST /api/orders/:id/complete
 * Transitions an order to COMPLETED, recording the exact completion timestamp
 * and stopping all preparation and late timers.
 * Permitted ONLY for Order (kitchen worker) and Admin profiles. Blocked for Billing.
 */
app.post('/api/orders/:id/complete', requireAdminOrOrder, async (req: Request, res: Response) => {
  try {
    const session: SignedSessionPayload = (req as any).authSession;
    const { id } = req.params;
    const nowMs = Date.now();

    const result = await billStorage.completeKitchenOrder(id, session.sub, nowMs);
    if (!result) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    res.json({
      success: true,
      alreadyCompleted: result.alreadyCompleted,
      message: `Order ${result.order.orderNumber} marked as Completed!`,
      order: result.order,
      bill: session.role === 'admin' ? result.bill : undefined,
      serverTime: nowMs,
    });
  } catch (err: any) {
    console.error('Complete order error:', err);
    res.status(500).json({ error: err.message || 'Failed to complete order' });
  }
});

/**
 * GET /api/bills/:id (Admin and Billing)
 */
app.get('/api/bills/:id', requireAdminOrBilling, async (req: Request, res: Response) => {
  const session: SignedSessionPayload = (req as any).authSession;
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
  res.json({
    bill: session.role === 'billing' ? sanitizeBillForBillingProfile(bill) : bill,
  });
});

/**
 * GET /api/bills (Admin and Billing; revenue metrics stripped for Billing)
 * Lists ALL historical bills with search (by Order ID, Customer, Phone), filters, and pagination
 */
app.get(['/api/bills', '/api/bills/'], requireAdminOrBilling, async (req: Request, res: Response) => {
  const session: SignedSessionPayload = (req as any).authSession;
  const clientToken = typeof req.headers['x-google-token'] === 'string' ? req.headers['x-google-token'] : undefined;
  await maybeHydrateFromSheets(session.role === 'admin' ? clientToken : undefined);

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

  if (session.role === 'billing') {
    res.json({
      ...result,
      bills: result.bills.map(sanitizeBillForBillingProfile),
      lastResetTimestamp: billStorage.getLastResetTimestamp(),
    });
    return;
  }

  const metrics = billStorage.getMetrics(typeof userId === 'string' ? userId : undefined);

  res.json({
    ...result,
    metrics,
    lastResetTimestamp: billStorage.getLastResetTimestamp(),
  });
});

/**
 * POST /api/admin/reset-sales (Admin Only)
 * Permanently resets all historical sales records, bill history, financial transaction records,
 * daily/24h/monthly sales totals, sales calendar entries, and completed/waiting kitchen orders.
 * Requires mandatory dual verification:
 *   1. Current Admin password (verified in constant time using scrypt)
 *   2. Exact typed confirmation phrase: "RESET ALL SALES DATA"
 *   3. Blocks reset with 409 Conflict if any kitchen order is actively PREPARING or LATE.
 */
app.post(
  ['/api/admin/reset-sales', '/api/admin/reset-sales/'],
  requireAdminOnly,
  async (req: Request, res: Response) => {
    try {
      const session: SignedSessionPayload = (req as any).authSession;
      const { adminPassword, confirmationPhrase } = req.body || {};

      // 1. Validate Admin Password
      if (typeof adminPassword !== 'string' || !adminPassword.trim()) {
        res.status(400).json({
          error: 'Admin password is required to authorize sales data reset.',
        });
        return;
      }

      if (!verifyRolePasswordConstantTime(adminPassword, 'admin')) {
        res.status(401).json({
          error: 'Invalid Admin password. Sales data reset denied.',
        });
        return;
      }

      // 2. Validate Exact Typed Confirmation Phrase
      const cleanedPhrase =
        typeof confirmationPhrase === 'string' ? confirmationPhrase.trim() : '';
      if (cleanedPhrase !== 'RESET ALL SALES DATA') {
        res.status(400).json({
          error: 'Please type the exact confirmation phrase: RESET ALL SALES DATA',
        });
        return;
      }

      // 3. Guard Active Preparing Kitchen Orders
      const nowMs = Date.now();
      const activePreparingOrders = billStorage.getActivePreparingOrders(nowMs);
      if (activePreparingOrders.length > 0) {
        const activeNums = activePreparingOrders.map((o) => o.orderNumber).join(', ');
        res.status(409).json({
          error: `Cannot reset sales data while ${activePreparingOrders.length} kitchen order(s) (${activeNums}) are actively being prepared. Please mark active kitchen orders as Completed first.`,
          activeOrdersCount: activePreparingOrders.length,
          activeOrderNumbers: activePreparingOrders.map((o) => o.orderNumber),
        });
        return;
      }

      // 4. Execute Transactional Sales Data Reset + Audit Log
      const { auditEntry, lastResetTimestamp } = await billStorage.resetAllSalesData(
        session.sub,
        nowMs
      );

      res.status(200).json({
        success: true,
        message: `All sales data, bill history, and completed orders (${auditEntry.deletedBillsCount} records) have been reset to ₹0.00.`,
        auditEntry,
        lastResetTimestamp,
        metrics: billStorage.getMetrics(undefined, nowMs),
      });
    } catch (err: any) {
      console.error('[Admin Reset Sales Error]:', err);
      res.status(500).json({
        error: err?.message || 'Failed to reset sales data.',
      });
    }
  }
);

/**
 * GET /api/admin/reset-audit (Admin Only)
 * Returns the audit log of past sales data resets and the current reset watermark.
 */
app.get(
  ['/api/admin/reset-audit', '/api/admin/reset-audit/'],
  requireAdminOnly,
  (req: Request, res: Response) => {
    res.json({
      success: true,
      lastResetTimestamp: billStorage.getLastResetTimestamp(),
      auditLog: billStorage.getResetAuditLog(),
    });
  }
);

/**
 * GET /api/bills/:id/pdf (Admin and Billing)
 */
app.get('/api/bills/:id/pdf', requireAdminOrBilling, async (req: Request, res: Response) => {
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
 * GET /api/reports/monthly (Admin Only)
 */
app.get('/api/reports/monthly', requireAdminOnly, async (req: Request, res: Response) => {
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
 * POST /api/bills/batch-sync-sheets (Admin Only)
 */
app.post('/api/bills/batch-sync-sheets', requireAdminOnly, async (req: Request, res: Response) => {
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
