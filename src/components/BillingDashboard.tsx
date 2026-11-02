import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  UtensilsCrossed,
  Plus,
  Minus,
  Trash2,
  Receipt,
  User,
  Phone,
  LogOut,
  Sparkles,
  FileSpreadsheet,
  AlertCircle,
  Clock,
  History,
  CheckCircle2,
  RefreshCw,
  Utensils,
  Package,
  TrendingUp,
  DollarSign,
  Calendar,
  Layers,
  CreditCard,
  Banknote,
  Smartphone,
  ExternalLink,
  Search,
} from 'lucide-react';
import {
  Bill,
  MenuItemKey,
  OrderType,
  PaymentMethod,
  OFFICIAL_MENU_ITEMS,
  BusinessMetrics,
} from '../types/billing';
import { googleSignIn } from '../services/firebaseAuth';
import { User as FirebaseUser } from 'firebase/auth';
import { BillHistoryView } from './BillHistoryView';
import { MonthlySalesCalendar } from './MonthlySalesCalendar';
import { BillDetailsModal } from './BillDetailsModal';
import { CopyMobileButton } from './CopyMobileButton';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import { computeBusinessMetricsFromBills } from '../utils/billTimestamp';
import {
  hydrateAndSyncBillsWithServer,
  loadPersistentBills,
  upsertPersistentBill,
} from '../utils/persistentBillsStorage';
import { parseApiJsonResponse } from '../utils/apiClient';

interface BillingDashboardProps {
  adminUsername: string;
  adminToken: string;
  onLogout: () => void;
  onBillCompleted: (bill: Bill) => void;
  onOpen3DModal: () => void;
  googleUser: FirebaseUser | null;
  googleToken: string | null;
  onGoogleAuthChange: (user: FirebaseUser | null, token: string | null) => void;
  onShareWhatsApp: (bill: Bill) => void;
  onPreviewPdf?: (bill: Bill) => void;
  onShowToast?: (message: string) => void;
}

export const BillingDashboard: React.FC<BillingDashboardProps> = ({
  adminUsername,
  adminToken,
  onLogout,
  onBillCompleted,
  onOpen3DModal,
  googleUser,
  googleToken,
  onGoogleAuthChange,
  onShareWhatsApp,
  onPreviewPdf,
  onShowToast,
}) => {
  // Navigation View: 'terminal' (New Bill), 'history' (Bill Records), or 'calendar' (Monthly Sales Calendar)
  const [activeTab, setActiveTab] = useState<'terminal' | 'history' | 'calendar'>('terminal');

  // Business Metrics State — initialized from persistent ledger so stats never reset to 0 on login/refresh
  const [metrics, setMetrics] = useState<BusinessMetrics>(() =>
    computeBusinessMetricsFromBills(loadPersistentBills(), Date.now())
  );

  // Order Type (Required: Dine In vs Pack)
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [orderTypeError, setOrderTypeError] = useState<string | null>(null);

  // Customer Inputs
  const [customerName, setCustomerName] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [mobileNumber, setMobileNumber] = useState('');

  // Payment Method
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');

  // Percentage Discount (0% to 100%)
  const [discountPercentInput, setDiscountPercentInput] = useState<string>('0');
  const [discountError, setDiscountError] = useState<string | null>(null);

  // Custom Spreadsheet ID (persisted in localStorage)
  const [customSpreadsheetId, setCustomSpreadsheetId] = useState<string>(() => {
    return localStorage.getItem('annpurna_custom_sheet_id') || '';
  });
  const [showSheetSettings, setShowSheetSettings] = useState(false);
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const [batchSyncFeedback, setBatchSyncFeedback] = useState<string | null>(null);
  const [serverSheetsStatus, setServerSheetsStatus] = useState<{
    configured: boolean;
    mode: string;
    modeLabel: string;
    spreadsheetId: string;
    spreadsheetUrl: string;
  } | null>(null);

  const isSheetsConnected = Boolean(googleToken || serverSheetsStatus?.configured);

  // Calendar Bill Inspection Modal
  const [calendarSelectedBill, setCalendarSelectedBill] = useState<Bill | null>(null);

  // Field Validation Errors
  const [nameError, setNameError] = useState<string | null>(null);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [coldDrinkError, setColdDrinkError] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // Selected Items in Order
  const [draftItems, setDraftItems] = useState<Record<MenuItemKey, number>>({
    CHOLE_BHATURE: 0,
    LASSI: 0,
    CHOLE: 0,
    BHATURE: 0,
    COLD_DRINK: 0,
  });

  const [coldDrinkMRP, setColdDrinkMRP] = useState<string>('40');

  // Submission & Saving States
  const [isSaving, setIsSaving] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [currentTimeStr, setCurrentTimeStr] = useState('');

  // Fetch & Bidirectionally Hydrate Business Metrics & Server Google Sheets Status
  const refreshMetrics = useCallback(async () => {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${adminToken}`,
      };
      if (googleToken) {
        headers['x-google-token'] = googleToken;
      }

      const [hydratedResult, statusRes] = await Promise.all([
        hydrateAndSyncBillsWithServer(adminToken, googleToken, customSpreadsheetId),
        fetch('/api/sheets/status', { headers }),
      ]);

      if (statusRes.status === 401) {
        onLogout();
        return;
      }

      if (hydratedResult?.metrics) {
        setMetrics(hydratedResult.metrics);
      }

      if (statusRes.ok) {
        const { data: statusData } = await parseApiJsonResponse(statusRes);
        if (statusData) {
          setServerSheetsStatus(statusData);
        }
      }
    } catch (err: any) {
      if (err?.status === 401) {
        onLogout();
        return;
      }
      console.log('Metrics load error:', err);
      // Fallback to persistent local calculation so dashboard never blanks out
      setMetrics(computeBusinessMetricsFromBills(loadPersistentBills(), Date.now()));
    }
  }, [adminToken, googleToken, customSpreadsheetId, onLogout]);

  useEffect(() => {
    refreshMetrics();
  }, [refreshMetrics]);

  // Automatic 24-hour rolling window evaluator:
  // Re-evaluates the 24h rolling window every 15 seconds against actual transaction timestamps
  // so transactions older than 24 hours automatically stop contributing to the 24h dashboard stats,
  // and syncs with the server every 45 seconds.
  useEffect(() => {
    const rollingTick = setInterval(() => {
      const currentPersistent = loadPersistentBills();
      setMetrics(computeBusinessMetricsFromBills(currentPersistent, Date.now()));
    }, 15_000);

    const serverSyncTick = setInterval(() => {
      refreshMetrics();
    }, 45_000);

    return () => {
      clearInterval(rollingTick);
      clearInterval(serverSyncTick);
    };
  }, [refreshMetrics]);

  // Live Asia/Kolkata Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(now);
      setCurrentTimeStr(formatted);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Quick Quantity Helpers
  const updateQuantity = (key: MenuItemKey, delta: number) => {
    setDraftItems((prev) => {
      const current = prev[key] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [key]: next };
    });
    setItemsError(null);
  };

  const setDirectQuantity = (key: MenuItemKey, value: number) => {
    const sanitized = Math.max(0, Math.floor(value));
    setDraftItems((prev) => ({ ...prev, [key]: sanitized }));
    setItemsError(null);
  };

  const clearEntireBill = () => {
    setDraftItems({
      CHOLE_BHATURE: 0,
      LASSI: 0,
      CHOLE: 0,
      BHATURE: 0,
      COLD_DRINK: 0,
    });
    setOrderType(null);
    setCustomerName('');
    setMobileNumber('');
    setDiscountPercentInput('0');
    setPaymentMethod('Cash');
    setOrderTypeError(null);
    setNameError(null);
    setMobileError(null);
    setColdDrinkError(null);
    setItemsError(null);
    setDiscountError(null);
    setSaveErrorMessage(null);
  };

  // Immediate Client-Side Calculations in Integer Paise
  const billSummary = useMemo(() => {
    let subtotalPaise = 0;
    const computedLines: Array<{
      key: MenuItemKey;
      name: string;
      quantity: number;
      unitPricePaise: number;
      unitPriceRupees: number;
      lineTotalPaise: number;
      lineTotalRupees: number;
    }> = [];

    (Object.keys(OFFICIAL_MENU_ITEMS) as MenuItemKey[]).forEach((key) => {
      const qty = draftItems[key] || 0;
      if (qty > 0) {
        let unitPricePaise = 0;

        if (key === 'COLD_DRINK') {
          const parsed = parseFloat(coldDrinkMRP);
          unitPricePaise = !isNaN(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
        } else {
          unitPricePaise = OFFICIAL_MENU_ITEMS[key].unitPricePaise || 0;
        }

        const lineTotalPaise = unitPricePaise * qty;
        subtotalPaise += lineTotalPaise;

        computedLines.push({
          key,
          name: OFFICIAL_MENU_ITEMS[key].name,
          quantity: qty,
          unitPricePaise,
          unitPriceRupees: unitPricePaise / 100,
          lineTotalPaise,
          lineTotalRupees: lineTotalPaise / 100,
        });
      }
    });

    const parsedDiscountPercent = parseFloat(discountPercentInput);
    const validDiscountPercent =
      !isNaN(parsedDiscountPercent) && parsedDiscountPercent >= 0 && parsedDiscountPercent <= 100
        ? Math.min(100, Math.max(0, Math.round(parsedDiscountPercent * 100) / 100))
        : 0;

    const discountAmountPaise = Math.round((subtotalPaise * validDiscountPercent) / 100);
    const grandTotalPaise = Math.max(0, subtotalPaise - discountAmountPaise);
    const totalItemUnits = computedLines.reduce((sum, item) => sum + item.quantity, 0);

    return {
      lines: computedLines,
      subtotalPaise,
      subtotalRupees: subtotalPaise / 100,
      discountPercent: validDiscountPercent,
      discountAmountPaise,
      discountAmountRupees: discountAmountPaise / 100,
      discountPaise: discountAmountPaise,
      discountRupees: discountAmountPaise / 100,
      grandTotalPaise,
      grandTotalRupees: grandTotalPaise / 100,
      totalItemUnits,
    };
  }, [draftItems, coldDrinkMRP, discountPercentInput]);

  // Google Sign In action for Workspace
  const handleGoogleConnect = async () => {
    try {
      const res = await googleSignIn();
      if (res) {
        onGoogleAuthChange(res.user, res.accessToken);
        setSaveErrorMessage(null);
      }
    } catch (err: any) {
      setSaveErrorMessage(`Google Sign-In failed: ${err.message}`);
    }
  };

  // Helper for mobile number formatting & input sanitization
  const handleMobileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value.replace(/\D/g, '');
    if (raw.startsWith('91') && raw.length > 10) {
      raw = raw.slice(2);
    } else if (raw.startsWith('0') && raw.length > 10) {
      raw = raw.slice(1);
    }
    // Limit to 10 digits
    const cleaned = raw.slice(0, 10);
    setMobileNumber(cleaned);
    if (mobileError) setMobileError(null);
  };

  // Helper for discount percentage input (0% to 100%)
  const handleDiscountPercentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '') {
      setDiscountPercentInput('');
      setDiscountError(null);
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      if (num < 0) {
        setDiscountPercentInput('0');
        setDiscountError('Discount cannot be negative');
      } else if (num > 100) {
        setDiscountPercentInput('100');
        setDiscountError('Discount cannot exceed 100%');
      } else {
        setDiscountPercentInput(val);
        setDiscountError(null);
      }
    } else {
      setDiscountPercentInput(val);
    }
  };

  // Batch Sync Handler (supports Server Service Account, Apps Script Web App, or Client OAuth Token)
  const handleBatchSyncSheets = async () => {
    if (!isSheetsConnected) {
      handleGoogleConnect();
      return;
    }
    setIsBatchSyncing(true);
    setBatchSyncFeedback(null);
    try {
      let clientPendingBills: Bill[] = [];
      try {
        const raw = localStorage.getItem('annpurna_pending_sync_bills');
        if (raw) clientPendingBills = JSON.parse(raw);
      } catch {
        // ignore
      }

      const res = await fetch('/api/bills/batch-sync-sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          googleAccessToken: googleToken || undefined,
          customSpreadsheetId: customSpreadsheetId.trim() || undefined,
          clientPendingBills,
        }),
      });
      const { ok, data } = await parseApiJsonResponse(res);
      if (ok && data) {
        if (data.failedCount === 0) {
          localStorage.removeItem('annpurna_pending_sync_bills');
        }
        setBatchSyncFeedback(data.message || 'Batch sync completed successfully.');
        if (onShowToast) onShowToast(data.message || 'Google Sheets synchronized!');
        refreshMetrics();
      } else {
        setBatchSyncFeedback(`Sync error: ${data?.error || 'Could not sync with Google Sheets'}`);
      }
    } catch (err: any) {
      setBatchSyncFeedback(`Batch sync error: ${err.message}`);
    } finally {
      setIsBatchSyncing(false);
    }
  };

  // Validation
  const validateForm = (): boolean => {
    let isValid = true;
    setOrderTypeError(null);
    setNameError(null);
    setMobileError(null);
    setColdDrinkError(null);
    setItemsError(null);
    setDiscountError(null);

    // 1. Order Type is required
    if (!orderType) {
      setOrderTypeError('Select Dine In or Pack');
      isValid = false;
    }

    // 2. Customer Name
    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setNameError('Name required');
      isValid = false;
    } else if (trimmedName.length < 2) {
      setNameError('Min 2 characters');
      isValid = false;
    }

    // 3. Mobile Number - STRICT 10 DIGIT INDIAN NUMBER
    let rawMobile = mobileNumber.trim();
    let cleanMobile = rawMobile.replace(/\D/g, '');
    if (cleanMobile.startsWith('91') && cleanMobile.length === 12) {
      cleanMobile = cleanMobile.slice(2);
    } else if (cleanMobile.startsWith('0') && cleanMobile.length === 11) {
      cleanMobile = cleanMobile.slice(1);
    }

    if (!cleanMobile) {
      setMobileError('Customer mobile number is required.');
      isValid = false;
    } else if (cleanMobile.length < 10) {
      setMobileError('Please enter a valid 10-digit mobile number.');
      isValid = false;
    } else if (cleanMobile.length > 10) {
      setMobileError('Mobile number cannot exceed 10 digits.');
      isValid = false;
    }

    // 4. Discount Percentage Validation
    const parsedPct = parseFloat(discountPercentInput);
    if (!isNaN(parsedPct)) {
      if (parsedPct < 0 || parsedPct > 100) {
        setDiscountError('Discount must be between 0% and 100%');
        isValid = false;
      }
    }

    // 5. Menu Items
    if (billSummary.lines.length === 0) {
      setItemsError('Add at least 1 item');
      isValid = false;
    }

    // 6. Cold Drink MRP if selected
    if (draftItems.COLD_DRINK > 0) {
      const parsedMRP = parseFloat(coldDrinkMRP);
      if (isNaN(parsedMRP) || parsedMRP <= 0) {
        setColdDrinkError('Valid MRP required');
        isValid = false;
      }
    }

    return isValid;
  };

  // Submit and Save Bill
  const handleSaveBill = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    setSaveErrorMessage(null);

    try {
      let rawMobile = mobileNumber.trim();
      let cleanMobile = rawMobile.replace(/\D/g, '');
      if (cleanMobile.startsWith('91') && cleanMobile.length === 12) {
        cleanMobile = cleanMobile.slice(2);
      } else if (cleanMobile.startsWith('0') && cleanMobile.length === 11) {
        cleanMobile = cleanMobile.slice(1);
      }

      const itemsPayload = billSummary.lines.map((line) => ({
        itemKey: line.key,
        quantity: line.quantity,
        coldDrinkUnitPriceRupees: line.key === 'COLD_DRINK' ? parseFloat(coldDrinkMRP) : undefined,
      }));

      const formattedCustomerName = formatCustomerNameWithJi(customerName);
      setCustomerName(formattedCustomerName);

      const payload = {
        orderType,
        customerName: formattedCustomerName,
        countryCode: countryCode.trim(),
        mobileNumber: cleanMobile,
        items: itemsPayload,
        discountPercent: billSummary.discountPercent,
        discountRupees: billSummary.discountAmountRupees,
        paymentMethod,
        paymentStatus: 'Paid',
        userId: googleUser?.email || adminUsername,
        googleAccessToken: googleToken || undefined,
        customSpreadsheetId: customSpreadsheetId.trim() || undefined,
      };

      const response = await fetch('/api/bills', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        onLogout();
        throw new Error('Your session has expired. Please log in again.');
      }

      const { ok, status, data } = await parseApiJsonResponse<any>(response);

      if (!ok) {
        throw new Error(data?.error || `Save failed (HTTP ${status}). The bill draft has been kept.`);
      }

      if (!data || (!data.bill && !data.id)) {
        throw new Error(
          data?.error || 'Save response did not include authoritative bill details. The bill draft has been kept.'
        );
      }

      const authoritativeBill: Bill = data.bill || {
        id: data.id,
        orderId: data.orderId,
        billNumber: data.billNumber,
        orderType: data.orderType,
        orderTypeLabel: data.orderTypeLabel,
        customerName: data.customerName,
        mobileNumber: data.mobileNumber,
        countryCode: data.countryCode,
        items: data.items,
        itemCount: billSummary.totalItemUnits,
        itemDetailsSummary: billSummary.lines.map((i) => `${i.name} (${i.quantity})`).join(', '),
        itemPricesSummary: billSummary.lines.map((i) => `${i.name}: Rs ${i.unitPriceRupees}`).join(', '),
        subtotalPaise: billSummary.subtotalPaise,
        subtotalRupees: billSummary.subtotalRupees,
        discountPaise: billSummary.discountPaise,
        discountRupees: billSummary.discountRupees,
        grandTotalPaise: data.grandTotalPaise || billSummary.grandTotalPaise,
        grandTotalRupees: data.grandTotalRupees || billSummary.grandTotalRupees,
        paymentMethod: data.paymentMethod || paymentMethod,
        dateTimeKolkata: data.dateTimeKolkata,
        timestamp: data.timestamp || Date.now(),
        userId: data.userId || 'admin',
        savedToSheets: data.savedToSheets,
        sheetsSyncStatus: data.sheetsSyncStatus || (data.savedToSheets ? 'synced' : 'failed'),
        spreadsheetId: data.spreadsheetId,
        spreadsheetUrl: data.spreadsheetUrl,
      };

      // Immediately persist the completed bill into the permanent ledger and update 24h rolling metrics
      const updatedPersistent = upsertPersistentBill(authoritativeBill);
      setMetrics(computeBusinessMetricsFromBills(updatedPersistent, Date.now()));

      // Reset local billing inputs
      clearEntireBill();
      refreshMetrics();

      // Trigger success modal
      onBillCompleted(authoritativeBill);
    } catch (err: any) {
      console.error('Save bill failed:', err);
      setSaveErrorMessage(err.message || 'An error occurred while saving the bill.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800">
      {/* SaaS Top Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black shadow-sm">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-slate-900 tracking-tight text-base sm:text-lg">
                  Annpurna Chole Bhature
                </h1>
                <span className="hidden sm:inline-block text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  Billing Suite
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium hidden sm:block">
                Admin POS • Google Sheets Sync • WhatsApp Receipts
              </p>
            </div>
          </div>

          {/* Navigation View Switcher (New Bill vs History vs Sales Calendar) */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setActiveTab('terminal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'terminal'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>New Bill</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Bill History</span>
              {metrics.totalBills > 0 && (
                <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                  {metrics.totalBills}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'calendar'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
              <span>Sales Calendar</span>
            </button>
          </div>

          {/* Right Header Controls (Clock, Google Sheets connection, 3D Dish, Logout) */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Live Kolkata Clock */}
            <div className="hidden lg:flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs text-slate-600 font-mono">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>{currentTimeStr} IST</span>
            </div>

            {/* Google Sheets Connection Status */}
            {isSheetsConnected ? (
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-xl text-xs text-emerald-800">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-semibold hidden md:inline">Sheets Connected</span>
              </div>
            ) : (
              <button
                onClick={handleGoogleConnect}
                className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-semibold px-2.5 py-1.5 rounded-xl text-xs transition cursor-pointer"
                title="Connect Google Sheets"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
                <span className="hidden sm:inline">Connect Sheets</span>
              </button>
            )}

            {/* 3D Thali Preview */}
            <button
              onClick={onOpen3DModal}
              className="p-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition cursor-pointer"
              title="Interactive 3D Dish View"
            >
              <Sparkles className="w-4 h-4 text-amber-500" />
            </button>

            {/* Admin Logout */}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition cursor-pointer"
              title={`Logout (${adminUsername})`}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex-1 w-full space-y-5">
        {/* Google Sheets Synchronization Status Banner */}
        <div
          className={`p-3.5 sm:p-4 rounded-2xl border text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3 ${
            isSheetsConnected
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
              : 'bg-amber-50/80 border-amber-200 text-amber-950'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isSheetsConnected
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-extrabold text-sm">
                  {isSheetsConnected
                    ? 'Google Sheets Auto-Sync Active'
                    : 'Local Database Mode (Google Sheets Sync Pending)'}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isSheetsConnected
                      ? 'bg-emerald-200/80 text-emerald-800'
                      : 'bg-amber-200/80 text-amber-800'
                  }`}
                >
                  {serverSheetsStatus?.configured
                    ? serverSheetsStatus.modeLabel
                    : googleToken
                    ? 'Google Workspace Connected'
                    : 'Offline Queue Active'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-0.5">
                {isSheetsConnected
                  ? `Every bill is verified and recorded in your Google Sheet across all required columns (${metrics.syncedBillsCount} bills synced).`
                  : 'Bills are saved locally and queued safely. Connect your Google Account or configure Service Account environment variables in Netlify for automatic Google Sheets recording.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
            {metrics.failedBillsCount > 0 && isSheetsConnected && (
              <button
                type="button"
                onClick={handleBatchSyncSheets}
                disabled={isBatchSyncing}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-xs transition flex items-center gap-1.5 cursor-pointer text-xs disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isBatchSyncing ? 'animate-spin' : ''}`} />
                <span>Sync {metrics.failedBillsCount} Pending Bills</span>
              </button>
            )}
            {!isSheetsConnected && (
              <button
                type="button"
                onClick={handleGoogleConnect}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-xs transition flex items-center gap-1.5 cursor-pointer text-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Connect Google Account</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSheetSettings(!showSheetSettings)}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold rounded-lg transition text-xs cursor-pointer"
            >
              {showSheetSettings ? 'Hide Settings' : 'Sheet Settings'}
            </button>
          </div>
        </div>

        {/* Collapsible Custom Sheet ID Settings */}
        {showSheetSettings && (
          <div className="bg-white p-4 rounded-2xl border border-slate-200 text-xs space-y-2">
            <h4 className="font-bold text-slate-900">Custom Google Sheet Configuration</h4>
            <p className="text-slate-500">
              By default, bills are saved to a dedicated Google Sheet named &quot;Annpurna Chole Bhature - Billing Records&quot;.
              You can also specify a custom Spreadsheet ID or full Google Sheets URL below:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customSpreadsheetId}
                onChange={(e) => {
                  setCustomSpreadsheetId(e.target.value);
                  localStorage.setItem('annpurna_custom_sheet_id', e.target.value);
                }}
                placeholder="Paste Spreadsheet ID or full Google Sheet URL..."
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleBatchSyncSheets}
                disabled={isBatchSyncing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs disabled:opacity-50 transition"
              >
                Save &amp; Sync
              </button>
            </div>
            {batchSyncFeedback && (
              <p className="text-xs font-semibold text-blue-700 mt-1">{batchSyncFeedback}</p>
            )}
          </div>
        )}

        {/* SaaS Metrics Dashboard Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Rolling 24-Hour Sales */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  24-Hour Sales
                </p>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                  Rolling 24h
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 font-mono mt-1">
                ₹{metrics.todaySalesRupees.toFixed(2)}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {metrics.todayBillsCount} {metrics.todayBillsCount === 1 ? 'bill' : 'bills'} in last 24h
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>

          {/* Card 2: Monthly Sales */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {metrics.currentMonthName || 'Monthly'} Sales
              </p>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 font-mono mt-1">
                ₹{metrics.monthlySalesRupees.toFixed(2)}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {metrics.monthlyBillsCount} bills this month
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Calendar className="w-5 h-5" />
            </div>
          </div>

          {/* Card 3: Total Bills */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Bills</p>
              <h3 className="text-xl sm:text-2xl font-black text-slate-900 font-mono mt-1">
                {metrics.totalBills}
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                All time recorded
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
          </div>

          {/* Card 4: Total Revenue & Sync Status */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Revenue</p>
              <h3 className="text-xl sm:text-2xl font-black text-blue-700 font-mono mt-1">
                ₹{metrics.totalRevenueRupees.toFixed(2)}
              </h3>
              <p className="text-[11px] text-emerald-600 font-medium mt-0.5 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 inline" />
                <span>{metrics.syncedBillsCount} synced</span>
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* View Switch: New Bill Terminal vs Bill History vs Monthly Calendar */}
        {activeTab === 'calendar' ? (
          <MonthlySalesCalendar
            adminToken={adminToken}
            onSelectBill={(b) => setCalendarSelectedBill(b)}
            onShareWhatsApp={onShareWhatsApp}
            onPreviewPdf={(b) => (onPreviewPdf ? onPreviewPdf(b) : onBillCompleted(b))}
          />
        ) : activeTab === 'history' ? (
          <BillHistoryView
            adminToken={adminToken}
            googleToken={googleToken}
            onShareWhatsApp={onShareWhatsApp}
            onRefreshMetrics={refreshMetrics}
          />
        ) : (
          /* Billing Terminal: 2 Column Layout (Left: Items & Customer, Right: Bill Summary & Checkout) */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Column (8 cols): Order Type, Customer Details & Menu Items */}
            <div className="lg:col-span-7 space-y-4">
              {/* Order Type & Customer Details Card */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
                {/* 1. Order Type Selection (Required) */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <span>Order Type</span>
                      <span className="text-rose-500">*</span>
                    </label>
                    {orderTypeError && (
                      <span className="text-xs text-rose-600 font-semibold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{orderTypeError}</span>
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setOrderType('DINE_IN');
                        setOrderTypeError(null);
                      }}
                      className={`py-3 px-4 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                        orderType === 'DINE_IN'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Utensils className="w-4 h-4" />
                      <span>Dine In</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setOrderType('PACK');
                        setOrderTypeError(null);
                      }}
                      className={`py-3 px-4 rounded-xl border text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                        orderType === 'PACK'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Package className="w-4 h-4" />
                      <span>Pack (Takeaway)</span>
                    </button>
                  </div>
                </div>

                {/* 2. Customer Name & Mobile */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Customer Name */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Customer Name <span className="text-rose-500">*</span>
                      </label>
                      <span className="text-[10px] font-semibold text-blue-600">
                        Auto-adds &ldquo;Ji&rdquo;
                      </span>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <User className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        value={customerName}
                        onChange={(e) => {
                          setCustomerName(e.target.value);
                          if (nameError) setNameError(null);
                        }}
                        onBlur={() => {
                          if (customerName.trim().length >= 2) {
                            setCustomerName(formatCustomerNameWithJi(customerName));
                          }
                        }}
                        placeholder="e.g. Rahul → Rahul Ji"
                        className={`w-full pl-9 pr-3 py-2 bg-slate-50 border rounded-xl text-sm font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                          nameError ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                        }`}
                      />
                    </div>
                    {nameError && <p className="text-[11px] text-rose-600 mt-1 font-semibold">{nameError}</p>}
                  </div>

                  {/* Customer Mobile */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Mobile Number <span className="text-rose-500">*</span>
                      </label>
                      {mobileNumber.length > 0 && (
                        <CopyMobileButton
                          countryCode={countryCode}
                          mobileNumber={mobileNumber}
                          onCopied={onShowToast}
                        />
                      )}
                    </div>
                    <div className="flex">
                      <span className="inline-flex items-center px-2.5 py-2 rounded-l-xl border border-r-0 border-slate-200 bg-slate-100 text-slate-600 font-mono text-xs font-bold">
                        {countryCode}
                      </span>
                      <div className="relative flex-1">
                        <input
                          type="tel"
                          value={mobileNumber}
                          onChange={handleMobileChange}
                          placeholder="9876543210 (10 digits)"
                          maxLength={10}
                          className={`w-full px-3 py-2 bg-slate-50 border rounded-r-xl text-sm font-mono font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                            mobileError ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                          }`}
                        />
                      </div>
                    </div>
                    {mobileError && <p className="text-[11px] text-rose-600 mt-1 font-semibold">{mobileError}</p>}
                  </div>
                </div>
              </div>

              {/* Menu Items Card (Single-Row Compact Steppers) */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <UtensilsCrossed className="w-4 h-4 text-blue-600" />
                    <span>Menu Items</span>
                  </h3>
                  {itemsError && (
                    <span className="text-xs text-rose-600 font-semibold">{itemsError}</span>
                  )}
                </div>

                <div className="divide-y divide-slate-100">
                  {/* Chole Bhature - ₹80 */}
                  <div className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 text-sm">Chole Bhature</h4>
                        <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                          ₹80
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">2 Bhature + Spiced Chole</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQuantity('CHOLE_BHATURE', -1)}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={draftItems.CHOLE_BHATURE}
                        onChange={(e) => setDirectQuantity('CHOLE_BHATURE', Number(e.target.value))}
                        className="w-12 h-8 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity('CHOLE_BHATURE', 1)}
                        className="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Lassi - ₹40 */}
                  <div className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 text-sm">Lassi</h4>
                        <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                          ₹40
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">Sweet Creamy Yogurt Drink</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQuantity('LASSI', -1)}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={draftItems.LASSI}
                        onChange={(e) => setDirectQuantity('LASSI', Number(e.target.value))}
                        className="w-12 h-8 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity('LASSI', 1)}
                        className="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Chole (Extra) - ₹40 */}
                  <div className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 text-sm">Chole</h4>
                        <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                          ₹40
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">Extra Chole Portion</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQuantity('CHOLE', -1)}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={draftItems.CHOLE}
                        onChange={(e) => setDirectQuantity('CHOLE', Number(e.target.value))}
                        className="w-12 h-8 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity('CHOLE', 1)}
                        className="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Bhature (Single) - ₹25 */}
                  <div className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 text-sm">Bhature</h4>
                        <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                          ₹25
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">Single Bhatura (1 Piece)</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQuantity('BHATURE', -1)}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={draftItems.BHATURE}
                        onChange={(e) => setDirectQuantity('BHATURE', Number(e.target.value))}
                        className="w-12 h-8 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity('BHATURE', 1)}
                        className="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Cold Drink - Admin MRP Input */}
                  <div className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 text-sm">Cold Drink</h4>
                        <span className="text-[11px] font-semibold text-slate-500">MRP:</span>
                        <div className="relative w-16">
                          <span className="absolute inset-y-0 left-1.5 flex items-center text-xs text-slate-400">₹</span>
                          <input
                            type="number"
                            min="1"
                            value={coldDrinkMRP}
                            onChange={(e) => setColdDrinkMRP(e.target.value)}
                            className="w-full pl-4 pr-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono font-bold"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 truncate">Chilled Soft Drink bottle</p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateQuantity('COLD_DRINK', -1)}
                        className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="0"
                        value={draftItems.COLD_DRINK}
                        onChange={(e) => setDirectQuantity('COLD_DRINK', Number(e.target.value))}
                        className="w-12 h-8 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity('COLD_DRINK', 1)}
                        className="w-8 h-8 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center transition cursor-pointer font-bold"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column (5 cols): Bill Summary, Discount, Payment & Save */}
            <div className="lg:col-span-5 space-y-4">
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-blue-600" />
                    <span>Bill Summary</span>
                  </h3>

                  {billSummary.lines.length > 0 && (
                    <button
                      onClick={clearEntireBill}
                      className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>

                {/* Items Breakdown */}
                {billSummary.lines.length === 0 ? (
                  <div className="py-6 text-center text-slate-400">
                    <UtensilsCrossed className="w-8 h-8 mx-auto text-slate-200 mb-1" />
                    <p className="text-xs">No items added yet</p>
                    <p className="text-[11px] text-slate-300">Tap + to add items from the menu</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {billSummary.lines.map((line) => (
                      <div key={line.key} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{line.name}</span>
                          <span className="font-mono text-slate-400">x{line.quantity}</span>
                        </div>
                        <span className="font-mono font-bold text-slate-900">
                          ₹{line.lineTotalRupees.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Payment Method Selector */}
                <div className="pt-2 border-t border-slate-100">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['Cash', 'UPI', 'Card'] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPaymentMethod(m)}
                        className={`py-2 px-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                          paymentMethod === m
                            ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {m === 'Cash' && <Banknote className="w-3.5 h-3.5 text-emerald-600" />}
                        {m === 'UPI' && <Smartphone className="w-3.5 h-3.5 text-blue-600" />}
                        {m === 'Card' && <CreditCard className="w-3.5 h-3.5 text-purple-600" />}
                        <span>{m}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Discount Percentage Input */}
                <div className="pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Discount (%)
                    </label>
                    <div className="flex items-center gap-1">
                      {['0', '5', '10', '15', '20'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            setDiscountPercentInput(preset);
                            setDiscountError(null);
                          }}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition cursor-pointer ${
                            discountPercentInput === preset
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {preset}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={discountPercentInput}
                      onChange={handleDiscountPercentChange}
                      placeholder="0"
                      className={`w-full pl-3 pr-8 py-1.5 bg-slate-50 border rounded-xl text-sm font-mono font-bold focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                        discountError ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                      }`}
                    />
                    <span className="absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-500">%</span>
                  </div>
                  {discountError && (
                    <p className="text-[11px] text-rose-600 font-semibold mt-1">{discountError}</p>
                  )}
                </div>

                {/* Totals Box: Subtotal, Discount %, Discount Amount (Rs), Final Payable Amount */}
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span className="font-medium">Subtotal:</span>
                    <span className="font-mono font-bold">₹{billSummary.subtotalRupees.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between text-slate-600">
                    <span className="font-medium">Discount Percentage:</span>
                    <span className="font-mono font-bold text-slate-800">{billSummary.discountPercent}%</span>
                  </div>

                  {billSummary.discountAmountRupees > 0 && (
                    <div className="flex justify-between text-rose-600 font-semibold">
                      <span>Discount Amount:</span>
                      <span className="font-mono">- ₹{billSummary.discountAmountRupees.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-base">
                    <div>
                      <span className="font-extrabold text-slate-900 block leading-tight">Final Amount:</span>
                      <span className="text-[10px] text-slate-400 font-normal">Payable by customer</span>
                    </div>
                    <span className="font-mono font-black text-blue-700 text-xl">
                      ₹{billSummary.grandTotalRupees.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Save Error Message */}
                {saveErrorMessage && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{saveErrorMessage}</span>
                  </div>
                )}

                {/* Primary Action Button: Save & Generate Bill */}
                <button
                  type="button"
                  onClick={handleSaveBill}
                  disabled={isSaving}
                  className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white font-extrabold rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving to Sheets & Database...</span>
                    </>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4" />
                      <span>Generate & Save Bill</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Inspection for Bill clicked from Monthly Sales Calendar */}
        {calendarSelectedBill && (
          <BillDetailsModal
            bill={calendarSelectedBill}
            onClose={() => setCalendarSelectedBill(null)}
            onShareWhatsApp={onShareWhatsApp}
            onPreviewPdf={onPreviewPdf ? () => onPreviewPdf(calendarSelectedBill) : undefined}
          />
        )}
      </main>
    </div>
  );
};
