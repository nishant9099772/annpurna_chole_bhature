/**
 * Annpurna Chole Bhature - Billing & Receipt Types
 * Light mode, English-only concise copy, strict integer paise money representation.
 */

export type MenuItemKey = 'CHOLE_BHATURE' | 'LASSI' | 'CHOLE' | 'BHATURE' | 'COLD_DRINK';

export type OrderType = 'DINE_IN' | 'PACK';

export type PaymentMethod = 'Cash' | 'UPI' | 'Card';

export type SyncStatus = 'synced' | 'syncing' | 'failed' | 'pending';

export interface MenuItemDefinition {
  key: MenuItemKey;
  name: string;
  subtitle: string;
  description: string;
  unitPricePaise: number | null; // null for COLD_DRINK where admin enters MRP
  unitPriceRupees: number | null;
  category: 'plate' | 'beverage' | 'extra';
}

export const OFFICIAL_MENU_ITEMS: Record<MenuItemKey, MenuItemDefinition> = {
  CHOLE_BHATURE: {
    key: 'CHOLE_BHATURE',
    name: 'Chole Bhature',
    subtitle: '2 Bhature + Spiced Chole',
    description: '2 fluffy Bhature served with spiced Punjabi Chole, pickled onions and green chili',
    unitPricePaise: 8000, // ₹80.00
    unitPriceRupees: 80,
    category: 'plate',
  },
  LASSI: {
    key: 'LASSI',
    name: 'Lassi',
    subtitle: 'Sweet Creamy Yogurt Drink',
    description: 'Thick, chilled sweet yogurt lassi topped with cream and cardamom',
    unitPricePaise: 4000, // ₹40.00
    unitPriceRupees: 40,
    category: 'beverage',
  },
  CHOLE: {
    key: 'CHOLE',
    name: 'Chole',
    subtitle: 'Extra Chole Portion',
    description: 'Extra serving of signature Punjabi spiced chickpea curry',
    unitPricePaise: 4000, // ₹40.00
    unitPriceRupees: 40,
    category: 'extra',
  },
  BHATURE: {
    key: 'BHATURE',
    name: 'Bhature',
    subtitle: 'Single Bhatura (1 Piece)',
    description: 'Single extra crispy golden puffed bhatura',
    unitPricePaise: 2500, // ₹25.00
    unitPriceRupees: 25,
    category: 'extra',
  },
  COLD_DRINK: {
    key: 'COLD_DRINK',
    name: 'Cold Drink',
    subtitle: 'Chilled Soft Drink (MRP)',
    description: 'Chilled soft drink (admin enters bottle MRP for this bill)',
    unitPricePaise: null,
    unitPriceRupees: null,
    category: 'beverage',
  },
};

export interface BillItem {
  id: string;
  itemKey: MenuItemKey;
  name: string;
  quantity: number; // positive whole number
  unitPricePaise: number;
  unitPriceRupees: number;
  lineTotalPaise: number;
  lineTotalRupees: number;
}

export interface Bill {
  id: string; // unique internal record ID
  orderId: string; // unique Order ID (e.g. ORD-20260330-9481)
  billNumber: string; // e.g. ACB-20260330-0001
  orderType: OrderType;
  orderTypeLabel: 'Dine In' | 'Pack';
  customerName: string;
  mobileNumber: string; // 10 digits
  countryCode: string; // e.g. +91
  items: BillItem[];
  itemCount: number;
  itemDetailsSummary: string; // e.g. "Chole Bhature (2), Lassi (1)"
  itemPricesSummary: string; // e.g. "Chole Bhature: ₹80, Lassi: ₹40"
  subtotalPaise: number;
  subtotalRupees: number;
  discountPercent: number; // 0 to 100
  discountAmountPaise: number;
  discountAmountRupees: number;
  discountPaise: number; // alias to discountAmountPaise
  discountRupees: number; // alias to discountAmountRupees
  grandTotalPaise: number;
  grandTotalRupees: number;
  paymentMethod: PaymentMethod;
  paymentStatus: 'Paid' | 'Pending';
  billDate: string; // e.g. "30/03/2026"
  billTime: string; // e.g. "02:30 PM"
  dateTimeKolkata: string;
  timestamp: number;
  userId: string; // user / account ID
  savedToSheets: boolean;
  sheetsSyncStatus: SyncStatus;
  sheetsSyncError?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  sheetRowBills?: number;
  pdfUrl?: string;
}

export interface CreateBillRequest {
  orderType: OrderType;
  customerName: string;
  countryCode?: string;
  mobileNumber: string;
  items: Array<{
    itemKey: MenuItemKey;
    quantity: number;
    coldDrinkUnitPriceRupees?: number;
  }>;
  discountPercent?: number; // 0 to 100
  discountRupees?: number; // backward compatibility
  paymentMethod?: PaymentMethod;
  paymentStatus?: 'Paid' | 'Pending';
  userId?: string;
  googleAccessToken?: string;
  customSpreadsheetId?: string;
}

export interface AuthUser {
  username: string;
  token: string;
  role: 'admin';
}

export interface BusinessMetrics {
  totalBills: number;
  todaySalesRupees: number; // Rolling 24-hour sales (₹)
  todayBillsCount: number; // Rolling 24-hour order count
  rolling24hSalesRupees?: number;
  rolling24hBillsCount?: number;
  rolling24hWindowStart?: number;
  rolling24hWindowEnd?: number;
  monthlySalesRupees: number;
  monthlyBillsCount: number;
  totalRevenueRupees: number;
  syncedBillsCount: number;
  failedBillsCount: number;
  currentMonthName: string;
  currentYear: number;
}

export interface DailySalesData {
  date: string; // YYYY-MM-DD
  dayNumber: number; // 1 to 31
  dayName: string; // Mon, Tue, etc.
  revenueRupees: number;
  billsCount: number;
  bills: Bill[];
}

export interface MonthlyReportData {
  year: number;
  month: number; // 1 to 12
  monthLabel: string; // e.g. "March 2026"
  totalRevenueRupees: number;
  totalBills: number;
  averageBillValueRupees: number;
  bestSalesDay: {
    date: string;
    dayNumber: number;
    revenueRupees: number;
    billsCount: number;
  } | null;
  dailyData: DailySalesData[];
}
