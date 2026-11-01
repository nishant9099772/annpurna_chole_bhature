/**
 * Annpurna Chole Bhature - Persistent Storage Layer
 * Thread-safe, disk-backed persistent storage in ./data/bills.json.
 * Survives server restarts, logouts, and reboots.
 * Provides indexed Order ID lookups, multi-attribute filtering, pagination, and real-time business metrics.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Bill, BusinessMetrics, MonthlyReportData, DailySalesData } from '../types/billing';
import { formatCustomerNameWithJi } from '../utils/customerFormat';

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
    return {
      ...b,
      customerName: formatCustomerNameWithJi(b.customerName),
    };
  }

  private init() {
    try {
      // Load from primary data file if present, or fallback to tmp file in serverless environments
      let sourceFile: string | null = null;
      if (fs.existsSync(PRIMARY_BILLS_FILE)) {
        sourceFile = PRIMARY_BILLS_FILE;
      } else if (fs.existsSync(TMP_BILLS_FILE)) {
        sourceFile = TMP_BILLS_FILE;
        this.activeDataDir = TMP_DATA_DIR;
        this.activeBillsFile = TMP_BILLS_FILE;
      }

      let needsNormalizedFlush = false;

      if (sourceFile) {
        const raw = fs.readFileSync(sourceFile, 'utf-8');
        if (raw.trim()) {
          const list: Bill[] = JSON.parse(raw);
          list.forEach((b) => {
            const formattedName = formatCustomerNameWithJi(b.customerName);
            if (formattedName !== b.customerName) {
              needsNormalizedFlush = true;
            }
            this.bills.set(b.id, this.normalizeBillRecord(b));
          });
          this.sequence = list.length + 1;
          console.log(`[Storage] Loaded ${this.bills.size} persistent bills from ${sourceFile}`);
        }
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
    const allBills = Array.from(this.bills.values()).sort((a, b) => b.timestamp - a.timestamp);
    const payload = JSON.stringify(allBills, null, 2);

    try {
      if (!fs.existsSync(this.activeDataDir)) {
        fs.mkdirSync(this.activeDataDir, { recursive: true });
      }
      const tmpFile = `${this.activeBillsFile}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, payload, 'utf-8');
      fs.renameSync(tmpFile, this.activeBillsFile);
    } catch (err: any) {
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
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randPart = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${datePart}-${randPart}`;
  }

  /**
   * Generates a sequential Bill Number (e.g. ACB-20260330-0001)
   */
  public generateBillNumber(): string {
    const now = new Date();
    const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = String(this.sequence++).padStart(4, '0');
    return `ACB-${datePart}-${seq}`;
  }

  /**
   * Saves a new bill permanently
   */
  public async saveBill(bill: Bill): Promise<Bill> {
    const normalized = this.normalizeBillRecord(bill);
    this.bills.set(normalized.id, normalized);
    this.flushToDisk();
    return normalized;
  }

  /**
   * Updates an existing bill (e.g., after Google Sheets retry sync)
   */
  public async updateBill(id: string, updates: Partial<Bill>): Promise<Bill | null> {
    const existing = this.bills.get(id);
    if (!existing) return null;

    const updated: Bill = this.normalizeBillRecord({
      ...existing,
      ...updates,
      id: existing.id, // prevent accidental ID change
    });

    this.bills.set(id, updated);
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
        b.orderId.toUpperCase() === query ||
        b.billNumber.toUpperCase() === query
      ) {
        return b;
      }
    }

    return null;
  }

  /**
   * Merges bills fetched from Google Sheets (or client pending sync queue) idempotently
   * by Order ID / Bill Number / ID so historical data is permanently preserved across serverless cold starts.
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
      } else if (remote.savedToSheets && !existing.savedToSheets) {
        const updated = this.normalizeBillRecord({
          ...existing,
          savedToSheets: true,
          sheetsSyncStatus: 'synced',
          sheetsSyncError: undefined,
          spreadsheetId: remote.spreadsheetId || existing.spreadsheetId,
          spreadsheetUrl: remote.spreadsheetUrl || existing.spreadsheetUrl,
        });
        this.bills.set(existing.id, updated);
        addedOrUpdatedCount++;
      }
    }

    if (addedOrUpdatedCount > 0) {
      this.sequence = Math.max(this.sequence, this.bills.size + 1);
      this.flushToDisk();
    }

    return addedOrUpdatedCount;
  }

  /**
   * Lists and filters bills with pagination
   */
  public listBills(options: {
    search?: string;
    orderType?: string;
    paymentMethod?: string;
    syncStatus?: string;
    dateFilter?: string; // 'all' | 'today' | 'yesterday' | 'this_week' | 'this_month' | 'YYYY-MM-DD'
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
    let list = Array.from(this.bills.values());

    // 1. User isolation (if supplied and not 'admin_all')
    if (options.userId && options.userId !== 'all') {
      list = list.filter((b) => !b.userId || b.userId === options.userId || options.userId === 'admin');
    }

    // 2. Search query (matches Order ID, Bill Number, Customer Name, Mobile Number)
    if (options.search && options.search.trim()) {
      const q = options.search.trim().toLowerCase();
      list = list.filter(
        (b) =>
          b.orderId.toLowerCase().includes(q) ||
          b.billNumber.toLowerCase().includes(q) ||
          b.customerName.toLowerCase().includes(q) ||
          b.mobileNumber.includes(q) ||
          b.id.toLowerCase().includes(q)
      );
    }

    // 3. Order Type filter
    if (options.orderType && options.orderType !== 'all') {
      list = list.filter((b) => b.orderType === options.orderType);
    }

    // 4. Payment Method filter
    if (options.paymentMethod && options.paymentMethod !== 'all') {
      list = list.filter((b) => b.paymentMethod === options.paymentMethod);
    }

    // 5. Sync Status filter
    if (options.syncStatus && options.syncStatus !== 'all') {
      list = list.filter((b) => b.sheetsSyncStatus === options.syncStatus);
    }

    // 6. Date filter (Asia/Kolkata timezone)
    if (options.dateFilter && options.dateFilter !== 'all') {
      const now = new Date();
      // Formatter for Kolkata YYYY-MM-DD
      const kolkataDateStr = (date: Date) => {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(date);
      };

      const todayStr = kolkataDateStr(now);

      if (options.dateFilter === 'today') {
        list = list.filter((b) => kolkataDateStr(new Date(b.timestamp)) === todayStr);
      } else if (options.dateFilter === 'yesterday') {
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const yestStr = kolkataDateStr(yesterday);
        list = list.filter((b) => kolkataDateStr(new Date(b.timestamp)) === yestStr);
      } else if (options.dateFilter === 'this_month') {
        const currentMonth = todayStr.slice(0, 7); // YYYY-MM
        list = list.filter((b) => kolkataDateStr(new Date(b.timestamp)).startsWith(currentMonth));
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(options.dateFilter)) {
        list = list.filter((b) => kolkataDateStr(new Date(b.timestamp)) === options.dateFilter);
      }
    }

    // Sort newest first
    list.sort((a, b) => b.timestamp - a.timestamp);

    const total = list.length;
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 50));
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
   * Computes authoritative Business Metrics for Dashboard
   */
  public getMetrics(userId?: string): BusinessMetrics {
    let list = Array.from(this.bills.values());
    if (userId && userId !== 'all' && userId !== 'admin') {
      list = list.filter((b) => !b.userId || b.userId === userId);
    }

    const now = new Date();
    const kolkataFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayStr = kolkataFormatter.format(now);
    const currentMonthPrefix = todayStr.slice(0, 7);

    let todaySalesPaise = 0;
    let todayBillsCount = 0;
    let monthlySalesPaise = 0;
    let monthlyBillsCount = 0;
    let totalRevenuePaise = 0;
    let syncedBillsCount = 0;
    let failedBillsCount = 0;

    for (const b of list) {
      totalRevenuePaise += b.grandTotalPaise;

      const billDateStr = kolkataFormatter.format(new Date(b.timestamp));
      if (billDateStr === todayStr) {
        todaySalesPaise += b.grandTotalPaise;
        todayBillsCount++;
      }

      if (billDateStr.startsWith(currentMonthPrefix)) {
        monthlySalesPaise += b.grandTotalPaise;
        monthlyBillsCount++;
      }

      if (b.sheetsSyncStatus === 'synced' || b.savedToSheets) {
        syncedBillsCount++;
      } else if (b.sheetsSyncStatus === 'failed') {
        failedBillsCount++;
      }
    }

    const currentMonthName = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      month: 'long',
    }).format(now);
    const currentYear = parseInt(todayStr.slice(0, 4), 10);

    return {
      totalBills: list.length,
      todaySalesRupees: todaySalesPaise / 100,
      todayBillsCount,
      monthlySalesRupees: monthlySalesPaise / 100,
      monthlyBillsCount,
      totalRevenueRupees: totalRevenuePaise / 100,
      syncedBillsCount,
      failedBillsCount,
      currentMonthName,
      currentYear,
    };
  }

  /**
   * Generates comprehensive monthly sales report for any specified Year and Month (1-12)
   * Asia/Kolkata authoritative timezone. Historical data is permanently preserved.
   */
  public getMonthlyReport(year: number, month: number, userId?: string): MonthlyReportData {
    let list = Array.from(this.bills.values());
    if (userId && userId !== 'all' && userId !== 'admin') {
      list = list.filter((b) => !b.userId || b.userId === userId);
    }

    const targetYear = Math.max(2020, Math.min(2099, Math.floor(year)));
    const targetMonth = Math.max(1, Math.min(12, Math.floor(month)));
    const monthPrefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;

    const kolkataFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const monthLabelDate = new Date(Date.UTC(targetYear, targetMonth - 1, 15));
    const monthLabel = new Intl.DateTimeFormat('en-IN', {
      month: 'long',
      year: 'numeric',
    }).format(monthLabelDate);

    // Filter bills belonging to this specific month in IST
    const monthBills = list.filter((b) => {
      const bDateStr = kolkataFormatter.format(new Date(b.timestamp));
      return bDateStr.startsWith(monthPrefix);
    });

    let totalRevenuePaise = 0;
    const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
    const dailyMap = new Map<number, { revenuePaise: number; bills: Bill[] }>();

    for (let day = 1; day <= daysInMonth; day++) {
      dailyMap.set(day, { revenuePaise: 0, bills: [] });
    }

    for (const b of monthBills) {
      totalRevenuePaise += b.grandTotalPaise;
      const bDateStr = kolkataFormatter.format(new Date(b.timestamp));
      const dayNum = parseInt(bDateStr.slice(8, 10), 10);
      const existing = dailyMap.get(dayNum);
      if (existing) {
        existing.revenuePaise += b.grandTotalPaise;
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
        bills: dayInfo.bills.sort((a, b) => b.timestamp - a.timestamp),
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
    const averageBillValueRupees = totalBills > 0 ? Math.round((totalRevenueRupees / totalBills) * 100) / 100 : 0;

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
}

export const billStorage = new BillStorage();
