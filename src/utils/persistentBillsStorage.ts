/**
 * Client-Side Persistent Bills Ledger & Server Hydration Service
 *
 * Guarantees that all sales, revenue, order counts, transaction statistics,
 * and dashboard metrics remain available across:
 *   - User logouts
 *   - User logins
 *   - Page refreshes
 *   - Browser restarts
 *   - Serverless function cold starts (by re-hydrating the server from the client ledger + Google Sheets)
 *
 * Also enforces `lastResetTimestamp` watermark synchronization so that when an Admin
 * executes `RESET SALES DATA`, pre-reset bills in browser localStorage or offline queues
 * are immediately purged and can never resurrect deleted sales or orders.
 */

import { Bill, BusinessMetrics, DailySalesData, MonthlyReportData } from '../types/billing';
import {
  computeBusinessMetricsFromBills,
  deduplicateBills,
  getKolkataDateString,
  resolveBillTimestampMs,
} from './billTimestamp';
import { apiFetch, parseApiJsonResponse } from './apiClient';

export const PERSISTENT_BILLS_STORAGE_KEY = 'annpurna_persistent_bills_v1';
export const LEGACY_PENDING_BILLS_KEY = 'annpurna_pending_sync_bills';
export const LAST_RESET_TIMESTAMP_KEY = 'annpurna_last_reset_timestamp_v1';

/**
 * Returns the latest Admin Sales Reset timestamp (ms) recorded on this client.
 */
export function getLocalLastResetTimestamp(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  try {
    const raw = window.localStorage.getItem(LAST_RESET_TIMESTAMP_KEY);
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : 0;
  } catch {
    return 0;
  }
}

/**
 * Updates the local reset timestamp watermark and purges any bills created at or before that watermark.
 */
export function setLocalLastResetTimestamp(resetTimestampMs: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  if (!Number.isFinite(resetTimestampMs) || resetTimestampMs <= 0) return;
  try {
    const current = getLocalLastResetTimestamp();
    if (resetTimestampMs > current) {
      window.localStorage.setItem(LAST_RESET_TIMESTAMP_KEY, String(resetTimestampMs));
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Completely clears all local persistent bills and pending sync queues (used on Admin Sales Reset).
 */
export function clearAllPersistentBills(resetTimestampMs?: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (resetTimestampMs && resetTimestampMs > 0) {
      setLocalLastResetTimestamp(resetTimestampMs);
    }
    window.localStorage.setItem(PERSISTENT_BILLS_STORAGE_KEY, JSON.stringify([]));
    window.localStorage.removeItem(LEGACY_PENDING_BILLS_KEY);
  } catch (err) {
    console.warn('[PersistentBills] Failed clearing localStorage bills:', err);
  }
}

/**
 * Reads all bills stored in persistent browser storage (never cleared on logout).
 * Automatically merges any legacy pending bills and filters out any pre-reset bills.
 */
export function loadPersistentBills(): Bill[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const resetWatermark = getLocalLastResetTimestamp();
    const rawMain = window.localStorage.getItem(PERSISTENT_BILLS_STORAGE_KEY);
    const rawLegacy = window.localStorage.getItem(LEGACY_PENDING_BILLS_KEY);

    const list: Bill[] = [];
    if (rawMain) {
      const parsedMain = JSON.parse(rawMain);
      if (Array.isArray(parsedMain)) list.push(...parsedMain);
    }
    if (rawLegacy) {
      const parsedLegacy = JSON.parse(rawLegacy);
      if (Array.isArray(parsedLegacy)) list.push(...parsedLegacy);
    }

    const deduped = deduplicateBills(list);
    if (resetWatermark > 0) {
      return deduped.filter((b) => resolveBillTimestampMs(b) > resetWatermark);
    }
    return deduped;
  } catch (err) {
    console.warn('[PersistentBills] Failed reading localStorage bills:', err);
    return [];
  }
}

/**
 * Saves and deduplicates a list of bills into persistent browser storage,
 * respecting the Admin Sales Reset watermark.
 */
export function savePersistentBills(incomingBills: Bill[]): Bill[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return deduplicateBills(incomingBills);
  }
  try {
    const resetWatermark = getLocalLastResetTimestamp();
    const existing = loadPersistentBills();
    const merged = deduplicateBills([...incomingBills, ...existing]).filter(
      (b) => resetWatermark === 0 || resolveBillTimestampMs(b) > resetWatermark
    );
    window.localStorage.setItem(PERSISTENT_BILLS_STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch (err) {
    console.warn('[PersistentBills] Failed writing localStorage bills:', err);
    return deduplicateBills(incomingBills);
  }
}

/**
 * Appends or updates a single bill in the persistent browser ledger.
 */
export function upsertPersistentBill(bill: Bill): Bill[] {
  return savePersistentBills([bill]);
}

// In-flight deduplication & throttle for hydration calls so switching tabs doesn't trigger redundant network roundtrips
let activeHydrationPromise: Promise<{ bills: Bill[]; metrics: BusinessMetrics }> | null = null;
let lastClientHydrationAt = 0;
const CLIENT_HYDRATION_COOLDOWN_MS = 15_000;

/**
 * Bidirectionally synchronizes bills between the persistent client ledger,
 * the backend persistent store (`./data/bills.json`), and Google Sheets.
 * Respects `lastResetTimestamp` so an Admin Sales Reset clears stale local bills across all devices.
 */
export async function hydrateAndSyncBillsWithServer(
  adminToken: string,
  googleToken?: string | null,
  customSpreadsheetId?: string,
  force: boolean = false
): Promise<{
  bills: Bill[];
  metrics: BusinessMetrics;
}> {
  const localBills = loadPersistentBills();

  if (
    !force &&
    localBills.length > 0 &&
    Date.now() - lastClientHydrationAt < CLIENT_HYDRATION_COOLDOWN_MS
  ) {
    return {
      bills: localBills,
      metrics: computeBusinessMetricsFromBills(localBills, Date.now()),
    };
  }

  if (activeHydrationPromise) {
    return activeHydrationPromise;
  }

  activeHydrationPromise = (async () => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${adminToken}`,
      };
      if (googleToken) {
        headers['x-google-token'] = googleToken;
      }

      const res = await apiFetch('/api/bills/hydrate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          clientBills: localBills,
          googleAccessToken: googleToken || undefined,
          customSpreadsheetId: customSpreadsheetId?.trim() || undefined,
        }),
      });

      if (res.status === 401) {
        const authErr: any = new Error('Unauthorized session');
        authErr.status = 401;
        throw authErr;
      }

      const { ok, data } = await parseApiJsonResponse<{
        bills?: Bill[];
        metrics?: BusinessMetrics;
        lastResetTimestamp?: number;
      }>(res);

      if (ok && data && Array.isArray(data.bills)) {
        lastClientHydrationAt = Date.now();

        const serverResetTs = Number(data.lastResetTimestamp) || 0;
        const localResetTs = getLocalLastResetTimestamp();

        if (serverResetTs > localResetTs) {
          // Server had a newer Admin Sales Data Reset! Purge pre-reset local storage first.
          clearAllPersistentBills(serverResetTs);
        } else if (serverResetTs > 0 && data.bills.length === 0) {
          clearAllPersistentBills(serverResetTs);
        }

        const mergedBills =
          data.bills.length === 0 && serverResetTs > 0
            ? []
            : savePersistentBills(data.bills);

        if (data.bills.length === 0 && serverResetTs > 0 && typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(PERSISTENT_BILLS_STORAGE_KEY, JSON.stringify([]));
        }

        const authoritativeMetrics = computeBusinessMetricsFromBills(mergedBills, Date.now());
        return {
          bills: mergedBills,
          metrics: authoritativeMetrics,
        };
      }
    } catch (err: any) {
      if (err?.status === 401) {
        throw err;
      }
      // Fallback to local persistent ledger if offline or server unreachable
    } finally {
      activeHydrationPromise = null;
    }

    const fallbackBills = loadPersistentBills();
    return {
      bills: fallbackBills,
      metrics: computeBusinessMetricsFromBills(fallbackBills, Date.now()),
    };
  })();

  return activeHydrationPromise;
}

/**
 * Generates a MonthlyReportData structure on the client from merged bills
 * so the Monthly Sales Calendar always includes all historical bills.
 */
export function buildMonthlyReportFromBills(
  bills: Bill[],
  year: number,
  month: number
): MonthlyReportData {
  const list = deduplicateBills(bills);

  const targetYear = Math.max(2020, Math.min(2099, Math.floor(year)));
  const targetMonth = Math.max(1, Math.min(12, Math.floor(month)));
  const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

  const monthLabelDate = new Date(Date.UTC(targetYear, targetMonth - 1, 15));
  const monthLabel = new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    year: 'numeric',
  }).format(monthLabelDate);

  const monthBills = list.filter((b) => {
    const bDateStr = getKolkataDateString(resolveBillTimestampMs(b));
    return bDateStr.startsWith(monthPrefix);
  });

  let totalRevenuePaise = 0;
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const dailyMap = new Map<number, { revenuePaise: number; bills: Bill[] }>();

  for (let day = 1; day <= daysInMonth; day++) {
    dailyMap.set(day, { revenuePaise: 0, bills: [] });
  }

  for (const b of monthBills) {
    const amountPaise =
      typeof b.grandTotalPaise === 'number' && !isNaN(b.grandTotalPaise)
        ? b.grandTotalPaise
        : Math.round((Number(b.grandTotalRupees) || 0) * 100);
    totalRevenuePaise += amountPaise;
    const bDateStr = getKolkataDateString(resolveBillTimestampMs(b));
    const dayNum = parseInt(bDateStr.slice(8, 10), 10);
    const existing = dailyMap.get(dayNum);
    if (existing) {
      existing.revenuePaise += amountPaise;
      existing.bills.push(b);
    }
  }

  let bestDayObj: {
    date: string;
    dayNumber: number;
    revenueRupees: number;
    billsCount: number;
  } | null = null;
  let maxDayPaise = -1;

  const dailyData: DailySalesData[] = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  for (let day = 1; day <= daysInMonth; day++) {
    const dayInfo = dailyMap.get(day)!;
    const dayDateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
    const dayOfWeekIndex = new Date(Date.UTC(targetYear, targetMonth - 1, day)).getUTCDay();
    const dayName = dayNames[dayOfWeekIndex];
    const revenueRupees = dayInfo.revenuePaise / 100;
    const billsCount = dayInfo.bills.length;

    dailyData.push({
      date: dayDateStr,
      dayNumber: day,
      dayName,
      revenueRupees,
      billsCount,
      bills: dayInfo.bills.sort(
        (a, b) => resolveBillTimestampMs(b) - resolveBillTimestampMs(a)
      ),
    });

    if (revenueRupees > 0 && dayInfo.revenuePaise > maxDayPaise) {
      maxDayPaise = dayInfo.revenuePaise;
      bestDayObj = {
        date: dayDateStr,
        dayNumber: day,
        revenueRupees,
        billsCount,
      };
    }
  }

  const totalBills = monthBills.length;
  const totalRevenueRupees = totalRevenuePaise / 100;
  const averageBillValueRupees =
    totalBills > 0 ? Math.round((totalRevenueRupees / totalBills) * 100) / 100 : 0;

  return {
    year: targetYear,
    month: targetMonth,
    monthLabel,
    totalRevenueRupees,
    totalBills,
    averageBillValueRupees,
    bestSalesDay: bestDayObj,
    dailyData,
  };
}
