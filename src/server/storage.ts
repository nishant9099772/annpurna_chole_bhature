/**
 * Annpurna Chole Bhature - Persistent Storage Layer
 * Thread-safe, disk-backed persistent storage in ./data/bills.json (with serverless /tmp fallback).
 * Survives server restarts, logouts, logins, page refreshes, and reboots.
 * Provides indexed Order ID lookups, multi-attribute filtering, pagination,
 * 24-hour rolling window dashboard analytics, and monthly sales calendar reporting.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  Bill,
  BusinessMetrics,
  KitchenOrder,
  MonthlyReportData,
  DailySalesData,
  PREP_TIME_LIMIT_MS,
} from '../types/billing';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import {
  computeBusinessMetricsFromBills,
  deduplicateBills,
  getKolkataDateString,
  isWithinRolling24Hours,
  resolveBillTimestampMs,
} from '../utils/billTimestamp';
import { billToKitchenOrder, computeOrderTimers } from '../utils/orderTimers';

const PRIMARY_DATA_DIR = path.resolve(process.cwd(), 'data');
const PRIMARY_BILLS_FILE = path.resolve(PRIMARY_DATA_DIR, 'bills.json');
const TMP_DATA_DIR = path.resolve(os.tmpdir(), 'annpurna-billing-data');
const TMP_BILLS_FILE = path.resolve(TMP_DATA_DIR, 'bills.json');

class BillStorage {
  private bills: Map<string, Bill> = new Map();
  private isLoaded = false;
  private sequence = 1;
  private activeDataDir = PRIMARY_DATA_DIR;
  private activeBillsFile = PRIMARY_BILLS_FILE;

  constructor() {
    this.init();
  }

  private normalizeBillRecord(b: Bill): Bill {
    const resolvedTs = resolveBillTimestampMs(b);
    const createdAt = b.orderCreatedAt || resolvedTs;
    // Historical bills created before the 3-profile kitchen order system that have no orderStatus
    // and are older than 2 hours default to 'COMPLETED' so old archive records don't clog the kitchen queue.
    const defaultLegacyStatus =
      Date.now() - createdAt > 2 * 60 * 60 * 1000 ? 'COMPLETED' : 'WAITING';
    const currentStatus = b.orderStatus || defaultLegacyStatus;

    let effectiveStatus = currentStatus;
    let effectiveLateAt = b.orderLateAt;
    if (
      (currentStatus === 'PREPARING' || currentStatus === 'LATE') &&
      b.orderStartedAt &&
      !b.orderCompletedAt
    ) {
      const timer = computeOrderTimers(
        {
          status: currentStatus,
          createdAt,
          startedAt: b.orderStartedAt,
          lateAt: b.orderLateAt,
          completedAt: b.orderCompletedAt,
        },
        Date.now()
      );
      effectiveStatus = timer.effectiveStatus;
      if (timer.lateAtTimestamp && !effectiveLateAt) {
        effectiveLateAt = timer.lateAtTimestamp;
      }
    }

    return {
      ...b,
      customerName: formatCustomerNameWithJi(b.customerName || 'Customer'),
      timestamp: resolvedTs,
      orderCreatedAt: createdAt,
      orderStatus: effectiveStatus,
      orderLateAt: effectiveLateAt,
      orderCompletedAt:
        effectiveStatus === 'COMPLETED' && !b.orderCompletedAt ? createdAt : b.orderCompletedAt,
    };
  }

  private init() {
    try {
      const candidateFiles: string[] = [];
      if (fs.existsSync(PRIMARY_BILLS_FILE)) {
        candidateFiles.push(PRIMARY_BILLS_FILE);
      }
      if (fs.existsSync(TMP_BILLS_FILE)) {
        candidateFiles.push(TMP_BILLS_FILE);
        this.activeDataDir = TMP_DATA_DIR;
        this.activeBillsFile = TMP_BILLS_FILE;
      }

      const loadedList: Bill[] = [];
      let needsNormalizedFlush = false;

      for (const file of candidateFiles) {
        try {
          const raw = fs.readFileSync(file, 'utf-8');
          if (raw.trim()) {
            const parsed: Bill[] = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              loadedList.push(...parsed);
            }
          }
        } catch (readErr) {
          console.warn(`[Storage] Failed reading ${file}:`, readErr);
        }
      }

      if (loadedList.length > 0) {
        const deduped = deduplicateBills(loadedList);
        deduped.forEach((b) => {
          const normalized = this.normalizeBillRecord(b);
          if (normalized.customerName !== b.customerName || normalized.timestamp !== b.timestamp) {
            needsNormalizedFlush = true;
          }
          this.bills.set(normalized.id, normalized);
        });
        this.sequence = this.bills.size + 1;
        console.log(`[Storage] Loaded ${this.bills.size} persistent bills`);
      } else {
        this.flushToDisk();
        console.log(`[Storage] Initialized new persistent bills file at ${this.activeBillsFile}`);
      }

      if (needsNormalizedFlush) {
        this.flushToDisk();
      }

      this.isLoaded = true;
    } catch (err: any) {
      console.error('[Storage] Error initializing persistent bills store:', err);
      this.isLoaded = true;
    }
  }

  private flushToDisk() {
    const allBills = deduplicateBills(Array.from(this.bills.values()));
    this.bills.clear();
    for (const b of allBills) {
      this.bills.set(b.id, b);
    }

    const payload = JSON.stringify(allBills, null, 2);

    try {
      if (!fs.existsSync(this.activeDataDir)) {
        fs.mkdirSync(this.activeDataDir, { recursive: true });
      }
      const tmpFile = `${this.activeBillsFile}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, payload, 'utf-8');
      fs.renameSync(tmpFile, this.activeBillsFile);
    } catch {
      // Fallback to os.tmpdir() if running in a read-only serverless container (e.g. Netlify Functions)
      try {
        this.activeDataDir = TMP_DATA_DIR;
        this.activeBillsFile = TMP_BILLS_FILE;
        if (!fs.existsSync(this.activeDataDir)) {
          fs.mkdirSync(this.activeDataDir, { recursive: true });
        }
        fs.writeFileSync(this.activeBillsFile, payload, 'utf-8');
      } catch (fallbackErr) {
        console.error('[Storage] Error persisting bills to disk:', fallbackErr);
      }
    }
  }

  /**
   * Generates a unique, human-friendly Order ID (e.g. ORD-20260330-7492)
   */
  public generateOrderId(): string {
    const datePart = getKolkataDateString(Date.now()).replace(/-/g, '');
    const randPart = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${datePart}-${randPart}`;
  }

  /**
   * Generates a sequential Bill Number (e.g. ACB-20260330-0001)
   */
  public generateBillNumber(): string {
    const datePart = getKolkataDateString(Date.now()).replace(/-/g, '');
    const seq = String(this.sequence++).padStart(4, '0');
    return `ACB-${datePart}-${seq}`;
  }

  /**
   * Saves a new bill permanently (idempotent deduplication by Order ID / Bill Number / ID)
   */
  public async saveBill(bill: Bill): Promise<Bill> {
    const normalized = this.normalizeBillRecord(bill);
    const existing =
      this.getBill(normalized.orderId) ||
      this.getBill(normalized.billNumber) ||
      this.getBill(normalized.id);

    if (existing && existing.id !== normalized.id) {
      this.bills.delete(existing.id);
    }

    this.bills.set(normalized.id, normalized);
    this.flushToDisk();
    return normalized;
  }

  /**
   * Updates an existing bill (e.g., after Google Sheets retry sync)
   */
  public async updateBill(id: string, updates: Partial<Bill>): Promise<Bill | null> {
    const existing = this.getBill(id);
    if (!existing) return null;

    const updated: Bill = this.normalizeBillRecord({
      ...existing,
      ...updates,
      id: existing.id, // prevent accidental ID change
    });

    this.bills.set(existing.id, updated);
    this.flushToDisk();
    return updated;
  }

  /**
   * Retrieves a bill by ID, Order ID, or Bill Number
   */
  public getBill(idOrOrderId: string): Bill | null {
    if (!idOrOrderId) return null;
    const query = idOrOrderId.trim().toUpperCase();

    // Check by internal record ID
    if (this.bills.has(idOrOrderId)) {
      return this.bills.get(idOrOrderId) || null;
    }

    // Check by Order ID or Bill Number
    for (const b of this.bills.values()) {
      if (
        b.id === idOrOrderId ||
        (b.orderId && b.orderId.toUpperCase() === query) ||
        (b.billNumber && b.billNumber.toUpperCase() === query)
      ) {
        return b;
      }
    }

    return null;
  }

  /**
   * Returns all stored bills sorted newest-first without deleting or filtering any record.
   */
  public getAllBills(): Bill[] {
    return deduplicateBills(Array.from(this.bills.values()));
  }

  /**
   * Merges bills fetched from Google Sheets or client persistent ledger idempotently
   * by Order ID / Bill Number / ID so historical data is permanently preserved across
   * logouts, logins, page refreshes, and serverless cold starts.
   */
  public mergeBillsFromSheets(remoteBills: Bill[]): number {
    if (!Array.isArray(remoteBills) || remoteBills.length === 0) return 0;
    let addedOrUpdatedCount = 0;

    for (const remote of remoteBills) {
      if (!remote || (!remote.orderId && !remote.billNumber && !remote.id)) continue;
      const existing =
        this.getBill(remote.orderId) ||
        this.getBill(remote.billNumber) ||
        this.getBill(remote.id);

      if (!existing) {
        const normalized = this.normalizeBillRecord(remote);
        this.bills.set(normalized.id, normalized);
        addedOrUpdatedCount++;
      } else {
        const remoteSynced = Boolean(remote.savedToSheets || remote.sheetsSyncStatus === 'synced');
        const existingSynced = Boolean(
          existing.savedToSheets || existing.sheetsSyncStatus === 'synced'
        );
        const resolvedRemoteTs = resolveBillTimestampMs(remote);
        const resolvedExistingTs = resolveBillTimestampMs(existing);

        if (remoteSynced && !existingSynced) {
          const updated = this.normalizeBillRecord({
            ...existing,
            timestamp: resolvedExistingTs || resolvedRemoteTs,
            savedToSheets: true,
            sheetsSyncStatus: 'synced',
            sheetsSyncError: undefined,
            spreadsheetId: remote.spreadsheetId || existing.spreadsheetId,
            spreadsheetUrl: remote.spreadsheetUrl || existing.spreadsheetUrl,
          });
          this.bills.set(existing.id, updated);
          addedOrUpdatedCount++;
        } else if (
          existing.id.startsWith('SHEET-') &&
          remote.id &&
          !remote.id.startsWith('SHEET-')
        ) {
          // Upgrade a sheet-reconstructed record with the full client/server record that has exact millisecond timestamp
          this.bills.delete(existing.id);
          const merged = this.normalizeBillRecord({
            ...existing,
            ...remote,
            id: remote.id,
            timestamp: resolvedRemoteTs,
            savedToSheets: existingSynced || remoteSynced,
            sheetsSyncStatus:
              existingSynced || remoteSynced
                ? 'synced'
                : remote.sheetsSyncStatus || existing.sheetsSyncStatus,
          });
          this.bills.set(merged.id, merged);
          addedOrUpdatedCount++;
        }
      }
    }

    if (addedOrUpdatedCount > 0) {
      this.sequence = Math.max(this.sequence, this.bills.size + 1);
      this.flushToDisk();
    }

    return addedOrUpdatedCount;
  }

  /**
   * Alias for merging client-persisted bills on login/refresh or serverless warm-up.
   */
  public mergeClientBills(clientBills: Bill[]): number {
    return this.mergeBillsFromSheets(clientBills);
  }

  /**
   * Lists and filters bills with pagination
   */
  public listBills(options: {
    search?: string;
    orderType?: string;
    paymentMethod?: string;
    syncStatus?: string;
    dateFilter?: string; // 'all' | '24h' | 'today' | 'yesterday' | 'this_month' | 'YYYY-MM-DD'
    userId?: string;
    page?: number;
    limit?: number;
  }): {
    bills: Bill[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } {
    let list = this.getAllBills();

    // 1. Search query (matches Order ID, Bill Number, Customer Name, Mobile Number)
    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      list = list.filter(
        (b) =>
          (b.orderId && b.orderId.toLowerCase().includes(q)) ||
          (b.billNumber && b.billNumber.toLowerCase().includes(q)) ||
          (b.customerName && b.customerName.toLowerCase().includes(q)) ||
          (b.mobileNumber && b.mobileNumber.includes(q)) ||
          (b.id && b.id.toLowerCase().includes(q))
      );
    }

    // 2. Order Type filter
    if (options.orderType && options.orderType !== 'all') {
      list = list.filter((b) => b.orderType === options.orderType);
    }

    // 3. Payment Method filter
    if (options.paymentMethod && options.paymentMethod !== 'all') {
      list = list.filter((b) => b.paymentMethod === options.paymentMethod);
    }

    // 4. Sync Status filter
    if (options.syncStatus && options.syncStatus !== 'all') {
      list = list.filter((b) => b.sheetsSyncStatus === options.syncStatus);
    }

    // 5. Date filter (Asia/Kolkata timezone & 24-hour rolling support)
    if (options.dateFilter && options.dateFilter !== 'all') {
      const nowMs = Date.now();
      const todayStr = getKolkataDateString(nowMs);

      if (options.dateFilter === '24h') {
        list = list.filter((b) => isWithinRolling24Hours(b, nowMs));
      } else if (options.dateFilter === 'today') {
        list = list.filter((b) => getKolkataDateString(resolveBillTimestampMs(b)) === todayStr);
      } else if (options.dateFilter === 'yesterday') {
        const yestStr = getKolkataDateString(nowMs - 24 * 60 * 60 * 1000);
        list = list.filter((b) => getKolkataDateString(resolveBillTimestampMs(b)) === yestStr);
      } else if (options.dateFilter === 'this_month') {
        const currentMonth = todayStr.slice(0, 7); // YYYY-MM
        list = list.filter((b) =>
          getKolkataDateString(resolveBillTimestampMs(b)).startsWith(currentMonth)
        );
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(options.dateFilter)) {
        list = list.filter(
          (b) => getKolkataDateString(resolveBillTimestampMs(b)) === options.dateFilter
        );
      }
    }

    // Sort newest first using authoritative timestamp
    list.sort((a, b) => resolveBillTimestampMs(b) - resolveBillTimestampMs(a));

    const total = list.length;
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(200, options.limit || 50));
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    return {
      bills: paginated,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Computes authoritative Business Metrics for Dashboard.
   * Uses a strict 24-hour rolling window [nowMs - 24h, nowMs] based on actual transaction timestamps
   * for `todaySalesRupees` and `todayBillsCount`.
   * Historical records older than 24 hours are NEVER deleted and remain in total/monthly/calendar views.
   */
  public getMetrics(_userId?: string, nowMs: number = Date.now()): BusinessMetrics {
    const list = this.getAllBills();
    return computeBusinessMetricsFromBills(list, nowMs);
  }

  /**
   * Generates comprehensive monthly sales report for any specified Year and Month (1-12)
   * Asia/Kolkata authoritative timezone. Historical data is permanently preserved.
   */
  public getMonthlyReport(year: number, month: number, _userId?: string): MonthlyReportData {
    const list = this.getAllBills();

    const targetYear = Math.max(2020, Math.min(2099, Math.floor(year)));
    const targetMonth = Math.max(1, Math.min(12, Math.floor(month)));
    const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

    const monthLabelDate = new Date(Date.UTC(targetYear, targetMonth - 1, 15));
    const monthLabel = new Intl.DateTimeFormat('en-IN', {
      month: 'long',
      year: 'numeric',
    }).format(monthLabelDate);

    // Filter bills belonging to this specific month in IST
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

    let bestDayObj: { date: string; dayNumber: number; revenueRupees: number; billsCount: number } | null = null;
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

  /**
   * Evaluates and returns all KitchenOrder records (zero financial data).
   * Automatically persists the transition from PREPARING -> LATE once 3 minutes (180,000 ms) have elapsed.
   */
  public getKitchenOrders(nowMs: number = Date.now()): KitchenOrder[] {
    let dirty = false;
    const allBills = this.getAllBills();

    for (const bill of allBills) {
      if (
        bill.orderStatus === 'PREPARING' &&
        bill.orderStartedAt &&
        !bill.orderCompletedAt &&
        nowMs - bill.orderStartedAt >= PREP_TIME_LIMIT_MS
      ) {
        const lateAt = bill.orderLateAt || bill.orderStartedAt + PREP_TIME_LIMIT_MS;
        const updated: Bill = {
          ...bill,
          orderStatus: 'LATE',
          orderLateAt: lateAt,
        };
        this.bills.set(bill.id, updated);
        dirty = true;
      }
    }

    if (dirty) {
      this.flushToDisk();
    }

    return Array.from(this.bills.values())
      .map((b) => billToKitchenOrder(b, nowMs))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Starts preparing a kitchen order (`WAITING` -> `PREPARING`), recording the exact start timestamp.
   * Idempotent: prevents accidental duplicate starts if already started or completed.
   */
  public async startKitchenOrder(
    idOrOrderId: string,
    actorUsername: string,
    nowMs: number = Date.now()
  ): Promise<{ order: KitchenOrder; bill: Bill; alreadyStarted: boolean } | null> {
    const existing = this.getBill(idOrOrderId);
    if (!existing) return null;

    if (
      existing.orderStatus === 'PREPARING' ||
      existing.orderStatus === 'LATE' ||
      existing.orderStatus === 'COMPLETED' ||
      (existing.orderStartedAt && existing.orderStartedAt > 0)
    ) {
      return {
        order: billToKitchenOrder(existing, nowMs),
        bill: existing,
        alreadyStarted: true,
      };
    }

    const updated: Bill = {
      ...existing,
      orderStatus: 'PREPARING',
      orderCreatedAt: existing.orderCreatedAt || existing.timestamp || nowMs,
      orderStartedAt: nowMs,
      startedBy: actorUsername,
    };

    this.bills.set(existing.id, updated);
    this.flushToDisk();

    return {
      order: billToKitchenOrder(updated, nowMs),
      bill: updated,
      alreadyStarted: false,
    };
  }

  /**
   * Completes a kitchen order (`PREPARING`/`LATE`/`WAITING` -> `COMPLETED`), stopping all timers
   * and recording the exact completion timestamp.
   */
  public async completeKitchenOrder(
    idOrOrderId: string,
    actorUsername: string,
    nowMs: number = Date.now()
  ): Promise<{ order: KitchenOrder; bill: Bill; alreadyCompleted: boolean } | null> {
    const existing = this.getBill(idOrOrderId);
    if (!existing) return null;

    if (existing.orderStatus === 'COMPLETED' && existing.orderCompletedAt) {
      return {
        order: billToKitchenOrder(existing, nowMs),
        bill: existing,
        alreadyCompleted: true,
      };
    }

    const startedAt = existing.orderStartedAt || nowMs;
    const elapsedMs = Math.max(0, nowMs - startedAt);
    const wasLate = elapsedMs >= PREP_TIME_LIMIT_MS;

    const updated: Bill = {
      ...existing,
      orderStatus: 'COMPLETED',
      orderCreatedAt: existing.orderCreatedAt || existing.timestamp || nowMs,
      orderStartedAt: startedAt,
      orderLateAt: wasLate
        ? existing.orderLateAt || startedAt + PREP_TIME_LIMIT_MS
        : existing.orderLateAt,
      orderCompletedAt: nowMs,
      completedBy: actorUsername,
    };

    this.bills.set(existing.id, updated);
    this.flushToDisk();

    return {
      order: billToKitchenOrder(updated, nowMs),
      bill: updated,
      alreadyCompleted: false,
    };
  }
}

export const billStorage = new BillStorage();
