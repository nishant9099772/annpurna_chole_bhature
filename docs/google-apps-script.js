/**
 * ANNAPURNA CHOLE BHATURE — Google Apps Script Web App Bridge
 * ============================================================================
 * Use this script if you prefer connecting Google Sheets via a Google Apps Script
 * Web App URL (`GOOGLE_APPS_SCRIPT_URL` in Netlify) instead of a Service Account.
 *
 * SETUP STEPS:
 * 1. Open your Google Sheet -> Extensions -> Apps Script.
 * 2. Paste this entire file into `Code.gs` and click Save.
 * 3. Click "Deploy" -> "New deployment" -> Select type: "Web app".
 * 4. Set "Execute as": "Me"
 * 5. Set "Who has access": "Anyone"
 * 6. Click Deploy, authorize access, and copy the Web App URL (`https://script.google.com/macros/s/.../exec`).
 * 7. Add `GOOGLE_APPS_SCRIPT_URL` in Netlify -> Site configuration -> Environment variables.
 */

const CANONICAL_BILLS_HEADERS = [
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

const CANONICAL_ITEMS_HEADERS = [
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

function ensureTabs(ss) {
  let billsSheet = ss.getSheetByName('Bills');
  if (!billsSheet) {
    billsSheet = ss.insertSheet('Bills');
    billsSheet.appendRow(CANONICAL_BILLS_HEADERS);
    billsSheet.setFrozenRows(1);
  } else if (billsSheet.getLastRow() === 0) {
    billsSheet.appendRow(CANONICAL_BILLS_HEADERS);
    billsSheet.setFrozenRows(1);
  }

  let itemsSheet = ss.getSheetByName('Bill Items');
  if (!itemsSheet) {
    itemsSheet = ss.insertSheet('Bill Items');
    itemsSheet.appendRow(CANONICAL_ITEMS_HEADERS);
    itemsSheet.setFrozenRows(1);
  } else if (itemsSheet.getLastRow() === 0) {
    itemsSheet.appendRow(CANONICAL_ITEMS_HEADERS);
    itemsSheet.setFrozenRows(1);
  }

  return { billsSheet, itemsSheet };
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const bill = payload.bill;
    if (!bill || !bill.orderId) {
      return ContentService.createTextOutput(
        JSON.stringify({ success: false, error: 'Missing bill or orderId in request payload' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const { billsSheet, itemsSheet } = ensureTabs(ss);

    // Check for duplicate Order ID
    const lastRow = billsSheet.getLastRow();
    if (lastRow > 1) {
      const existingOrderIds = billsSheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      if (existingOrderIds.indexOf(bill.orderId) !== -1) {
        return ContentService.createTextOutput(
          JSON.stringify({
            success: true,
            alreadyExists: true,
            spreadsheetId: ss.getId(),
            spreadsheetUrl: ss.getUrl(),
          })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    const itemsSummary =
      bill.itemDetailsSummary ||
      (bill.items || []).map(function (i) { return i.name + ' (' + i.quantity + ')'; }).join(', ');
    const itemPricesSummary =
      bill.itemPricesSummary ||
      (bill.items || []).map(function (i) { return i.name + ': Rs ' + i.unitPriceRupees; }).join(', ');
    const totalQty =
      bill.itemCount ||
      (bill.items || []).reduce(function (s, i) { return s + Number(i.quantity || 0); }, 0);
    const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
    const discAmt =
      bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;

    billsSheet.appendRow([
      bill.orderId,
      bill.billNumber,
      bill.billDate || '',
      bill.billTime || '',
      bill.dateTimeKolkata || '',
      bill.orderTypeLabel || (bill.orderType === 'PACK' ? 'Pack' : 'Dine In'),
      bill.userId || 'admin',
      bill.customerName,
      (bill.countryCode || '+91') + ' ' + bill.mobileNumber,
      itemsSummary,
      totalQty,
      itemPricesSummary,
      bill.subtotalRupees,
      discPct + '%',
      discAmt,
      bill.grandTotalRupees,
      bill.paymentMethod || 'Cash',
      bill.paymentStatus || 'Paid',
      'Synced',
    ]);

    if (Array.isArray(bill.items)) {
      bill.items.forEach(function (item) {
        itemsSheet.appendRow([
          bill.orderId,
          bill.billNumber,
          bill.orderTypeLabel || 'Dine In',
          item.name,
          item.quantity,
          item.unitPriceRupees,
          item.lineTotalRupees,
          bill.paymentMethod || 'Cash',
          bill.customerName,
          bill.dateTimeKolkata || '',
          bill.userId || 'admin',
          bill.id,
        ]);
      });
    }

    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: String(err && err.message ? err.message : err) })
    ).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ensureTabs(ss);
    return ContentService.createTextOutput(
      JSON.stringify({
        success: true,
        status: 'UP',
        spreadsheetId: ss.getId(),
        spreadsheetUrl: ss.getUrl(),
      })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
