/**
 * Google Sheets Integration Service for Annpurna Chole Bhature
 * Authoritative synchronization of all bill details to Google Sheets:
 * - Order ID (unique)
 * - Bill number
 * - Order type
 * - Customer name
 * - Customer mobile number
 * - Product/item details summary
 * - Quantity
 * - Individual item prices
 * - Subtotal (Rs)
 * - Discount (Rs)
 * - Final amount (Rs)
 * - Payment method
 * - Date and time (IST)
 * - User/account ID
 *
 * Implements strict duplicate prevention, dynamic header migration, and robust error reporting.
 */

import { Bill } from '../types/billing';

export const DEFAULT_SPREADSHEET_TITLE = 'Annpurna Chole Bhature - Billing Records';

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
  spreadsheetId: string;
  spreadsheetUrl: string;
  billsTabUpdated: boolean;
  itemsCountLogged: number;
  alreadyExists?: boolean;
  error?: string;
}

export const CANONICAL_BILLS_HEADERS = [
  'Order ID',
  'Bill Number',
  'User ID',
  'Customer Name',
  'Customer Mobile',
  'Items',
  'Quantity',
  'Subtotal',
  'Discount Percentage',
  'Discount Amount',
  'Final Amount',
  'Payment Method',
  'Payment Status',
  'Bill Date',
  'Bill Time',
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
        cleanErrorMessage = 'HTTP 403 (Permission denied - verify edit permissions on Google Sheet)';
      } else if (response.status === 404) {
        cleanErrorMessage = 'HTTP 404 (Spreadsheet not found)';
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
          gridProperties: { rowCount: 1500, columnCount: 18, frozenRowCount: 1 },
          tabColor: { red: 0.15, green: 0.38, blue: 0.92 }, // Royal Blue
        },
      },
    });
  }

  if (!hasItemsTab) {
    requests.push({
      addSheet: {
        properties: {
          title: 'Bill Items',
          gridProperties: { rowCount: 3000, columnCount: 15, frozenRowCount: 1 },
          tabColor: { red: 0.1, green: 0.6, blue: 0.3 }, // Green
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
    // Brand new tab: write full canonical headers
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Bills!A1:P1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [CANONICAL_BILLS_HEADERS] }),
      }
    );
    currentBillsHeaders = CANONICAL_BILLS_HEADERS;
  } else {
    // Check if new canonical headers need to be appended without overwriting existing data
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
    currentItemsHeaders = CANONICAL_ITEMS_HEADERS;
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
 * Creates a brand new Google Spreadsheet configured for Annpurna Chole Bhature
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
 * Appends a completed Bill to Google Sheets.
 * Prevents duplicates by checking existing Order ID, Bill Number, or Record ID.
 * Maps data dynamically by header name so existing sheets work perfectly.
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
    const isDuplicate = rows.some((r) => {
      const rowStr = r.join(' ');
      return (
        (bill.orderId && rowStr.includes(bill.orderId)) ||
        (bill.billNumber && rowStr.includes(bill.billNumber)) ||
        (bill.id && rowStr.includes(bill.id))
      );
    });

    if (isDuplicate) {
      console.log(`[Google Sheets] Bill ${bill.orderId} (${bill.billNumber}) already recorded. Skipping duplicate append.`);
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
  const billDataMap: Record<string, any> = {
    // 16 Canonical Columns in exact order requested
    'Order ID': bill.orderId || bill.id,
    'Bill Number': bill.billNumber,
    'User ID': bill.userId || 'admin',
    'Customer Name': bill.customerName,
    'Customer Mobile': bill.mobileNumber,
    'Items': bill.itemDetailsSummary || bill.items.map((i) => `${i.name} (${i.quantity})`).join(', '),
    'Quantity': bill.itemCount || bill.items.reduce((sum, item) => sum + item.quantity, 0),
    'Subtotal': bill.subtotalRupees,
    'Discount Percentage': `${bill.discountPercent !== undefined ? bill.discountPercent : 0}%`,
    'Discount Amount': bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : (bill.discountRupees || 0),
    'Final Amount': bill.grandTotalRupees,
    'Payment Method': bill.paymentMethod || 'Cash',
    'Payment Status': bill.paymentStatus || 'Paid',
    'Bill Date': bill.billDate || bill.dateTimeKolkata.split(',')[0] || '',
    'Bill Time': bill.billTime || bill.dateTimeKolkata.split(',')[1]?.trim() || '',
    'Sync Status': 'Synced',

    // Backwards & Forward Compatible Column Aliases for existing sheets
    'Mobile Number': `${bill.countryCode} ${bill.mobileNumber}`,
    'Product Details': bill.itemDetailsSummary || bill.items.map((i) => `${i.name} (${i.quantity})`).join(', '),
    'Total Quantity': bill.itemCount || bill.items.reduce((sum, item) => sum + item.quantity, 0),
    'Item Count': bill.itemCount || bill.items.reduce((sum, item) => sum + item.quantity, 0),
    'Item Prices': bill.itemPricesSummary || bill.items.map((i) => `${i.name}: Rs ${i.unitPriceRupees}`).join(', '),
    'Subtotal (Rs)': bill.subtotalRupees,
    'Subtotal (₹)': bill.subtotalRupees,
    'Discount (Rs)': bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : (bill.discountRupees || 0),
    'Discount (₹)': bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : (bill.discountRupees || 0),
    'Final Amount (Rs)': bill.grandTotalRupees,
    'Final Amount (₹)': bill.grandTotalRupees,
    'Grand Total (Rs)': bill.grandTotalRupees,
    'Grand Total (₹)': bill.grandTotalRupees,
    'Grand Total': bill.grandTotalRupees,
    'Order Type': bill.orderTypeLabel || (bill.orderType === 'PACK' ? 'Pack' : 'Dine In'),
    'Date & Time (IST)': bill.dateTimeKolkata,
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
      'Customer Name': bill.customerName,
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
