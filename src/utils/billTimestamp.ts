import { Bill, BusinessMetrics } from '../types/billing';
import { formatCustomerNameWithJi } from './customerFormat';

/**
 * Rolling 24-hour window in milliseconds (86,400,000 ms).
 */
export const ROLLING_24H_WINDOW_MS = 24 * 60 * 60 * 1000;

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function convertTo24Hour(hour: number, ampm?: string): number {
  if (!ampm) return hour;
  const lower = ampm.toLowerCase();
  if (lower === 'pm' && hour < 12) return hour + 12;
  if (lower === 'am' && hour === 12) return 0;
  return hour;
}

/**
 * Parses Asia/Kolkata formatted date/time strings into an exact UTC epoch timestamp (ms).
 * Supports:
 * - "01 Nov 2026, 10:51:56 pm IST"
 * - "01/11/2026" + "10:51 pm"
 * - "2026-11-01" + "22:51:56"
 * - Order ID / Bill Number patterns like "ORD-20261101-1948" or "ACB-20261101-0005"
 */
export function parseKolkataDateTimeToMs(
  dateTimeKolkata?: string | null,
  billDate?: string | null,
  billTime?: string | null,
  orderIdOrBillNo?: string | null
): number | null {
  const dtRaw = typeof dateTimeKolkata === 'string' ? dateTimeKolkata.trim() : '';

  // 1. Try "01 Nov 2026, 10:51:56 pm IST" or "01 Nov 2026 10:51 pm"
  if (dtRaw) {
    const namedMonthMatch = dtRaw.match(
      /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i
    );
    if (namedMonthMatch) {
      const day = parseInt(namedMonthMatch[1], 10);
      const monthNum = MONTH_NAME_TO_NUMBER[namedMonthMatch[2].toLowerCase()];
      const year = parseInt(namedMonthMatch[3], 10);
      const rawHour = namedMonthMatch[4] ? parseInt(namedMonthMatch[4], 10) : 12;
      const minute = namedMonthMatch[5] ? parseInt(namedMonthMatch[5], 10) : 0;
      const second = namedMonthMatch[6] ? parseInt(namedMonthMatch[6], 10) : 0;
      const ampm = namedMonthMatch[7];

      if (monthNum && day >= 1 && day <= 31 && year >= 2000) {
        const hour24 = convertTo24Hour(rawHour, ampm);
        const iso = `${year}-${pad2(monthNum)}-${pad2(day)}T${pad2(hour24)}:${pad2(minute)}:${pad2(second)}+05:30`;
        const parsed = Date.parse(iso);
        if (!isNaN(parsed)) return parsed;
      }
    }

    // Try "DD/MM/YYYY, HH:MM(:SS) am/pm" inside dateTimeKolkata
    const slashMatch = dtRaw.match(
      /(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i
    );
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const monthNum = parseInt(slashMatch[2], 10);
      const year = parseInt(slashMatch[3], 10);
      const rawHour = slashMatch[4] ? parseInt(slashMatch[4], 10) : 12;
      const minute = slashMatch[5] ? parseInt(slashMatch[5], 10) : 0;
      const second = slashMatch[6] ? parseInt(slashMatch[6], 10) : 0;
      const ampm = slashMatch[7];

      if (monthNum >= 1 && monthNum <= 12 && day >= 1 && day <= 31 && year >= 2000) {
        const hour24 = convertTo24Hour(rawHour, ampm);
        const iso = `${year}-${pad2(monthNum)}-${pad2(day)}T${pad2(hour24)}:${pad2(minute)}:${pad2(second)}+05:30`;
        const parsed = Date.parse(iso);
        if (!isNaN(parsed)) return parsed;
      }
    }
  }

  // 2. Try billDate ("DD/MM/YYYY" or "YYYY-MM-DD") + optional billTime ("10:51 pm")
  const dRaw = typeof billDate === 'string' ? billDate.trim() : '';
  const tRaw = typeof billTime === 'string' ? billTime.trim() : '';
  if (dRaw) {
    let year = 0;
    let monthNum = 0;
    let day = 0;

    const dmy = dRaw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    const ymd = dRaw.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
    if (dmy) {
      day = parseInt(dmy[1], 10);
      monthNum = parseInt(dmy[2], 10);
      year = parseInt(dmy[3], 10);
    } else if (ymd) {
      year = parseInt(ymd[1], 10);
      monthNum = parseInt(ymd[2], 10);
      day = parseInt(ymd[3], 10);
    }

    if (year >= 2000 && monthNum >= 1 && monthNum <= 12 && day >= 1 && day <= 31) {
      let hour24 = 12;
      let minute = 0;
      let second = 0;

      if (tRaw) {
        const tm = tRaw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (tm) {
          hour24 = convertTo24Hour(parseInt(tm[1], 10), tm[4]);
          minute = parseInt(tm[2], 10);
          second = tm[3] ? parseInt(tm[3], 10) : 0;
        }
      }

      const iso = `${year}-${pad2(monthNum)}-${pad2(day)}T${pad2(hour24)}:${pad2(minute)}:${pad2(second)}+05:30`;
      const parsed = Date.parse(iso);
      if (!isNaN(parsed)) return parsed;
    }
  }

  // 3. Fallback: extract date from Order ID / Bill Number (ORD-YYYYMMDD-XXXX or ACB-YYYYMMDD-XXXX)
  const idRaw = typeof orderIdOrBillNo === 'string' ? orderIdOrBillNo.trim() : '';
  if (idRaw) {
    const ordMatch = idRaw.match(/(\d{4})(\d{2})(\d{2})/);
    if (ordMatch) {
      const year = parseInt(ordMatch[1], 10);
      const monthNum = parseInt(ordMatch[2], 10);
      const day = parseInt(ordMatch[3], 10);
      if (year >= 2000 && monthNum >= 1 && monthNum <= 12 && day >= 1 && day <= 31) {
        const parsed = Date.parse(`${year}-${pad2(monthNum)}-${pad2(day)}T12:00:00+05:30`);
        if (!isNaN(parsed)) return parsed;
      }
    }
  }

  return null;
}

/**
 * Resolves the authoritative millisecond timestamp for any bill record.
 */
export function resolveBillTimestampMs(bill: Partial<Bill>): number {
  const numericTs = typeof bill.timestamp === 'number' ? bill.timestamp : Number(bill.timestamp);
  const parsedFromStrings = parseKolkataDateTimeToMs(
    bill.dateTimeKolkata,
    bill.billDate,
    bill.billTime,
    bill.orderId || bill.billNumber
  );

  // If the bill came from a Google Sheet reconstruction where timestamp was synthesized at 12:00 noon,
  // prefer the exact timestamp parsed from dateTimeKolkata / billDate + billTime when available.
  if (
    typeof bill.id === 'string' &&
    bill.id.startsWith('SHEET-') &&
    parsedFromStrings !== null &&
    Number.isFinite(parsedFromStrings)
  ) {
    return parsedFromStrings;
  }

  if (Number.isFinite(numericTs) && numericTs > 946684800000) {
    return numericTs;
  }

  if (parsedFromStrings !== null && Number.isFinite(parsedFromStrings)) {
    return parsedFromStrings;
  }

  return Date.now();
}

/**
 * Checks whether a bill or timestamp falls within the latest 24-hour rolling window:
 * [nowMs - 24 hours, nowMs]
 */
export function isWithinRolling24Hours(
  billOrTimestamp: Partial<Bill> | number,
  nowMs: number = Date.now()
): boolean {
  const ts =
    typeof billOrTimestamp === 'number'
      ? billOrTimestamp
      : resolveBillTimestampMs(billOrTimestamp);
  const windowStartMs = nowMs - ROLLING_24H_WINDOW_MS;
  // Allow up to 60 seconds of forward clock tolerance for newly minted bills
  return ts >= windowStartMs && ts <= nowMs + 60_000;
}

/**
 * Returns YYYY-MM-DD in Asia/Kolkata timezone for a given epoch timestamp (ms).
 */
export function getKolkataDateString(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestampMs));
}

/**
 * Deduplicates an array of bills by id, orderId, and billNumber.
 * Preserves synced status and accurate timestamps when merging duplicate entries.
 */
export function deduplicateBills(bills: Bill[]): Bill[] {
  const byCanonicalKey = new Map<string, Bill>();
  const idToCanonicalKey = new Map<string, string>();
  const orderIdToCanonicalKey = new Map<string, string>();
  const billNoToCanonicalKey = new Map<string, string>();

  for (const rawBill of bills) {
    if (!rawBill || typeof rawBill !== 'object') continue;

    const idKey = String(rawBill.id || '').trim();
    const orderIdKey = String(rawBill.orderId || '').trim().toUpperCase();
    const billNoKey = String(rawBill.billNumber || '').trim().toUpperCase();

    if (!idKey && !orderIdKey && !billNoKey) continue;

    const resolvedTs = resolveBillTimestampMs(rawBill);
    const normalizedBill: Bill = {
      ...rawBill,
      customerName: formatCustomerNameWithJi(rawBill.customerName || 'Customer'),
      timestamp: resolvedTs,
    };

    const existingCanonicalKey =
      (orderIdKey && orderIdToCanonicalKey.get(orderIdKey)) ||
      (billNoKey && billNoToCanonicalKey.get(billNoKey)) ||
      (idKey && idToCanonicalKey.get(idKey));

    if (!existingCanonicalKey) {
      const canonical = orderIdKey || billNoKey || idKey;
      byCanonicalKey.set(canonical, normalizedBill);
      if (idKey) idToCanonicalKey.set(idKey, canonical);
      if (orderIdKey) orderIdToCanonicalKey.set(orderIdKey, canonical);
      if (billNoKey) billNoToCanonicalKey.set(billNoKey, canonical);
    } else {
      const prev = byCanonicalKey.get(existingCanonicalKey)!;
      // Prefer non-SHEET internal ID and accurate millisecond timestamp
      const preferPrevId =
        prev.id && !prev.id.startsWith('SHEET-')
          ? prev.id
          : normalizedBill.id || prev.id;

      const preferTimestamp =
        prev.id && !prev.id.startsWith('SHEET-') && prev.timestamp > 946684800000
          ? prev.timestamp
          : normalizedBill.timestamp;

      const isSynced = Boolean(
        prev.savedToSheets ||
          normalizedBill.savedToSheets ||
          prev.sheetsSyncStatus === 'synced' ||
          normalizedBill.sheetsSyncStatus === 'synced'
      );

      const statusRank: Record<string, number> = {
        WAITING: 1,
        PREPARING: 2,
        LATE: 3,
        COMPLETED: 4,
      };
      const prevRank = statusRank[prev.orderStatus || 'WAITING'] || 1;
      const nextRank = statusRank[normalizedBill.orderStatus || 'WAITING'] || 1;
      const mergedOrderStatus =
        nextRank > prevRank
          ? normalizedBill.orderStatus
          : prev.orderStatus || normalizedBill.orderStatus || 'WAITING';

      const merged: Bill = {
        ...normalizedBill,
        ...prev,
        id: preferPrevId,
        customerName: formatCustomerNameWithJi(prev.customerName || normalizedBill.customerName),
        timestamp: preferTimestamp,
        savedToSheets: isSynced,
        sheetsSyncStatus: isSynced
          ? 'synced'
          : prev.sheetsSyncStatus || normalizedBill.sheetsSyncStatus || 'pending',
        spreadsheetId: prev.spreadsheetId || normalizedBill.spreadsheetId,
        spreadsheetUrl: prev.spreadsheetUrl || normalizedBill.spreadsheetUrl,
        items:
          Array.isArray(prev.items) && prev.items.length > 0
            ? prev.items
            : normalizedBill.items || [],
        orderStatus: mergedOrderStatus,
        orderCreatedAt: prev.orderCreatedAt || normalizedBill.orderCreatedAt || preferTimestamp,
        orderStartedAt: prev.orderStartedAt || normalizedBill.orderStartedAt,
        orderLateAt: prev.orderLateAt || normalizedBill.orderLateAt,
        orderCompletedAt: prev.orderCompletedAt || normalizedBill.orderCompletedAt,
        startedBy: prev.startedBy || normalizedBill.startedBy,
        completedBy: prev.completedBy || normalizedBill.completedBy,
        specialInstructions: prev.specialInstructions || normalizedBill.specialInstructions,
      };

      byCanonicalKey.set(existingCanonicalKey, merged);
      if (idKey) idToCanonicalKey.set(idKey, existingCanonicalKey);
      if (orderIdKey) orderIdToCanonicalKey.set(orderIdKey, existingCanonicalKey);
      if (billNoKey) billNoToCanonicalKey.set(billNoKey, existingCanonicalKey);
    }
  }

  return Array.from(byCanonicalKey.values()).sort(
    (a, b) => resolveBillTimestampMs(b) - resolveBillTimestampMs(a)
  );
}

/**
 * Authoritative calculation of BusinessMetrics from a collection of bills.
 * Uses a strict 24-hour rolling window [nowMs - 24h, nowMs] based on actual transaction timestamps
 * for `todaySalesRupees` and `todayBillsCount` (as well as `rolling24hSalesRupees` / `rolling24hBillsCount`).
 * Never deletes or mutates historical records.
 */
export function computeBusinessMetricsFromBills(
  rawBills: Bill[],
  nowMs: number = Date.now()
): BusinessMetrics {
  const bills = deduplicateBills(rawBills);
  const windowStartMs = nowMs - ROLLING_24H_WINDOW_MS;

  const todayStr = getKolkataDateString(nowMs);
  const currentMonthPrefix = todayStr.slice(0, 7); // YYYY-MM

  const monthNameFormatter = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'long',
  });
  const currentMonthName = monthNameFormatter.format(new Date(nowMs));
  const currentYear = parseInt(todayStr.slice(0, 4), 10);

  let rolling24hSalesPaise = 0;
  let rolling24hBillsCount = 0;
  let monthlySalesPaise = 0;
  let monthlyBillsCount = 0;
  let totalRevenuePaise = 0;
  let syncedBillsCount = 0;
  let failedBillsCount = 0;

  for (const b of bills) {
    const billTs = resolveBillTimestampMs(b);
    const billDateStr = getKolkataDateString(billTs);

    const amountPaise =
      typeof b.grandTotalPaise === 'number' && !isNaN(b.grandTotalPaise)
        ? b.grandTotalPaise
        : Math.round((Number(b.grandTotalRupees) || 0) * 100);

    totalRevenuePaise += amountPaise;

    // 24-Hour Rolling Window check using actual transaction timestamp
    if (billTs >= windowStartMs && billTs <= nowMs + 60_000) {
      rolling24hSalesPaise += amountPaise;
      rolling24hBillsCount += 1;
    }

    // Current Calendar Month check (in Asia/Kolkata)
    if (billDateStr.startsWith(currentMonthPrefix)) {
      monthlySalesPaise += amountPaise;
      monthlyBillsCount += 1;
    }

    if (b.sheetsSyncStatus === 'synced' || b.savedToSheets) {
      syncedBillsCount += 1;
    } else if (b.sheetsSyncStatus === 'failed' || b.sheetsSyncStatus === 'pending') {
      failedBillsCount += 1;
    }
  }

  const rolling24hSalesRupees = rolling24hSalesPaise / 100;

  return {
    totalBills: bills.length,
    todaySalesRupees: rolling24hSalesRupees,
    todayBillsCount: rolling24hBillsCount,
    rolling24hSalesRupees,
    rolling24hBillsCount,
    rolling24hWindowStart: windowStartMs,
    rolling24hWindowEnd: nowMs,
    monthlySalesRupees: monthlySalesPaise / 100,
    monthlyBillsCount,
    totalRevenueRupees: totalRevenuePaise / 100,
    syncedBillsCount,
    failedBillsCount,
    currentMonthName,
    currentYear,
  };
}
