import { Bill, BusinessMetrics, MonthlyReportData, DailySalesData } from '../types/billing';
import {
  computeBusinessMetricsFromBills,
  deduplicateBills,
  getKolkataDateString,
  resolveBillTimestampMs,
} from './billTimestamp';
import { parseApiJsonResponse } from './apiClient';

export const PERSISTENT_BILLS_STORAGE_KEY = 'annpurna_persistent_bills_v1';
export const LEGACY_PENDING_BILLS_KEY = 'annpurna_pending_sync_bills';

/**
 * Loads all persistently stored bills from localStorage (never cleared on logout).
 * Automatically merges any legacy pending bills and deduplicates by id, orderId, and billNumber.
 */
export function loadPersistentBills(): Bill[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];

  const collected: Bill[] = [];

  try {
    const rawMain = window.localStorage.getItem(PERSISTENT_BILLS_STORAGE_KEY);
    if (rawMain) {
      const parsed = JSON.parse(rawMain);
      if (Array.isArray(parsed)) {
        collected.push(...parsed);
      }
    }
  } catch {
    // ignore malformed storage
  }

  try {
    const rawPending = window.localStorage.getItem(LEGACY_PENDING_BILLS_KEY);
    if (rawPending) {
      const parsedPending = JSON.parse(rawPending);
      if (Array.isArray(parsedPending)) {
        collected.push(...parsedPending);
      }
    }
  } catch {
    // ignore malformed storage
  }

  return deduplicateBills(collected);
}

/**
 * Merges incoming bills with existing persistent bills in localStorage without ever deleting historical records.
 * Returns the full deduplicated list sorted newest-first.
 */
export function savePersistentBills(incomingBills: Bill[]): Bill[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return deduplicateBills(incomingBills);
  }

  const existing = loadPersistentBills();
  const merged = deduplicateBills([...incomingBills, ...existing]);

  try {
    window.localStorage.setItem(PERSISTENT_BILLS_STORAGE_KEY, JSON.stringify(merged));
  } catch (err) {
    console.warn('Could not write persistent bills to localStorage:', err);
  }

  return merged;
}

/**
 * Upserts a single completed or updated bill into the persistent ledger.
 */
export function upsertPersistentBill(bill: Bill): Bill[] {
  return savePersistentBills([bill]);
}

/**
 * Bidirectionally synchronizes and hydrates bills between the browser's persistent ledger,
 * the backend database, and Google Sheets.
 * Guarantees that across logout, login, page refresh, and Netlify serverless cold starts,
 * no transaction is ever lost or duplicated.
 */
export async function hydrateAndSyncBillsWithServer(
  adminToken: string,
  googleToken?: string | null,
  customSpreadsheetId?: string | null
): Promise<{ metrics: BusinessMetrics; bills: Bill[] }> {
  const localBills = loadPersistentBills();
  const effectiveSheetId =
    customSpreadsheetId ??
    (typeof window !== 'undefined' ? window.localStorage.getItem('annpurna_custom_sheet_id') : null) ??
    undefined;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };
    if (googleToken) {
      headers['x-google-token'] = googleToken;
    }

    const res = await fetch('/api/bills/hydrate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientBills: localBills,
        googleAccessToken: googleToken || undefined,
        customSpreadsheetId: effectiveSheetId || undefined,
      }),
    });

    if (res.status === 401) {
      const authError: any = new Error('Unauthorized');
      authError.status = 401;
      throw authError;
    }

    const { ok, data } = await parseApiJsonResponse<any>(res);
    if (ok && data) {
      const serverBills: Bill[] = Array.isArray(data?.bills) ? data.bills : [];
      const mergedBills = savePersistentBills(serverBills);
      // Compute rolling 24-hour metrics from the authoritative merged set
      const computedMetrics = computeBusinessMetricsFromBills(mergedBills, Date.now());
      return {
        metrics: computedMetrics,
        bills: mergedBills,
      };
    }
  } catch (err: any) {
    if (err?.status === 401) throw err;
    console.warn('Hydrate endpoint fallback to local persistent ledger:', err?.message);
  }

  const fallbackMetrics = computeBusinessMetricsFromBills(localBills, Date.now());
  return {
    metrics: fallbackMetrics,
    bills: localBills,
  };
}

/**
 * Builds an authoritative MonthlyReportData object from a merged array of bills
 * so the Sales Calendar and Dashboard always reflect the exact same persistent records.
 */
export function buildMonthlyReportFromBills(
  rawBills: Bill[],
  year: number,
  month: number
): MonthlyReportData {
  const allBills = deduplicateBills(rawBills);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthLabel = `${monthNames[month - 1]} ${year}`;
  const targetPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const dailyMap = new Map<string, { revenuePaise: number; bills: Bill[] }>();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${targetPrefix}-${String(d).padStart(2, '0')}`;
    dailyMap.set(dateKey, { revenuePaise: 0, bills: [] });
  }

  let totalRevenuePaise = 0;
  let totalBills = 0;

  for (const bill of allBills) {
    const ts = resolveBillTimestampMs(bill);
    const kolkataDate = getKolkataDateString(ts);
    if (kolkataDate.startsWith(targetPrefix)) {
      const entry = dailyMap.get(kolkataDate);
      if (entry) {
        const amountPaise =
          typeof bill.grandTotalPaise === 'number' && !isNaN(bill.grandTotalPaise)
            ? bill.grandTotalPaise
            : Math.round((Number(bill.grandTotalRupees) || 0) * 100);
        entry.revenuePaise += amountPaise;
        entry.bills.push(bill);
        totalRevenuePaise += amountPaise;
        totalBills += 1;
      }
    }
  }

  const dailyData: DailySalesData[] = [];
  let bestSalesDay: MonthlyReportData['bestSalesDay'] = null;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${targetPrefix}-${String(d).padStart(2, '0')}`;
    const entry = dailyMap.get(dateKey)!;
    const dateObj = new Date(Date.UTC(year, month - 1, d));
    const dayName = dayNames[dateObj.getUTCDay()];
    const revenueRupees = entry.revenuePaise / 100;
    const sortedBills = [...entry.bills].sort(
      (a, b) => resolveBillTimestampMs(b) - resolveBillTimestampMs(a)
    );

    dailyData.push({
      date: dateKey,
      dayNumber: d,
      dayName,
      revenueRupees,
      billsCount: sortedBills.length,
      bills: sortedBills,
    });

    if (sortedBills.length > 0) {
      if (!bestSalesDay || revenueRupees > bestSalesDay.revenueRupees) {
        bestSalesDay = {
          date: dateKey,
          dayNumber: d,
          revenueRupees,
          billsCount: sortedBills.length,
        };
      }
    }
  }

  const totalRevenueRupees = totalRevenuePaise / 100;
  const averageBillValueRupees =
    totalBills > 0 ? Math.round((totalRevenueRupees / totalBills) * 100) / 100 : 0;

  return {
    year,
    month,
    monthLabel,
    totalRevenueRupees,
    totalBills,
    averageBillValueRupees,
    bestSalesDay,
    dailyData,
  };
}
