/**
 * Google Sheets Integration Service for ANNAPURNA CHOLE BHATURE
 * Authoritative synchronization and bidirectional hydration of all bill records with Google Sheets.
 *
 * Supports three production-grade connection modes automatically:
 * 1. Server-Side Google Service Account (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY + GOOGLE_SHEET_ID)
 *    -> Best for Netlify production: zero browser popups, tokens never expire on the cashier.
 * 2. Server-Side Google Apps Script Web App (GOOGLE_APPS_SCRIPT_URL + optional GOOGLE_APPS_SCRIPT_SECRET)
 *    -> Direct webhook bridge to Google Sheets.
 * 3. Client Google Workspace OAuth Token (googleAccessToken + GOOGLE_SHEET_ID / customSpreadsheetId)
 *    -> Works interactively when signed in with Google.
 *
 * Implements strict Order ID deduplication, dynamic header migration, bidirectional read/hydration,
 * and honest verification (never returns fake success).
 */

import crypto from 'crypto';
import { Bill, BillItem, MenuItemKey, OrderType, PaymentMethod } from '../types/billing';
import { formatCustomerNameWithJi } from '../utils/customerFormat';

export const DEFAULT_SPREADSHEET_TITLE = 'ANNAPURNA CHOLE BHATURE - Billing Records';

/**
 * Safely extracts the canonical spreadsheet ID from either a raw ID or full Google Sheets URL.
 */
export function extractSpreadsheetId(inputOrUrl?: string | null): string {
  if (!inputOrUrl || typeof inputOrUrl !== 'string') return '';
  const trimmed = inputOrUrl.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed.split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
}

export interface SheetsSyncResult {
  success: boolean;
  mode?: 'service_account' | 'apps_script' | 'oauth_token' | 'unconfigured';
  spreadsheetId: string;
  spreadsheetUrl: string;
  billsTabUpdated: boolean;
  itemsCountLogged: number;
  alreadyExists?: boolean;
  error?: string;
}

export interface SheetsConnectionStatus {
  configured: boolean;
  mode: 'service_account' | 'apps_script' | 'oauth_token' | 'unconfigured';
  modeLabel: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  serviceAccountEmail?: string;
}

export const CANONICAL_BILLS_HEADERS = [
  'Order ID',
  'Bill Number',
  'Bill Date',
  'Bill Time',
  'Date & Time (IST)',
  'Order Type',
  'User ID',
  'Customer Name',
  'Customer Mobile',
  'Items',
  'Quantity',
  'Item Prices',
  'Subtotal',
  'Discount Percentage',
  'Discount Amount',
  'Final Amount',
  'Payment Method',
  'Payment Status',
  'Sync Status',
];

export const CANONICAL_ITEMS_HEADERS = [
  'Order ID',
  'Bill Number',
  'Order Type',
  'Item Name',
  'Quantity',
  'Unit Price (Rs)',
  'Line Total (Rs)',
  'Payment Method',
  'Customer Name',
  'Timestamp (IST)',
  'User ID',
  'Record ID',
];

// ---------------------------------------------------------------------------
// Server-Side Google Service Account JWT Minting (Native Node crypto)
// ---------------------------------------------------------------------------
let cachedServiceAccountToken: { accessToken: string; expiresAt: number } | null = null;

function getServiceAccountCredentials(): { clientEmail: string; privateKey: string } | null {
  // Check JSON credential blob first
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: String(parsed.client_email).trim(),
          privateKey: String(parsed.private_key).replace(/\\n/g, '\n'),
        };
      }
    } catch {
      // Ignore invalid JSON and check individual env vars
    }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_PRIVATE_KEY?.trim();
  if (email && key) {
    return {
      clientEmail: email,
      privateKey: key.replace(/\\n/g, '\n').replace(/^["']|["']$/g, ''),
    };
  }

  return null;
}

/**
 * Mints an OAuth2 access token using a Google Service Account via RSA-SHA256 JWT assertion.
 */
export async function getServiceAccountAccessToken(): Promise<string> {
  if (cachedServiceAccountToken && Date.now() < cachedServiceAccountToken.expiresAt - 60_000) {
    return cachedServiceAccountToken.accessToken;
  }

  const creds = getServiceAccountCredentials();
  if (!creds) {
    throw new Error('Google Service Account credentials are not configured on the server.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: creds.clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  };

  const encodeB64Url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64url');

  const unsignedJwt = `${encodeB64Url(header)}.${encodeB64Url(claimSet)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(creds.privateKey, 'base64url');
  const assertion = `${unsignedJwt}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Service Account OAuth token exchange failed (HTTP ${tokenRes.status}): ${errText}`);
  }

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error('Service Account token response did not contain an access_token.');
  }

  cachedServiceAccountToken = {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + (Number(tokenData.expires_in) || 3600) * 1000,
  };

  return cachedServiceAccountToken.accessToken;
}

/**
 * Inspects available Google Sheets connection methods on the server + client request.
 */
export function getSheetsConnectionStatus(
  clientAccessToken?: string | null,
  customSpreadsheetId?: string | null
): SheetsConnectionStatus {
  const spreadsheetId = extractSpreadsheetId(customSpreadsheetId || process.env.GOOGLE_SHEET_ID);
  const spreadsheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : '';

  const serviceAccount = getServiceAccountCredentials();
  if (serviceAccount && spreadsheetId) {
    return {
      configured: true,
      mode: 'service_account',
      modeLabel: 'Server Service Account (Auto-Sync)',
      spreadsheetId,
      spreadsheetUrl,
      serviceAccountEmail: serviceAccount.clientEmail,
    };
  }

  const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
  if (appsScriptUrl && appsScriptUrl.startsWith('https://script.google.com/')) {
    return {
      configured: true,
      mode: 'apps_script',
      modeLabel: 'Google Apps Script Web App',
      spreadsheetId,
      spreadsheetUrl: spreadsheetUrl || appsScriptUrl,
    };
  }

  if (clientAccessToken && clientAccessToken.trim()) {
    return {
      configured: true,
      mode: 'oauth_token',
      modeLabel: 'Google Workspace OAuth',
      spreadsheetId,
      spreadsheetUrl,
    };
  }

  return {
    configured: false,
    mode: 'unconfigured',
    modeLabel: 'Local Database Mode (Connect Google Sheets or set Netlify env vars)',
    spreadsheetId,
    spreadsheetUrl,
    serviceAccountEmail: serviceAccount?.clientEmail,
  };
}

/**
 * Checks if a spreadsheet has the required 'Bills' and 'Bill Items' sheets.
 * Safely extends headers without overwriting existing data.
 */
export async function ensureSpreadsheetStructure(
  accessToken: string,
  rawSpreadsheetId: string
): Promise<{ billsHeaders: string[]; itemsHeaders: string[] }> {
  const spreadsheetId = extractSpreadsheetId(rawSpreadsheetId);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Spreadsheet ID provided.');
  }

  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const response = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errText = await response.text();
    let cleanErrorMessage = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(errText);
      if (parsed.error?.message) {
        cleanErrorMessage = `${parsed.error.code || response.status}: ${parsed.error.message}`;
      }
    } catch {
      if (response.status === 400) {
        cleanErrorMessage = 'HTTP 400 (Invalid spreadsheet ID format or malformed request)';
      } else if (response.status === 403) {
        cleanErrorMessage =
          'HTTP 403 (Permission denied - share your Google Sheet with Editor access to your Service Account / Google account)';
      } else if (response.status === 404) {
        cleanErrorMessage = 'HTTP 404 (Spreadsheet not found - verify GOOGLE_SHEET_ID)';
      } else if (response.status === 401) {
        cleanErrorMessage = 'HTTP 401 (Google access token expired or invalid)';
      } else {
        cleanErrorMessage = `HTTP ${response.status}`;
      }
    }
    throw new Error(`Failed to load Google Sheet (${cleanErrorMessage})`);
  }

  const sheetData = await response.json();
  const existingSheets: Array<{ properties: { sheetId: number; title: string } }> =
    sheetData.sheets || [];

  const hasBillsTab = existingSheets.some((s) => s.properties.title === 'Bills');
  const hasItemsTab = existingSheets.some((s) => s.properties.title === 'Bill Items');

  const requests: any[] = [];

  if (!hasBillsTab) {
    requests.push({
      addSheet: {
        properties: {
          title: 'Bills',
          gridProperties: { rowCount: 2500, columnCount: 22, frozenRowCount: 1 },
          tabColor: { red: 0.15, green: 0.38, blue: 0.92 },
        },
      },
    });
  }

  if (!hasItemsTab) {
    requests.push({
      addSheet: {
        properties: {
          title: 'Bill Items',
          gridProperties: { rowCount: 5000, columnCount: 15, frozenRowCount: 1 },
          tabColor: { red: 0.1, green: 0.6, blue: 0.3 },
        },
      },
    });
  }

  if (requests.length > 0) {
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    await fetch(updateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    });
  }

  // --- Ensure & Safely Migrate Headers for Bills ---
  const billsHeaderRange = 'Bills!1:1';
  const billsHeaderCheck = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${billsHeaderRange}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const billsHeaderData = await billsHeaderCheck.json();
  let currentBillsHeaders: string[] = billsHeaderData.values?.[0] || [];

  if (currentBillsHeaders.length === 0) {
    const endCol = getColumnLetter(CANONICAL_BILLS_HEADERS.length - 1);
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Bills!A1:${endCol}1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [CANONICAL_BILLS_HEADERS] }),
      }
    );
    currentBillsHeaders = [...CANONICAL_BILLS_HEADERS];
  } else {
    const missingHeaders = CANONICAL_BILLS_HEADERS.filter((h) => !currentBillsHeaders.includes(h));
    if (missingHeaders.length > 0) {
      const nextColIndex = currentBillsHeaders.length;
      const startColLetter = getColumnLetter(nextColIndex);
      const endColLetter = getColumnLetter(nextColIndex + missingHeaders.length - 1);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Bills!${startColLetter}1:${endColLetter}1?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [missingHeaders] }),
        }
      );
      currentBillsHeaders.push(...missingHeaders);
    }
  }

  // --- Ensure & Safely Migrate Headers for Bill Items ---
  const itemsHeaderRange = "'Bill Items'!1:1";
  const itemsHeaderCheck = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${itemsHeaderRange}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const itemsHeaderData = await itemsHeaderCheck.json();
  let currentItemsHeaders: string[] = itemsHeaderData.values?.[0] || [];

  if (currentItemsHeaders.length === 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Bill Items'!A1:L1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [CANONICAL_ITEMS_HEADERS] }),
      }
    );
    currentItemsHeaders = [...CANONICAL_ITEMS_HEADERS];
  } else {
    const missingItemsHeaders = CANONICAL_ITEMS_HEADERS.filter((h) => !currentItemsHeaders.includes(h));
    if (missingItemsHeaders.length > 0) {
      const nextColIndex = currentItemsHeaders.length;
      const startColLetter = getColumnLetter(nextColIndex);
      const endColLetter = getColumnLetter(nextColIndex + missingItemsHeaders.length - 1);
      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Bill Items'!${startColLetter}1:${endColLetter}1?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: [missingItemsHeaders] }),
        }
      );
      currentItemsHeaders.push(...missingItemsHeaders);
    }
  }

  return { billsHeaders: currentBillsHeaders, itemsHeaders: currentItemsHeaders };
}

/**
 * Converts 0-indexed column integer to Excel/Sheets column letters (e.g. 0 -> A, 25 -> Z, 26 -> AA)
 */
function getColumnLetter(colIndex: number): string {
  let letter = '';
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

/**
 * Creates a brand new Google Spreadsheet configured for ANNAPURNA CHOLE BHATURE
 */
export async function createBillingSpreadsheet(
  accessToken: string,
  title: string = DEFAULT_SPREADSHEET_TITLE
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const createUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  const response = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title,
        locale: 'en_IN',
        timeZone: 'Asia/Kolkata',
      },
      sheets: [
        {
          properties: {
            title: 'Bills',
            gridProperties: { frozenRowCount: 1 },
            tabColor: { red: 0.15, green: 0.38, blue: 0.92 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: CANONICAL_BILLS_HEADERS.map((h) => ({
                    userEnteredValue: { stringValue: h },
                  })),
                },
              ],
            },
          ],
        },
        {
          properties: {
            title: 'Bill Items',
            gridProperties: { frozenRowCount: 1 },
            tabColor: { red: 0.1, green: 0.6, blue: 0.3 },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                {
                  values: CANONICAL_ITEMS_HEADERS.map((h) => ({
                    userEnteredValue: { stringValue: h },
                  })),
                },
              ],
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create spreadsheet: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
  };
}

/**
 * Appends a completed Bill to Google Sheets via REST API v4.
 * Prevents duplicates by checking existing Order ID, Bill Number, or Record ID.
 * Maps data dynamically by header name so existing sheets work without breaking.
 */
export async function appendBillToSheets(
  accessToken: string,
  rawSpreadsheetId: string,
  bill: Bill
): Promise<SheetsSyncResult> {
  const spreadsheetId = extractSpreadsheetId(rawSpreadsheetId);
  if (!spreadsheetId) {
    throw new Error('Invalid Google Spreadsheet ID provided.');
  }

  const { billsHeaders, itemsHeaders } = await ensureSpreadsheetStructure(accessToken, spreadsheetId);

  // 1. DUPLICATE CHECK: inspect existing rows in Bills sheet
  const checkRange = 'Bills!A:Z';
  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${checkRange}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (checkRes.ok) {
    const existing = await checkRes.json();
    const rows: any[][] = existing.values || [];
    const isDuplicate = rows.slice(1).some((r) => {
      const rowStr = r.join(' ');
      return (
        (bill.orderId && rowStr.includes(bill.orderId)) ||
        (bill.billNumber && rowStr.includes(bill.billNumber)) ||
        (bill.id && rowStr.includes(bill.id))
      );
    });

    if (isDuplicate) {
      return {
        success: true,
        alreadyExists: true,
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        billsTabUpdated: false,
        itemsCountLogged: 0,
      };
    }
  }

  // 2. CONSTRUCT DATA MAPPING FOR 'Bills' TAB
  const formattedCustomerName = formatCustomerNameWithJi(bill.customerName);
  const itemSummary =
    bill.itemDetailsSummary || bill.items.map((i) => `${i.name} (${i.quantity})`).join(', ');
  const itemPricesSummary =
    bill.itemPricesSummary ||
    bill.items.map((i) => `${i.name}: Rs ${i.unitPriceRupees}`).join(', ');
  const totalQty = bill.itemCount || bill.items.reduce((sum, item) => sum + item.quantity, 0);
  const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
  const discAmt =
    bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;

  const billDataMap: Record<string, any> = {
    'Order ID': bill.orderId || bill.id,
    'Bill Number': bill.billNumber,
    'Bill Date': bill.billDate || bill.dateTimeKolkata.split(',')[0] || '',
    'Bill Time': bill.billTime || bill.dateTimeKolkata.split(',')[1]?.trim() || '',
    'Date & Time (IST)': bill.dateTimeKolkata,
    'Order Type': bill.orderTypeLabel || (bill.orderType === 'PACK' ? 'Pack' : 'Dine In'),
    'User ID': bill.userId || 'admin',
    'Customer Name': formattedCustomerName,
    'Customer Mobile': `${bill.countryCode || '+91'} ${bill.mobileNumber}`.trim(),
    'Items': itemSummary,
    'Quantity': totalQty,
    'Item Prices': itemPricesSummary,
    'Subtotal': bill.subtotalRupees,
    'Discount Percentage': `${discPct}%`,
    'Discount Amount': discAmt,
    'Final Amount': bill.grandTotalRupees,
    'Payment Method': bill.paymentMethod || 'Cash',
    'Payment Status': bill.paymentStatus || 'Paid',
    'Sync Status': 'Synced',

    // Backwards & Forward Compatible Column Aliases for existing sheets
    'Mobile Number': `${bill.countryCode || '+91'} ${bill.mobileNumber}`.trim(),
    'Product Details': itemSummary,
    'Total Quantity': totalQty,
    'Item Count': totalQty,
    'Subtotal (Rs)': bill.subtotalRupees,
    'Subtotal (₹)': bill.subtotalRupees,
    'Discount (Rs)': discAmt,
    'Discount (₹)': discAmt,
    'Final Amount (Rs)': bill.grandTotalRupees,
    'Final Amount (₹)': bill.grandTotalRupees,
    'Grand Total (Rs)': bill.grandTotalRupees,
    'Grand Total (₹)': bill.grandTotalRupees,
    'Grand Total': bill.grandTotalRupees,
    'Record ID': bill.id,
    'Unique Bill ID': bill.id,
  };

  const billRow = billsHeaders.map((header) => {
    return billDataMap[header] !== undefined ? billDataMap[header] : '';
  });

  const billsAppendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Bills!A:Z:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const billsAppendRes = await fetch(billsAppendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [billRow] }),
  });

  if (!billsAppendRes.ok) {
    const err = await billsAppendRes.text();
    let cleanErr = `HTTP ${billsAppendRes.status}`;
    try {
      const p = JSON.parse(err);
      if (p.error?.message) cleanErr = p.error.message;
    } catch {
      cleanErr = `HTTP ${billsAppendRes.status} writing to Bills sheet`;
    }
    throw new Error(`Failed to append to Bills sheet: ${cleanErr}`);
  }

  // 3. CONSTRUCT DATA MAPPING FOR 'Bill Items' TAB
  const itemRows = bill.items.map((item) => {
    const itemDataMap: Record<string, any> = {
      'Order ID': bill.orderId || bill.id,
      'Bill Number': bill.billNumber,
      'Order Type': bill.orderTypeLabel || (bill.orderType === 'PACK' ? 'Pack' : 'Dine In'),
      'Item Name': item.name,
      'Quantity': item.quantity,
      'Unit Price (Rs)': item.unitPriceRupees,
      'Unit Price (₹)': item.unitPriceRupees,
      'Unit Price': item.unitPriceRupees,
      'Line Total (Rs)': item.lineTotalRupees,
      'Line Total (₹)': item.lineTotalRupees,
      'Line Total': item.lineTotalRupees,
      'Payment Method': bill.paymentMethod || 'Cash',
      'Payment Status': bill.paymentStatus || 'Paid',
      'Customer Name': formattedCustomerName,
      'Customer Mobile': bill.mobileNumber,
      'Bill Date': bill.billDate || '',
      'Bill Time': bill.billTime || '',
      'Timestamp (IST)': bill.dateTimeKolkata,
      'Date & Time (IST)': bill.dateTimeKolkata,
      'User ID': bill.userId || 'admin',
      'Record ID': bill.id,
      'Unique Bill ID': bill.id,
    };

    return itemsHeaders.map((header) => {
      return itemDataMap[header] !== undefined ? itemDataMap[header] : '';
    });
  });

  const itemsAppendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/'Bill Items'!A:Z:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const itemsAppendRes = await fetch(itemsAppendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: itemRows }),
  });

  if (!itemsAppendRes.ok) {
    const err = await itemsAppendRes.text();
    let cleanErr = `HTTP ${itemsAppendRes.status}`;
    try {
      const p = JSON.parse(err);
      if (p.error?.message) cleanErr = p.error.message;
    } catch {
      cleanErr = `HTTP ${itemsAppendRes.status} writing to Bill Items sheet`;
    }
    throw new Error(`Failed to append to Bill Items sheet: ${cleanErr}`);
  }

  return {
    success: true,
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    billsTabUpdated: true,
    itemsCountLogged: itemRows.length,
  };
}

/**
 * Appends a completed Bill to Google Sheets via Google Apps Script Web App webhook.
 */
async function appendBillViaAppsScript(appsScriptUrl: string, bill: Bill): Promise<SheetsSyncResult> {
  const formattedCustomerName = formatCustomerNameWithJi(bill.customerName);
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET?.trim() || '';

  const response = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    redirect: 'follow',
    body: JSON.stringify({
      action: 'appendBill',
      secret,
      bill: {
        ...bill,
        customerName: formattedCustomerName,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Apps Script returned HTTP ${response.status}`);
  }

  const text = await response.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      'Google Apps Script returned an HTML/non-JSON page. Ensure the Web App is deployed with "Who has access: Anyone".'
    );
  }

  if (!parsed || parsed.success !== true) {
    throw new Error(parsed?.error || 'Google Apps Script did not confirm row write');
  }

  const sheetId = extractSpreadsheetId(parsed.spreadsheetId || process.env.GOOGLE_SHEET_ID);
  return {
    success: true,
    mode: 'apps_script',
    spreadsheetId: sheetId,
    spreadsheetUrl:
      parsed.spreadsheetUrl ||
      (sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : appsScriptUrl),
    billsTabUpdated: true,
    itemsCountLogged: bill.items.length,
    alreadyExists: Boolean(parsed.alreadyExists),
  };
}

/**
 * Unified server-side Google Sheets synchronization orchestrator.
 * Automatically tries:
 * 1. Server-Side Google Service Account (if configured)
 * 2. Server-Side Google Apps Script Web App URL (if configured)
 * 3. Client Google OAuth Bearer Token (if provided)
 */
export async function syncBillToGoogleSheets(
  bill: Bill,
  options?: {
    clientAccessToken?: string | null;
    customSpreadsheetId?: string | null;
  }
): Promise<SheetsSyncResult> {
  const targetSheetId = extractSpreadsheetId(
    options?.customSpreadsheetId || bill.spreadsheetId || process.env.GOOGLE_SHEET_ID
  );
  const errors: string[] = [];

  // 1. Try Server-Side Service Account first (most reliable in Netlify production)
  const serviceAccountCreds = getServiceAccountCredentials();
  if (serviceAccountCreds && targetSheetId) {
    try {
      const saToken = await getServiceAccountAccessToken();
      const res = await appendBillToSheets(saToken, targetSheetId, bill);
      return { ...res, mode: 'service_account' };
    } catch (saErr: any) {
      console.error('[Sheets Service Account] Sync error:', saErr.message);
      errors.push(`Service Account: ${saErr.message}`);
    }
  }

  // 2. Try Google Apps Script Web App URL if configured
  const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
  if (appsScriptUrl && appsScriptUrl.startsWith('https://script.google.com/')) {
    try {
      return await appendBillViaAppsScript(appsScriptUrl, bill);
    } catch (gasErr: any) {
      console.error('[Sheets Apps Script] Sync error:', gasErr.message);
      errors.push(`Apps Script: ${gasErr.message}`);
    }
  }

  // 3. Try Client OAuth Access Token
  const clientToken = options?.clientAccessToken?.trim();
  if (clientToken) {
    let sheetIdToUse = targetSheetId;
    try {
      if (!sheetIdToUse) {
        const created = await createBillingSpreadsheet(clientToken);
        sheetIdToUse = extractSpreadsheetId(created.spreadsheetId);
      }
      const res = await appendBillToSheets(clientToken, sheetIdToUse, bill);
      return { ...res, mode: 'oauth_token' };
    } catch (oauthErr: any) {
      console.error('[Sheets OAuth] Sync error:', oauthErr.message);
      errors.push(`OAuth: ${oauthErr.message}`);
    }
  }

  const combinedError =
    errors.length > 0
      ? errors.join(' | ')
      : 'Google Sheets is not connected. Configure GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY + GOOGLE_SHEET_ID in Netlify, or click Connect Google Account.';

  return {
    success: false,
    mode: 'unconfigured',
    spreadsheetId: targetSheetId,
    spreadsheetUrl: targetSheetId ? `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit` : '',
    billsTabUpdated: false,
    itemsCountLogged: 0,
    error: combinedError,
  };
}

/**
 * Parses itemized summary text like "Chole Bhature (2), Lassi (1)" back into BillItem[]
 * if the 'Bill Items' tab rows aren't matched for a legacy row.
 */
function parseFallbackItemsFromSummary(summaryText: string, pricesText: string): BillItem[] {
  if (!summaryText || typeof summaryText !== 'string') return [];

  const priceMap: Record<string, number> = {
    'Chole Bhature': 80,
    Lassi: 40,
    Chole: 40,
    Bhature: 25,
    'Cold Drink': 40,
  };

  if (pricesText) {
    pricesText.split(',').forEach((part) => {
      const m = part.trim().match(/^(.+?):\s*(?:Rs\.?|₹)?\s*(\d+(?:\.\d+)?)/i);
      if (m) {
        priceMap[m[1].trim()] = parseFloat(m[2]);
      }
    });
  }

  const items: BillItem[] = [];
  const parts = summaryText.split(',');
  for (const raw of parts) {
    const trimmed = raw.trim();
    const match = trimmed.match(/^(.+?)\s*\((\d+)\)$/);
    const name = match ? match[1].trim() : trimmed;
    const qty = match ? Math.max(1, parseInt(match[2], 10)) : 1;
    if (!name) continue;

    let itemKey: MenuItemKey = 'CHOLE_BHATURE';
    const upper = name.toUpperCase();
    if (upper.includes('LASSI')) itemKey = 'LASSI';
    else if (upper.includes('COLD')) itemKey = 'COLD_DRINK';
    else if (upper === 'CHOLE') itemKey = 'CHOLE';
    else if (upper.includes('BHATURE') && !upper.includes('CHOLE')) itemKey = 'BHATURE';

    const unitPriceRupees = priceMap[name] || 80;
    const unitPricePaise = Math.round(unitPriceRupees * 100);
    const lineTotalPaise = unitPricePaise * qty;

    items.push({
      id: `item-${itemKey}-${items.length}`,
      itemKey,
      name,
      quantity: qty,
      unitPricePaise,
      unitPriceRupees,
      lineTotalPaise,
      lineTotalRupees: lineTotalPaise / 100,
    });
  }

  return items;
}

/**
 * Fetches and reconstructs all historical bills from Google Sheets ('Bills' and 'Bill Items' tabs).
 * Ensures that even on stateless Netlify Functions cold starts, Google Sheets serves as the
 * authoritative permanent database for Bill History, Order ID Search, and Monthly Reports.
 */
export async function fetchBillsFromGoogleSheets(options?: {
  clientAccessToken?: string | null;
  customSpreadsheetId?: string | null;
}): Promise<Bill[]> {
  const spreadsheetId = extractSpreadsheetId(options?.customSpreadsheetId || process.env.GOOGLE_SHEET_ID);

  // Check if Apps Script Web App read is configured when no direct Sheets API token is available
  let accessToken: string | null = null;
  if (getServiceAccountCredentials() && spreadsheetId) {
    try {
      accessToken = await getServiceAccountAccessToken();
    } catch {
      accessToken = null;
    }
  }
  if (!accessToken && options?.clientAccessToken) {
    accessToken = options.clientAccessToken;
  }

  if (!accessToken || !spreadsheetId) {
    const appsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
    if (appsScriptUrl && appsScriptUrl.startsWith('https://script.google.com/')) {
      try {
        const url = new URL(appsScriptUrl);
        url.searchParams.set('action', 'getBills');
        if (process.env.GOOGLE_APPS_SCRIPT_SECRET) {
          url.searchParams.set('secret', process.env.GOOGLE_APPS_SCRIPT_SECRET.trim());
        }
        const res = await fetch(url.toString(), { redirect: 'follow' });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.bills)) {
            return data.bills as Bill[];
          }
        }
      } catch {
        // Ignore Apps Script read failure
      }
    }
    return [];
  }

  try {
    const batchGetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=Bills!A:Z&ranges='Bill Items'!A:Z`;
    const response = await fetch(batchGetUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) return [];
    const data = await response.json();
    const valueRanges = data.valueRanges || [];
    const billsRows: string[][] = valueRanges[0]?.values || [];
    const itemsRows: string[][] = valueRanges[1]?.values || [];

    if (billsRows.length <= 1) return [];

    const bHeaders = billsRows[0].map((h) => String(h || '').trim());
    const iHeaders = itemsRows[0]?.map((h) => String(h || '').trim()) || [];

    // Group items by Order ID / Bill Number
    const itemsByOrderId = new Map<string, BillItem[]>();
    for (let r = 1; r < itemsRows.length; r++) {
      const row = itemsRows[r];
      if (!row || row.length === 0) continue;
      const rowObj: Record<string, string> = {};
      iHeaders.forEach((h, idx) => {
        rowObj[h] = row[idx] !== undefined ? String(row[idx]).trim() : '';
      });

      const orderId = rowObj['Order ID'] || rowObj['Bill Number'] || rowObj['Record ID'];
      const itemName = rowObj['Item Name'];
      if (!orderId || !itemName) continue;

      const qty = Math.max(1, parseInt(rowObj['Quantity'] || '1', 10) || 1);
      const unitRupees =
        parseFloat((rowObj['Unit Price (Rs)'] || rowObj['Unit Price (₹)'] || rowObj['Unit Price'] || '0').replace(/[^\d.]/g, '')) || 0;
      const lineRupees =
        parseFloat((rowObj['Line Total (Rs)'] || rowObj['Line Total (₹)'] || rowObj['Line Total'] || '0').replace(/[^\d.]/g, '')) ||
        unitRupees * qty;

      let itemKey: MenuItemKey = 'CHOLE_BHATURE';
      const upper = itemName.toUpperCase();
      if (upper.includes('LASSI')) itemKey = 'LASSI';
      else if (upper.includes('COLD')) itemKey = 'COLD_DRINK';
      else if (upper === 'CHOLE') itemKey = 'CHOLE';
      else if (upper.includes('BHATURE') && !upper.includes('CHOLE')) itemKey = 'BHATURE';

      const list = itemsByOrderId.get(orderId) || [];
      list.push({
        id: `${orderId}-item-${list.length}`,
        itemKey,
        name: itemName,
        quantity: qty,
        unitPricePaise: Math.round(unitRupees * 100),
        unitPriceRupees: unitRupees,
        lineTotalPaise: Math.round(lineRupees * 100),
        lineTotalRupees: lineRupees,
      });
      itemsByOrderId.set(orderId, list);
    }

    const reconstructedBills: Bill[] = [];
    for (let r = 1; r < billsRows.length; r++) {
      const row = billsRows[r];
      if (!row || row.length === 0) continue;
      const rowObj: Record<string, string> = {};
      bHeaders.forEach((h, idx) => {
        rowObj[h] = row[idx] !== undefined ? String(row[idx]).trim() : '';
      });

      const orderId = rowObj['Order ID'] || rowObj['Unique Bill ID'] || rowObj['Record ID'];
      const billNumber = rowObj['Bill Number'] || orderId;
      if (!orderId && !billNumber) continue;

      const rawCustomer = rowObj['Customer Name'] || 'Walk-in Customer Ji';
      const customerName = formatCustomerNameWithJi(rawCustomer);

      const rawMobile = (rowObj['Customer Mobile'] || rowObj['Mobile Number'] || '').replace(/\D/g, '');
      const cleanMobile = rawMobile.length > 10 ? rawMobile.slice(-10) : rawMobile || '9999999999';

      const subtotalRupees =
        parseFloat((rowObj['Subtotal'] || rowObj['Subtotal (Rs)'] || rowObj['Subtotal (₹)'] || '0').replace(/[^\d.]/g, '')) || 0;
      const discountPercent =
        parseFloat((rowObj['Discount Percentage'] || '0').replace(/[^\d.]/g, '')) || 0;
      const discountAmountRupees =
        parseFloat((rowObj['Discount Amount'] || rowObj['Discount (Rs)'] || rowObj['Discount (₹)'] || '0').replace(/[^\d.]/g, '')) || 0;
      const grandTotalRupees =
        parseFloat(
          (
            rowObj['Final Amount'] ||
            rowObj['Final Amount (Rs)'] ||
            rowObj['Grand Total (Rs)'] ||
            rowObj['Grand Total'] ||
            String(Math.max(0, subtotalRupees - discountAmountRupees))
          ).replace(/[^\d.]/g, '')
        ) || 0;

      const orderTypeRaw = (rowObj['Order Type'] || 'Dine In').toUpperCase();
      const orderType: OrderType = orderTypeRaw.includes('PACK') ? 'PACK' : 'DINE_IN';
      const orderTypeLabel: 'Dine In' | 'Pack' = orderType === 'PACK' ? 'Pack' : 'Dine In';

      const paymentRaw = rowObj['Payment Method'] || 'Cash';
      const paymentMethod: PaymentMethod = ['Cash', 'UPI', 'Card'].includes(paymentRaw)
        ? (paymentRaw as PaymentMethod)
        : 'Cash';

      const billDate = rowObj['Bill Date'] || '';
      const billTime = rowObj['Bill Time'] || '';
      const dateTimeKolkata =
        rowObj['Date & Time (IST)'] ||
        (billDate && billTime ? `${billDate}, ${billTime} IST` : billDate || 'IST');

      // Parse timestamp from Order ID (ORD-YYYYMMDD-XXXX) or Bill Date (DD/MM/YYYY)
      let timestamp = Date.now() - r * 1000;
      const ordMatch = (orderId || billNumber).match(/(\d{4})(\d{2})(\d{2})/);
      if (ordMatch) {
        const parsedTime = Date.parse(`${ordMatch[1]}-${ordMatch[2]}-${ordMatch[3]}T12:00:00+05:30`);
        if (!isNaN(parsedTime)) timestamp = parsedTime + r;
      }

      const itemsSummary = rowObj['Items'] || rowObj['Product Details'] || '';
      const pricesSummary = rowObj['Item Prices'] || '';
      const matchedItems =
        itemsByOrderId.get(orderId) ||
        itemsByOrderId.get(billNumber) ||
        parseFallbackItemsFromSummary(itemsSummary, pricesSummary);

      const itemCount =
        parseInt(rowObj['Quantity'] || rowObj['Total Quantity'] || '0', 10) ||
        matchedItems.reduce((s, i) => s + i.quantity, 0) ||
        1;

      reconstructedBills.push({
        id: rowObj['Record ID'] || `SHEET-${orderId || billNumber}`,
        orderId: orderId || billNumber,
        billNumber: billNumber || orderId,
        orderType,
        orderTypeLabel,
        customerName,
        countryCode: '+91',
        mobileNumber: cleanMobile,
        items: matchedItems,
        itemCount,
        itemDetailsSummary: itemsSummary || matchedItems.map((i) => `${i.name} (${i.quantity})`).join(', '),
        itemPricesSummary: pricesSummary || matchedItems.map((i) => `${i.name}: Rs ${i.unitPriceRupees}`).join(', '),
        subtotalPaise: Math.round(subtotalRupees * 100),
        subtotalRupees,
        discountPercent,
        discountAmountPaise: Math.round(discountAmountRupees * 100),
        discountAmountRupees,
        discountPaise: Math.round(discountAmountRupees * 100),
        discountRupees: discountAmountRupees,
        grandTotalPaise: Math.round(grandTotalRupees * 100),
        grandTotalRupees,
        paymentMethod,
        paymentStatus: rowObj['Payment Status'] === 'Pending' ? 'Pending' : 'Paid',
        billDate,
        billTime,
        dateTimeKolkata,
        timestamp,
        userId: rowObj['User ID'] || 'admin',
        savedToSheets: true,
        sheetsSyncStatus: 'synced',
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      });
    }

    return reconstructedBills;
  } catch (err: any) {
    console.error('[Sheets Hydrate] Failed to read historical bills from Google Sheets:', err.message);
    return [];
  }
}
