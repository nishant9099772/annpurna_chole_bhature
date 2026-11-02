/**
 * Capacitor Android Local API Engine
 *
 * When the application is packaged as an Android APK using Capacitor (`npx cap sync android`),
 * the Android WebView serves static assets from `https://localhost` (or `capacitor://localhost`).
 * If no external backend server URL is configured (or if `/api/*` hits Capacitor's local
 * `WebViewLocalServer` which returns `index.html` with HTTP 200), this module executes the exact
 * same production API routes, cryptographic scrypt authentication, integer-paise bill calculations,
 * 24-hour rolling metrics, and persistent ledger operations locally inside the Android APK.
 */

import {
  Bill,
  BillItem,
  MenuItemKey,
  OrderType,
  PaymentMethod,
  OFFICIAL_MENU_ITEMS,
} from '../types/billing';
import { formatCustomerNameWithJi } from './customerFormat';
import {
  computeBusinessMetricsFromBills,
  deduplicateBills,
  getKolkataDateString,
  resolveBillTimestampMs,
} from './billTimestamp';
import {
  buildMonthlyReportFromBills,
  loadPersistentBills,
  savePersistentBills,
  upsertPersistentBill,
} from './persistentBillsStorage';

// Exact cryptographic scrypt parameters & authorized hashes matching src/server/apiApp.ts
const ACB_SCRYPT_SALT = 'acb-auth-v1-salt-annpurna-2026';
const AUTHORIZED_SCRYPT_HASHES_HEX: readonly string[] = [
  '9da0f18b241aec27d759875c9ed1ae8f73140873916ba972fb3a66445685f9d8de75df878a14dd2f44a8136ebe7b8c8504d8072b4c48b31d388e39d9aa1b8aea',
  '9ece98cf9631c43f053fe096e231eae1af6692b8dbaa883f091fa22988546222482e32a6cb252d3f242c517a9ebdfd8b8b560f941a52b0c486ad709617ed499d',
];

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const revokedLocalTokens = new Set<string>();

const AUTHORITATIVE_PRICES_PAISE: Record<Exclude<MenuItemKey, 'COLD_DRINK'>, number> = {
  CHOLE_BHATURE: 8000, // Rs 80.00
  LASSI: 4000,         // Rs 40.00
  CHOLE: 4000,         // Rs 40.00
  BHATURE: 2500,       // Rs 25.00
};

function normalizeUserSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isAuthorizedUserId(candidateUsername: string): {
  authorized: boolean;
  canonicalUser: string;
  role: 'admin' | 'staff';
} {
  if (typeof candidateUsername !== 'string') {
    return { authorized: false, canonicalUser: '', role: 'admin' };
  }
  const slug = normalizeUserSlug(candidateUsername);
  if (!slug) {
    return { authorized: false, canonicalUser: '', role: 'admin' };
  }

  const validAdminSlugs = new Set<string>([
    'annpurna_chole_bhature',
    'annapurna_chole_bhature',
    'annpurna',
    'annapurna',
    'admin',
  ]);
  const validStaffSlugs = new Set<string>(['cashier', 'staff', 'counter']);

  if (validAdminSlugs.has(slug)) {
    return {
      authorized: true,
      canonicalUser:
        slug === 'annapurna_chole_bhature' ? 'annpurna_chole_bhature' : candidateUsername.trim(),
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

// ---------------------------------------------------------------------------
// RFC 7914 Scrypt (N=16384, r=8, p=1, dkLen=64) using Web Crypto PBKDF2-SHA256
// Matches Node.js crypto.scryptSync(password, ACB_SCRYPT_SALT, 64) bit-for-bit
// ---------------------------------------------------------------------------

function salsa20_8(B: Uint32Array): void {
  let x0 = B[0], x1 = B[1], x2 = B[2], x3 = B[3],
      x4 = B[4], x5 = B[5], x6 = B[6], x7 = B[7],
      x8 = B[8], x9 = B[9], x10 = B[10], x11 = B[11],
      x12 = B[12], x13 = B[13], x14 = B[14], x15 = B[15];

  for (let i = 0; i < 8; i += 2) {
    let u = (x0 + x12) | 0; x4 ^= (u << 7) | (u >>> 25);
    u = (x4 + x0) | 0; x8 ^= (u << 9) | (u >>> 23);
    u = (x8 + x4) | 0; x12 ^= (u << 13) | (u >>> 19);
    u = (x12 + x8) | 0; x0 ^= (u << 18) | (u >>> 14);

    u = (x5 + x1) | 0; x9 ^= (u << 7) | (u >>> 25);
    u = (x9 + x5) | 0; x13 ^= (u << 9) | (u >>> 23);
    u = (x13 + x9) | 0; x1 ^= (u << 13) | (u >>> 19);
    u = (x1 + x13) | 0; x5 ^= (u << 18) | (u >>> 14);

    u = (x10 + x6) | 0; x14 ^= (u << 7) | (u >>> 25);
    u = (x14 + x10) | 0; x2 ^= (u << 9) | (u >>> 23);
    u = (x2 + x14) | 0; x6 ^= (u << 13) | (u >>> 19);
    u = (x6 + x2) | 0; x10 ^= (u << 18) | (u >>> 14);

    u = (x15 + x11) | 0; x3 ^= (u << 7) | (u >>> 25);
    u = (x3 + x15) | 0; x7 ^= (u << 9) | (u >>> 23);
    u = (x7 + x3) | 0; x11 ^= (u << 13) | (u >>> 19);
    u = (x11 + x7) | 0; x15 ^= (u << 18) | (u >>> 14);

    u = (x0 + x3) | 0; x1 ^= (u << 7) | (u >>> 25);
    u = (x1 + x0) | 0; x2 ^= (u << 9) | (u >>> 23);
    u = (x2 + x1) | 0; x3 ^= (u << 13) | (u >>> 19);
    u = (x3 + x2) | 0; x0 ^= (u << 18) | (u >>> 14);

    u = (x5 + x4) | 0; x6 ^= (u << 7) | (u >>> 25);
    u = (x6 + x5) | 0; x7 ^= (u << 9) | (u >>> 23);
    u = (x7 + x6) | 0; x4 ^= (u << 13) | (u >>> 19);
    u = (x4 + x7) | 0; x5 ^= (u << 18) | (u >>> 14);

    u = (x10 + x9) | 0; x11 ^= (u << 7) | (u >>> 25);
    u = (x11 + x10) | 0; x8 ^= (u << 9) | (u >>> 23);
    u = (x8 + x11) | 0; x9 ^= (u << 13) | (u >>> 19);
    u = (x9 + x8) | 0; x10 ^= (u << 18) | (u >>> 14);

    u = (x15 + x14) | 0; x12 ^= (u << 7) | (u >>> 25);
    u = (x12 + x15) | 0; x13 ^= (u << 9) | (u >>> 23);
    u = (x13 + x12) | 0; x14 ^= (u << 13) | (u >>> 19);
    u = (x14 + x13) | 0; x15 ^= (u << 18) | (u >>> 14);
  }

  B[0] = (B[0] + x0) | 0; B[1] = (B[1] + x1) | 0; B[2] = (B[2] + x2) | 0; B[3] = (B[3] + x3) | 0;
  B[4] = (B[4] + x4) | 0; B[5] = (B[5] + x5) | 0; B[6] = (B[6] + x6) | 0; B[7] = (B[7] + x7) | 0;
  B[8] = (B[8] + x8) | 0; B[9] = (B[9] + x9) | 0; B[10] = (B[10] + x10) | 0; B[11] = (B[11] + x11) | 0;
  B[12] = (B[12] + x12) | 0; B[13] = (B[13] + x13) | 0; B[14] = (B[14] + x14) | 0; B[15] = (B[15] + x15) | 0;
}

function blockMix(B: Uint32Array, Y: Uint32Array, r: number): void {
  const X = new Uint32Array(16);
  const blockCount = 2 * r;
  X.set(B.subarray((blockCount - 1) * 16, blockCount * 16));

  for (let i = 0; i < blockCount; i++) {
    const offset = i * 16;
    for (let j = 0; j < 16; j++) {
      X[j] ^= B[offset + j];
    }
    salsa20_8(X);
    const destOffset = (i & 1) === 0 ? (i >>> 1) * 16 : (r + (i >>> 1)) * 16;
    Y.set(X, destOffset);
  }
  B.set(Y);
}

async function pbkdf2Sha256(passwordBytes: Uint8Array, saltBytes: Uint8Array, dkLen: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBytes as unknown as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBytes as unknown as BufferSource,
      iterations: 1,
    },
    keyMaterial,
    dkLen * 8
  );
  return new Uint8Array(bits);
}

export async function deriveScryptHex(password: string, salt: string): Promise<string> {
  const N = 16384;
  const r = 8;
  const maxWords = 32 * r; // 256 uint32 = 1024 bytes
  const encoder = new TextEncoder();
  const passBytes = encoder.encode(password);
  const saltBytes = encoder.encode(salt);

  const BBytes = await pbkdf2Sha256(passBytes, saltBytes, 128 * r);
  const B = new Uint32Array(maxWords);
  const view = new DataView(BBytes.buffer, BBytes.byteOffset, BBytes.byteLength);
  for (let i = 0; i < maxWords; i++) {
    B[i] = view.getUint32(i * 4, true);
  }

  const V = new Uint32Array(N * maxWords);
  const Y = new Uint32Array(maxWords);

  for (let i = 0; i < N; i++) {
    V.set(B, i * maxWords);
    blockMix(B, Y, r);
  }

  const mask = N - 1;
  const jOffset = (2 * r - 1) * 16;
  for (let i = 0; i < N; i++) {
    const j = B[jOffset] & mask;
    const vBase = j * maxWords;
    for (let k = 0; k < maxWords; k++) {
      B[k] ^= V[vBase + k];
    }
    blockMix(B, Y, r);
  }

  for (let i = 0; i < maxWords; i++) {
    view.setUint32(i * 4, B[i], true);
  }

  const derived = await pbkdf2Sha256(passBytes, BBytes, 64);
  return Array.from(derived)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyPasswordScrypt(candidatePassword: string): Promise<boolean> {
  if (typeof candidatePassword !== 'string' || !candidatePassword) return false;

  const candidates = [candidatePassword];
  const trimmed = candidatePassword.trim();
  if (trimmed && trimmed !== candidatePassword) {
    candidates.push(trimmed);
  }

  let matched = false;
  for (const candidate of candidates) {
    const candidateHex = await deriveScryptHex(candidate, ACB_SCRYPT_SALT);
    for (const targetHex of AUTHORIZED_SCRYPT_HASHES_HEX) {
      if (constantTimeHexEqual(candidateHex, targetHex)) {
        matched = true;
      }
    }
  }
  return matched;
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function computeHmacB64Url(payloadB64: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretSeed = `acb-stateless-jwt-secret-v2:${ACB_SCRYPT_SALT}:${AUTHORIZED_SCRYPT_HASHES_HEX[0]}`;
  const secretHashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(secretSeed));
  const secretHex = Array.from(new Uint8Array(secretHashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const sigBytes = new Uint8Array(sigBuf);
  let binary = '';
  for (let i = 0; i < sigBytes.length; i++) {
    binary += String.fromCharCode(sigBytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function createLocalSignedToken(
  username: string,
  role: 'admin' | 'staff'
): Promise<{ token: string; expiresAt: number }> {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  const jti = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const payload = {
    sub: username,
    role,
    iat: now,
    exp: expiresAt,
    jti,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sigB64 = await computeHmacB64Url(payloadB64);
  return {
    token: `acb.${payloadB64}.${sigB64}`,
    expiresAt,
  };
}

function verifyLocalTokenPayload(token?: string | null): {
  sub: string;
  role: 'admin' | 'staff';
  exp: number;
} | null {
  if (!token || typeof token !== 'string') return null;
  const clean = token.trim();
  if (!clean || revokedLocalTokens.has(clean)) return null;

  const parts = clean.split('.');
  if (parts.length !== 3 || parts[0] !== 'acb') return null;

  try {
    const decoded = JSON.parse(fromBase64Url(parts[1]));
    if (!decoded || typeof decoded.exp !== 'number' || Date.now() > decoded.exp) {
      return null;
    }
    if (!decoded.sub || typeof decoded.sub !== 'string') {
      return null;
    }
    return {
      sub: decoded.sub,
      role: decoded.role === 'staff' ? 'staff' : 'admin',
      exp: decoded.exp,
    };
  } catch {
    return null;
  }
}

function formatKolkataDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function generateUniqueOrderId(billSeq: number): string {
  const now = new Date();
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .replace(/-/g, '');
  const randSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `ORD-${datePart}-${String(billSeq).padStart(4, '0')}-${randSuffix}`;
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Handles `/api/*` requests locally inside the Capacitor Android APK when no external
 * server is reachable or when Capacitor's `https://localhost` WebView returns `index.html`.
 */
export async function handleCapacitorLocalApiRequest(
  rawUrl: string,
  init?: RequestInit
): Promise<Response> {
  const parsedUrl = new URL(rawUrl, 'https://localhost');
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const method = (init?.method || 'GET').toUpperCase();

  const headersObj: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headersObj[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        headersObj[k.toLowerCase()] = v;
      }
    } else {
      for (const [k, v] of Object.entries(init.headers)) {
        if (typeof v === 'string') headersObj[k.toLowerCase()] = v;
      }
    }
  }

  let bodyData: any = {};
  if (init?.body && typeof init.body === 'string') {
    try {
      bodyData = JSON.parse(init.body);
    } catch {
      bodyData = {};
    }
  }

  // 1. Health check
  if (pathname === '/api/health' && method === 'GET') {
    return jsonResponse(200, {
      status: 'UP',
      service: 'annpurna-chole-bhature-capacitor-api',
      timezone: 'Asia/Kolkata',
    });
  }

  // 2. Login
  if (pathname === '/api/auth/login' && method === 'POST') {
    const rawUsername = bodyData?.username ?? bodyData?.userId ?? '';
    const rawPassword = bodyData?.password ?? '';

    if (
      !rawUsername ||
      !rawPassword ||
      typeof rawUsername !== 'string' ||
      typeof rawPassword !== 'string'
    ) {
      return jsonResponse(400, { error: 'Both User ID and Password are required.' });
    }

    const userCheck = isAuthorizedUserId(rawUsername);
    const passwordValid = await verifyPasswordScrypt(rawPassword);

    if (userCheck.authorized && passwordValid) {
      const { token, expiresAt } = await createLocalSignedToken(
        userCheck.canonicalUser,
        userCheck.role
      );
      return jsonResponse(200, {
        success: true,
        message: 'Authentication successful',
        token,
        username: userCheck.canonicalUser,
        role: userCheck.role,
        expiresAt,
      });
    }

    return jsonResponse(401, {
      error: 'Invalid User ID or Password. Access denied.',
    });
  }

  // 3. Logout
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const authHeader = headersObj['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      revokedLocalTokens.add(authHeader.slice(7).trim());
    }
    return jsonResponse(200, { success: true, message: 'Logged out successfully' });
  }

  // 4. Verify Auth Session
  const authHeader = headersObj['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const session = verifyLocalTokenPayload(bearerToken);

  if (pathname === '/api/auth/me' && method === 'GET') {
    if (!session) {
      return jsonResponse(401, {
        isAuthenticated: false,
        error: 'Session invalid or expired',
      });
    }
    return jsonResponse(200, {
      isAuthenticated: true,
      username: session.sub,
      role: session.role,
      expiresAt: session.exp,
    });
  }

  // Require valid session token for all protected endpoints
  if (!session) {
    return jsonResponse(401, {
      error: 'Unauthorized: Please log in with your User ID and Password.',
    });
  }

  // 5. Sheets status
  if (pathname === '/api/sheets/status' && method === 'GET') {
    const hasGoogleToken = Boolean(headersObj['x-google-token']);
    const customSheetId =
      typeof window !== 'undefined' ? window.localStorage.getItem('annpurna_custom_sheet_id') || '' : '';
    return jsonResponse(200, {
      configured: hasGoogleToken,
      mode: hasGoogleToken ? 'oauth_token' : 'unconfigured',
      modeLabel: hasGoogleToken ? 'Google Workspace OAuth' : 'Local Persistent Storage',
      spreadsheetId: customSheetId,
      spreadsheetUrl: customSheetId
        ? `https://docs.google.com/spreadsheets/d/${customSheetId}/edit`
        : '',
    });
  }

  // 6. Hydrate & Sync Bills
  if (pathname === '/api/bills/hydrate' && method === 'POST') {
    const clientBills: Bill[] = Array.isArray(bodyData?.clientBills) ? bodyData.clientBills : [];
    const merged = savePersistentBills(clientBills);
    const metrics = computeBusinessMetricsFromBills(merged, Date.now());
    return jsonResponse(200, {
      success: true,
      totalBills: merged.length,
      metrics,
      bills: merged,
    });
  }

  // 7. Business Metrics (24h rolling window)
  if (pathname === '/api/metrics' && method === 'GET') {
    const allBills = loadPersistentBills();
    const metrics = computeBusinessMetricsFromBills(allBills, Date.now());
    return jsonResponse(200, metrics);
  }

  // 8. Monthly Sales Calendar Report
  if (pathname === '/api/reports/monthly' && method === 'GET') {
    const now = new Date();
    const year = parseInt(parsedUrl.searchParams.get('year') || String(now.getFullYear()), 10);
    const month = parseInt(parsedUrl.searchParams.get('month') || String(now.getMonth() + 1), 10);
    const allBills = loadPersistentBills();
    const report = buildMonthlyReportFromBills(allBills, year, month);
    return jsonResponse(200, { report });
  }

  // 9. Get Bills (with search, filter, pagination)
  if (pathname === '/api/bills' && method === 'GET') {
    const allBills = loadPersistentBills();
    const search = (parsedUrl.searchParams.get('search') || '').trim().toLowerCase();
    const orderType = parsedUrl.searchParams.get('orderType') || 'all';
    const paymentMethod = parsedUrl.searchParams.get('paymentMethod') || 'all';
    const syncStatus = parsedUrl.searchParams.get('syncStatus') || 'all';
    const dateFilter = parsedUrl.searchParams.get('dateFilter') || 'all';
    const page = Math.max(1, parseInt(parsedUrl.searchParams.get('page') || '1', 10));
    const limit = Math.max(1, parseInt(parsedUrl.searchParams.get('limit') || '20', 10));

    const nowMs = Date.now();
    const rolling24hCutoff = nowMs - 24 * 60 * 60 * 1000;
    const todayKolkata = getKolkataDateString(nowMs);
    const yesterdayKolkata = getKolkataDateString(nowMs - 86400000);
    const currentMonthPrefix = todayKolkata.slice(0, 7);

    const filtered = allBills.filter((bill) => {
      if (search) {
        const matchName = (bill.customerName || '').toLowerCase().includes(search);
        const matchMobile = (bill.mobileNumber || '').toLowerCase().includes(search);
        const matchBillNo = (bill.billNumber || '').toLowerCase().includes(search);
        const matchOrderId = (bill.orderId || '').toLowerCase().includes(search);
        if (!matchName && !matchMobile && !matchBillNo && !matchOrderId) return false;
      }
      if (orderType !== 'all' && bill.orderType !== orderType) return false;
      if (paymentMethod !== 'all' && bill.paymentMethod !== paymentMethod) return false;
      if (syncStatus === 'synced' && !bill.savedToSheets) return false;
      if (syncStatus === 'failed' && bill.savedToSheets) return false;

      if (dateFilter !== 'all') {
        const ts = resolveBillTimestampMs(bill);
        const billDate = getKolkataDateString(ts);
        if (dateFilter === '24h' && (ts < rolling24hCutoff || ts > nowMs + 300_000)) return false;
        if (dateFilter === 'today' && billDate !== todayKolkata) return false;
        if (dateFilter === 'yesterday' && billDate !== yesterdayKolkata) return false;
        if (dateFilter === 'this_month' && !billDate.startsWith(currentMonthPrefix)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return jsonResponse(200, {
      bills: paginated,
      total,
      page,
      limit,
      totalPages,
    });
  }

  // 10. Create & Save Bill (POST /api/bills)
  if (pathname === '/api/bills' && method === 'POST') {
    const rawOrderType = bodyData?.orderType as OrderType;
    const orderType: OrderType =
      rawOrderType === 'PACK' || rawOrderType === 'DINE_IN' ? rawOrderType : 'DINE_IN';
    const orderTypeLabel: 'Dine In' | 'Pack' = orderType === 'PACK' ? 'Pack' : 'Dine In';

    const rawCustomerName = String(bodyData?.customerName || '').trim();
    if (!rawCustomerName || rawCustomerName.length < 2) {
      return jsonResponse(400, { error: 'Customer name is required (min 2 characters).' });
    }
    const customerName = formatCustomerNameWithJi(rawCustomerName);

    const countryCode = String(bodyData?.countryCode || '+91').trim();
    const cleanMobile = String(bodyData?.mobileNumber || '').replace(/\D/g, '');
    if (cleanMobile.length !== 10) {
      return jsonResponse(400, { error: 'Valid 10-digit mobile number is required.' });
    }

    const rawItems = Array.isArray(bodyData?.items) ? bodyData.items : [];
    if (rawItems.length === 0) {
      return jsonResponse(400, { error: 'At least one menu item is required.' });
    }

    const computedItems: BillItem[] = [];
    let subtotalPaise = 0;

    for (let idx = 0; idx < rawItems.length; idx++) {
      const entry = rawItems[idx];
      const key = entry?.itemKey as MenuItemKey;
      const qty = Math.floor(Number(entry?.quantity) || 0);
      if (!key || !(key in OFFICIAL_MENU_ITEMS) || qty <= 0) continue;

      let unitPricePaise = 0;
      if (key === 'COLD_DRINK') {
        const mrp = Number(entry?.coldDrinkUnitPriceRupees);
        if (isNaN(mrp) || mrp <= 0) {
          return jsonResponse(400, { error: 'Valid MRP is required for Cold Drink.' });
        }
        unitPricePaise = Math.round(mrp * 100);
      } else {
        unitPricePaise = AUTHORITATIVE_PRICES_PAISE[key];
      }

      const lineTotalPaise = unitPricePaise * qty;
      subtotalPaise += lineTotalPaise;

      computedItems.push({
        id: `item-${idx + 1}-${Date.now()}`,
        itemKey: key,
        name: OFFICIAL_MENU_ITEMS[key].name,
        quantity: qty,
        unitPricePaise,
        unitPriceRupees: unitPricePaise / 100,
        lineTotalPaise,
        lineTotalRupees: lineTotalPaise / 100,
      });
    }

    if (computedItems.length === 0) {
      return jsonResponse(400, { error: 'No valid items in bill.' });
    }

    const rawDiscPct = Number(bodyData?.discountPercent) || 0;
    const discountPercent = Math.min(100, Math.max(0, Math.round(rawDiscPct * 100) / 100));
    const discountPaise = Math.round((subtotalPaise * discountPercent) / 100);
    const discountRupees = discountPaise / 100;
    const grandTotalPaise = Math.max(0, subtotalPaise - discountPaise);
    const grandTotalRupees = grandTotalPaise / 100;

    const existingBills = loadPersistentBills();
    const seq = existingBills.length + 1;
    const now = new Date();
    const orderId = generateUniqueOrderId(seq);
    const billNumber = `ACB-${String(seq).padStart(4, '0')}`;
    const paymentMethod: PaymentMethod =
      bodyData?.paymentMethod === 'UPI' || bodyData?.paymentMethod === 'Card'
        ? bodyData.paymentMethod
        : 'Cash';

    const billDate = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(now);
    const billTime = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(now);

    const newBill: Bill = {
      id: `bill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      orderId,
      billNumber,
      orderType,
      orderTypeLabel,
      customerName,
      mobileNumber: cleanMobile,
      countryCode,
      items: computedItems,
      itemCount: computedItems.reduce((sum, i) => sum + i.quantity, 0),
      itemDetailsSummary: computedItems.map((i) => `${i.name} (${i.quantity})`).join(', '),
      itemPricesSummary: computedItems.map((i) => `${i.name}: Rs ${i.unitPriceRupees}`).join(', '),
      subtotalPaise,
      subtotalRupees: subtotalPaise / 100,
      discountPercent,
      discountAmountPaise: discountPaise,
      discountAmountRupees: discountRupees,
      discountPaise,
      discountRupees,
      grandTotalPaise,
      grandTotalRupees,
      paymentMethod,
      paymentStatus: 'Paid',
      billDate,
      billTime,
      dateTimeKolkata: formatKolkataDateTime(now),
      timestamp: now.getTime(),
      userId: bodyData?.userId || session.sub || 'admin',
      savedToSheets: false,
      sheetsSyncStatus: 'pending',
    };

    upsertPersistentBill(newBill);

    return jsonResponse(201, {
      ...newBill,
      bill: newBill,
    });
  }

  // 11. Send WhatsApp fallback check
  if (pathname.endsWith('/send-whatsapp') && method === 'POST') {
    return jsonResponse(200, {
      success: true,
      deliveredAutomatically: false,
      mode: 'click_to_chat',
    });
  }

  // 12. Retry Sheets / Batch Sync Sheets
  if (
    (pathname.endsWith('/retry-sheets') || pathname === '/api/bills/batch-sync-sheets') &&
    method === 'POST'
  ) {
    return jsonResponse(200, {
      success: false,
      failedCount: 1,
      error:
        'Configure your Netlify Server URL in Server Settings or connect Google Account to sync with Google Sheets.',
    });
  }

  return jsonResponse(404, { error: `API endpoint not found: ${pathname}` });
}
