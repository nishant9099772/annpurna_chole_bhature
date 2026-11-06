import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  UtensilsCrossed,
  Plus,
  Minus,
  Trash2,
  Receipt,
  User,
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
  CreditCard,
  Banknote,
  Smartphone,
  Server,
  Settings2,
  ChefHat,
  KeyRound,
  MessageSquarePlus,
  ShieldAlert,
} from 'lucide-react';
import {
  Bill,
  MenuItemKey,
  OrderType,
  PaymentMethod,
  OFFICIAL_MENU_ITEMS,
  BusinessMetrics,
  ResetSalesAuditEntry,
  UserRole,
} from '../types/billing';
import { googleSignIn } from '../services/firebaseAuth';
import { User as FirebaseUser } from 'firebase/auth';
import { BillHistoryView } from './BillHistoryView';
import { MonthlySalesCalendar } from './MonthlySalesCalendar';
import { BillDetailsModal } from './BillDetailsModal';
import { CopyMobileButton } from './CopyMobileButton';
import { OrderDashboard } from './OrderDashboard';
import { LiveOrderStatusPanel } from './LiveOrderStatusPanel';
import { ResetSalesModal } from './ResetSalesModal';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import { computeBusinessMetricsFromBills } from '../utils/billTimestamp';
import {
  hydrateAndSyncBillsWithServer,
  loadPersistentBills,
  upsertPersistentBill,
} from '../utils/persistentBillsStorage';
import {
  apiFetch,
  parseApiJsonResponse,
  getConfiguredApiBaseUrl,
  setConfiguredApiBaseUrl,
  verifyNetlifyBackendUrl,
  isCapacitorOrAndroidWebView,
} from '../utils/apiClient';

/**
 * Isolated memoized IST Clock component so 1-second ticks never re-render BillingDashboard.
 */
const LiveIstClock: React.FC = React.memo(() => {
  const [timeStr, setTimeStr] = useState<string>(() =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date())
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setTimeStr(
        new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(new Date())
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hidden lg:flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 font-mono">
      <Clock className="w-3.5 h-3.5 text-blue-600 shrink-0" />
      <span>{timeStr} IST</span>
    </div>
  );
});
LiveIstClock.displayName = 'LiveIstClock';

interface BillingDashboardProps {
  adminUsername: string;
  adminToken: string;
  userRole?: UserRole;
  sessionExpiresAt?: number | null;
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
  userRole = 'admin',
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
  const isAdmin = userRole === 'admin';

  // Navigation View: 'terminal' (New Bill), 'history' (Bill Records), 'orders' (Kitchen Orders / Live Status), or 'calendar' (Admin Monthly Sales Calendar)
  const [activeTab, setActiveTab] = useState<'terminal' | 'history' | 'orders' | 'calendar'>(
    'terminal'
  );

  // Business Metrics State — initialized from persistent ledger so stats never reset to 0 on login/refresh
  const [metrics, setMetrics] = useState<BusinessMetrics>(() =>
    computeBusinessMetricsFromBills(loadPersistentBills(), Date.now())
  );

  // Order Type (Required: Dine In vs Pack)
  const [orderType, setOrderType] = useState<OrderType | null>(null);
  const [orderTypeError, setOrderTypeError] = useState<string | null>(null);

  // Customer Inputs
  const [customerName, setCustomerName] = useState('');
  const [countryCode] = useState('+91');
  const [mobileNumber, setMobileNumber] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');

  // Payment Method
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');

  // Percentage Discount (0% to 100%)
  const [discountPercentInput, setDiscountPercentInput] = useState<string>('0');
  const [discountError, setDiscountError] = useState<string | null>(null);

  // Custom Spreadsheet ID & Netlify Backend URL (persisted in localStorage, Admin Only)
  const isNativeApk = useMemo(() => isCapacitorOrAndroidWebView(), []);
  const [backendUrlInput, setBackendUrlInput] = useState<string>(() => getConfiguredApiBaseUrl());
  const [isTestingBackend, setIsTestingBackend] = useState(false);

  const [customSpreadsheetId, setCustomSpreadsheetId] = useState<string>(() => {
    return localStorage.getItem('annpurna_custom_sheet_id') || '';
  });
  const [showSheetSettings, setShowSheetSettings] = useState<boolean>(
    () => isAdmin && isCapacitorOrAndroidWebView() && !getConfiguredApiBaseUrl()
  );
  const [isBatchSyncing, setIsBatchSyncing] = useState(false);
  const [batchSyncFeedback, setBatchSyncFeedback] = useState<string | null>(null);
  const [serverSheetsStatus, setServerSheetsStatus] = useState<{
    configured: boolean;
    mode: string;
    modeLabel: string;
    spreadsheetId: string;
    spreadsheetUrl: string;
    requiresBackendUrl?: boolean;
  } | null>(null);

  // Admin Password Change Form State
  const [pwdTargetRole, setPwdTargetRole] = useState<UserRole>('admin');
  const [pwdCurrentAdmin, setPwdCurrentAdmin] = useState('');
  const [pwdNewValue, setPwdNewValue] = useState('');
  const [isChangingPwd, setIsChangingPwd] = useState(false);
  const [pwdFeedback, setPwdFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Admin Reset Sales Data Modal State & Reset Epoch (forces immediate child view refresh after reset)
  const [isResetSalesModalOpen, setIsResetSalesModalOpen] = useState(false);
  const [resetEpoch, setResetEpoch] = useState(0);

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

  // Stable Idempotency Key per bill draft (prevents duplicate bills/orders on double tap or network retry)
  const [draftIdempotencyKey, setDraftIdempotencyKey] = useState<string>(
    () => `IDEMP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );

  // Submission & Saving States
  const [isSaving, setIsSaving] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean>(true);

  // Fetch & Bidirectionally Hydrate Business Metrics & Server Google Sheets Status
  const refreshMetrics = useCallback(
    async (forceHydrate: boolean = false) => {
      const currentToken = adminToken;
      if (!currentToken) return;
      try {
        if (!isAdmin) {
          await hydrateAndSyncBillsWithServer(currentToken, null, undefined, forceHydrate);
          setIsBackendOnline(true);
          return;
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${currentToken}`,
        };
        if (googleToken) {
          headers['x-google-token'] = googleToken;
        }

        const sheetQuery = customSpreadsheetId.trim()
          ? `?sheetId=${encodeURIComponent(customSpreadsheetId.trim())}`
          : '';

        const [hydratedResult, statusRes] = await Promise.all([
          hydrateAndSyncBillsWithServer(
            currentToken,
            googleToken,
            customSpreadsheetId,
            forceHydrate
          ),
          apiFetch(`/api/sheets/status${sheetQuery}`, { headers }),
        ]);

        if (statusRes.status === 401) {
          onLogout();
          return;
        }

        if (hydratedResult?.metrics) {
          setMetrics(hydratedResult.metrics);
        }

        if (statusRes.ok) {
          setIsBackendOnline(true);
          const { data: statusData } = await parseApiJsonResponse(statusRes);
          if (statusData) {
            setServerSheetsStatus(statusData);
          }
        }
      } catch (err: any) {
        if (err?.status === 401 && (!err.token || err.token === currentToken)) {
          onLogout();
          return;
        }
        setIsBackendOnline(false);
        if (isAdmin) {
          setMetrics(computeBusinessMetricsFromBills(loadPersistentBills(), Date.now()));
        }
      }
    },
    [adminToken, googleToken, customSpreadsheetId, isAdmin, onLogout]
  );

  useEffect(() => {
    refreshMetrics(false);
  }, [refreshMetrics]);

  // Automatic 24-hour rolling window evaluator (Admin Only)
  useEffect(() => {
    if (!isAdmin) return;
    const rollingTick = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const currentPersistent = loadPersistentBills();
      setMetrics(computeBusinessMetricsFromBills(currentPersistent, Date.now()));
    }, 15_000);

    const serverSyncTick = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refreshMetrics(false);
    }, 45_000);

    return () => {
      clearInterval(rollingTick);
      clearInterval(serverSyncTick);
    };
  }, [isAdmin, refreshMetrics]);

  // Quick Quantity Helpers
  const updateQuantity = useCallback((key: MenuItemKey, delta: number) => {
    setDraftItems((prev) => {
      const current = prev[key] || 0;
      const next = Math.max(0, current + delta);
      return { ...prev, [key]: next };
    });
    setItemsError(null);
  }, []);

  const setDirectQuantity = useCallback((key: MenuItemKey, value: number) => {
    const sanitized = Math.max(0, Math.floor(value));
    setDraftItems((prev) => ({ ...prev, [key]: sanitized }));
    setItemsError(null);
  }, []);

  const clearEntireBill = useCallback(() => {
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
    setSpecialInstructions('');
    setDiscountPercentInput('0');
    setPaymentMethod('Cash');
    setOrderTypeError(null);
    setNameError(null);
    setMobileError(null);
    setColdDrinkError(null);
    setItemsError(null);
    setDiscountError(null);
    setSaveErrorMessage(null);
    setDraftIdempotencyKey(`IDEMP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }, []);

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

  // Save & Verify Netlify Backend URL for Android APK -> Netlify Backend -> Google Sheets
  const handleSaveBackendUrl = async () => {
    const trimmed = backendUrlInput.trim();
    if (!trimmed) {
      setConfiguredApiBaseUrl('');
      setBackendUrlInput('');
      setBatchSyncFeedback('Cleared custom Netlify Backend URL.');
      await refreshMetrics(true);
      return;
    }

    setIsTestingBackend(true);
    setBatchSyncFeedback(null);
    try {
      const check = await verifyNetlifyBackendUrl(trimmed);
      const savedUrl = setConfiguredApiBaseUrl(check.normalizedUrl || trimmed);
      setBackendUrlInput(savedUrl);

      if (check.reachable) {
        setBatchSyncFeedback(
          `Connected to Netlify Backend (${savedUrl})! Refreshing Google Sheets status...`
        );
        if (onShowToast) {
          onShowToast(`Connected to Netlify Server (${savedUrl})`);
        }
        await refreshMetrics(true);
      } else {
        setBatchSyncFeedback(
          check.error || `Saved ${savedUrl}, but could not verify /api/health.`
        );
      }
    } finally {
      setIsTestingBackend(false);
    }
  };

  // Admin Password Change Handler
  const handleAdminChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setPwdFeedback(null);

    if (!pwdCurrentAdmin || !pwdNewValue || pwdNewValue.trim().length < 6) {
      setPwdFeedback({
        ok: false,
        msg: 'Enter your current Admin password and a new password (min 6 characters).',
      });
      return;
    }

    setIsChangingPwd(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          targetRole: pwdTargetRole,
          currentPassword: pwdCurrentAdmin,
          newPassword: pwdNewValue.trim(),
        }),
      });

      const { ok, data } = await parseApiJsonResponse<{
        success?: boolean;
        message?: string;
        error?: string;
      }>(res);

      if (!ok || !data?.success) {
        throw new Error(data?.error || 'Could not update password');
      }

      setPwdCurrentAdmin('');
      setPwdNewValue('');
      setPwdFeedback({
        ok: true,
        msg: data.message || 'Password updated successfully!',
      });
      if (onShowToast) {
        onShowToast(data.message || 'Password updated!');
      }
    } catch (err: any) {
      setPwdFeedback({
        ok: false,
        msg: err?.message || 'Failed to update password.',
      });
    } finally {
      setIsChangingPwd(false);
    }
  };

  // Google Sign In action (Admin Only)
  const handleGoogleConnect = async () => {
    if (!isAdmin) return;
    if (isNativeApk && !getConfiguredApiBaseUrl()) {
      setShowSheetSettings(true);
      setBatchSyncFeedback(
        'In the Android APK, enter your deployed Netlify HTTPS URL below to connect to Google Sheets via your Netlify backend.'
      );
      if (onShowToast) {
        onShowToast('Enter your Netlify Backend URL in Settings to enable Google Sheets sync.');
      }
      return;
    }

    if (isNativeApk && getConfiguredApiBaseUrl()) {
      await refreshMetrics(true);
      if (serverSheetsStatus?.configured) {
        if (onShowToast) onShowToast('Google Sheets is connected via your Netlify backend!');
        return;
      }
      setShowSheetSettings(true);
      setBatchSyncFeedback(
        'Your Netlify backend is reachable, but Google Sheets credentials are not set in Netlify environment variables yet.'
      );
      return;
    }

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

  // Batch Sync Handler (Admin Only)
  const handleBatchSyncSheets = async () => {
    if (!isAdmin) return;
    if (backendUrlInput.trim() && backendUrlInput.trim() !== getConfiguredApiBaseUrl()) {
      setConfiguredApiBaseUrl(backendUrlInput.trim());
    }

    if (isNativeApk && !getConfiguredApiBaseUrl()) {
      setShowSheetSettings(true);
      setBatchSyncFeedback(
        'Please enter your live Netlify Backend URL (e.g. https://your-site.netlify.app) first so the Android APK can sync with Google Sheets.'
      );
      return;
    }

    setIsBatchSyncing(true);
    setBatchSyncFeedback(null);
    try {
      const allLocalBills = loadPersistentBills();
      const unsyncedBills = allLocalBills.filter(
        (b) => !b.savedToSheets || b.sheetsSyncStatus !== 'synced'
      );

      const res = await apiFetch('/api/bills/batch-sync-sheets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          googleAccessToken: googleToken || undefined,
          customSpreadsheetId: customSpreadsheetId.trim() || undefined,
          clientPendingBills: unsyncedBills,
        }),
      });
      const { ok, data } = await parseApiJsonResponse(res);
      if (ok && data?.success) {
        if (data.failedCount === 0) {
          localStorage.removeItem('annpurna_pending_sync_bills');
        }
        setBatchSyncFeedback(data.message || 'Batch sync completed successfully.');
        if (onShowToast) onShowToast(data.message || 'Google Sheets synchronized!');
        await refreshMetrics(true);
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

    if (!orderType) {
      setOrderTypeError('Select Dine In or Pack');
      isValid = false;
    }

    const trimmedName = customerName.trim();
    if (!trimmedName) {
      setNameError('Name required');
      isValid = false;
    } else if (trimmedName.length < 2) {
      setNameError('Min 2 characters');
      isValid = false;
    }

    const rawMobile = mobileNumber.trim();
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

    const parsedPct = parseFloat(discountPercentInput);
    if (!isNaN(parsedPct)) {
      if (parsedPct < 0 || parsedPct > 100) {
        setDiscountError('Discount must be between 0% and 100%');
        isValid = false;
      }
    }

    if (billSummary.lines.length === 0) {
      setItemsError('Add at least 1 item');
      isValid = false;
    }

    if (draftItems.COLD_DRINK > 0) {
      const parsedMRP = parseFloat(coldDrinkMRP);
      if (isNaN(parsedMRP) || parsedMRP <= 0) {
        setColdDrinkError('Valid MRP required');
        isValid = false;
      }
    }

    return isValid;
  };

  // Submit and Save Bill (Automatically creates synchronized WAITING Kitchen Order)
  const handleSaveBill = async () => {
    if (!validateForm()) return;

    setIsSaving(true);
    setSaveErrorMessage(null);

    try {
      const rawMobile = mobileNumber.trim();
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
        specialInstructions: specialInstructions.trim() || undefined,
        idempotencyKey: draftIdempotencyKey,
        userId: googleUser?.email || adminUsername,
        googleAccessToken: isAdmin ? googleToken || undefined : undefined,
        customSpreadsheetId: isAdmin ? customSpreadsheetId.trim() || undefined : undefined,
      };

      const response = await apiFetch('/api/bills', {
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

      const nowMs = Date.now();
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
        timestamp: data.timestamp || nowMs,
        userId: data.userId || adminUsername,
        savedToSheets: data.savedToSheets,
        sheetsSyncStatus: data.sheetsSyncStatus || (data.savedToSheets ? 'synced' : 'failed'),
        spreadsheetId: data.spreadsheetId,
        spreadsheetUrl: data.spreadsheetUrl,
        orderStatus: data.orderStatus || 'WAITING',
        orderCreatedAt: data.orderCreatedAt || data.timestamp || nowMs,
        specialInstructions: data.specialInstructions || specialInstructions.trim() || undefined,
      };

      const updatedPersistent = upsertPersistentBill(authoritativeBill);
      if (isAdmin) {
        setMetrics(computeBusinessMetricsFromBills(updatedPersistent, Date.now()));
      }

      clearEntireBill();
      refreshMetrics(false);

      onBillCompleted(authoritativeBill);
    } catch (err: any) {
      console.error('Save bill failed:', err);
      setSaveErrorMessage(err.message || 'An error occurred while saving the bill.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col text-slate-800 pb-16 md:pb-0">
      {/* Top Navigation Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs safe-top">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand Identity */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black shadow-xs shrink-0">
              <UtensilsCrossed className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-extrabold text-slate-900 tracking-tight text-sm sm:text-lg truncate">
                  Annapurna Chole Bhature
                </h1>
                <span
                  className={`inline-block text-[10px] sm:text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 border ${
                    isAdmin
                      ? 'text-amber-900 bg-amber-50 border-amber-300'
                      : 'text-blue-700 bg-blue-50 border-blue-200'
                  }`}
                >
                  {isAdmin ? 'Annapurna Admin' : 'Annapurna Billing'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block truncate">
                {isAdmin
                  ? 'Full Admin Access • Sales Analytics • Google Sheets • Kitchen Queue'
                  : 'Billing Counter • New Bill • Bill History • Live Kitchen Order Status'}
              </p>
            </div>
          </div>

          {/* Desktop Navigation View Switcher */}
          <div className="hidden md:flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setActiveTab('terminal')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
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
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Bill History</span>
              {isAdmin && metrics.totalBills > 0 && (
                <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.2 rounded font-mono">
                  {metrics.totalBills}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('orders')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'orders'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ChefHat className="w-3.5 h-3.5 text-amber-600" />
              <span>{isAdmin ? 'Kitchen Orders' : 'Order Status'}</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => setActiveTab('calendar')}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'calendar'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Calendar className="w-3.5 h-3.5 text-blue-600" />
                <span>Sales Calendar</span>
              </button>
            )}
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <div
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] sm:text-xs font-bold border ${
                isBackendOnline
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}
              title={
                isBackendOnline
                  ? `Connected to live production backend (${getConfiguredApiBaseUrl()})`
                  : 'Reconnecting to production backend...'
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isBackendOnline ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span>{isBackendOnline ? 'LIVE ONLINE' : 'RECONNECTING'}</span>
            </div>

            <LiveIstClock />

            {/* Google Sheets Connection Status (Admin Only) */}
            {isAdmin &&
              (isSheetsConnected ? (
                <button
                  type="button"
                  onClick={() => setShowSheetSettings((prev) => !prev)}
                  className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1.5 rounded-lg text-xs text-emerald-800 cursor-pointer transition"
                  title="Google Sheets Connected (Click for Settings)"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-semibold hidden sm:inline">Sheets Active</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowSheetSettings((prev) => !prev)}
                  className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-semibold px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer"
                  title="Configure Google Sheets / Server Connection"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="hidden sm:inline">Setup Sheets</span>
                </button>
              ))}

            {/* 3D Thali Preview (Admin Only) */}
            {isAdmin && (
              <button
                onClick={onOpen3DModal}
                className="p-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-slate-200/80 transition cursor-pointer"
                title="Interactive 3D Dish View"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
              </button>
            )}

            {/* Logout */}
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition cursor-pointer"
              title={`Logout (${adminUsername})`}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-3.5 sm:py-5 flex-1 w-full space-y-3.5 sm:space-y-5">
        {/* Google Sheets Synchronization Status Banner (Strictly Admin Only) */}
        {isAdmin && (
          <div
            className={`p-3 sm:p-4 rounded-lg sm:rounded-xl border text-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 sm:gap-3 ${
              isSheetsConnected
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/80 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-start sm:items-center gap-2.5">
              <div
                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  isSheetsConnected
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-amber-100 text-amber-700'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-extrabold text-xs sm:text-sm">
                    {isSheetsConnected
                      ? 'Google Sheets Auto-Sync Active'
                      : isNativeApk && !getConfiguredApiBaseUrl()
                      ? 'Android APK: Connect Netlify Backend for Google Sheets'
                      : 'Local Database Mode (Google Sheets Sync Pending)'}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      isSheetsConnected
                        ? 'bg-emerald-200/80 text-emerald-800'
                        : 'bg-amber-200/80 text-amber-800'
                    }`}
                  >
                    {serverSheetsStatus?.configured
                      ? serverSheetsStatus.modeLabel
                      : googleToken
                      ? 'Google Workspace Connected'
                      : getConfiguredApiBaseUrl()
                      ? `Server: ${getConfiguredApiBaseUrl().replace(/^https?:\/\//, '')}`
                      : 'Offline Queue Active'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                  {isSheetsConnected
                    ? `Every bill is verified and recorded in your Google Sheet (${metrics.syncedBillsCount} bills synced).`
                    : isNativeApk && !getConfiguredApiBaseUrl()
                    ? 'Enter your deployed Netlify HTTPS URL in Server & Sheet Settings below so this Android app routes all Google Sheets operations through your Netlify backend.'
                    : 'Bills are saved locally and queued safely. Configure Netlify backend or Service Account variables for automatic Google Sheets recording.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-end">
              {metrics.failedBillsCount > 0 && (
                <button
                  type="button"
                  onClick={handleBatchSyncSheets}
                  disabled={isBatchSyncing}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-md shadow-xs transition flex items-center gap-1.5 cursor-pointer text-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isBatchSyncing ? 'animate-spin' : ''}`} />
                  <span>Sync {metrics.failedBillsCount} Pending</span>
                </button>
              )}
              {!isSheetsConnected && !isNativeApk && (
                <button
                  type="button"
                  onClick={handleGoogleConnect}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-md shadow-xs transition flex items-center gap-1.5 cursor-pointer text-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Connect Google</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowSheetSettings(!showSheetSettings)}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 font-semibold rounded-md transition text-xs cursor-pointer flex items-center gap-1"
              >
                <Settings2 className="w-3.5 h-3.5 text-slate-500" />
                <span>{showSheetSettings ? 'Hide Settings' : 'Settings & Passwords'}</span>
              </button>
              <button
                type="button"
                onClick={() => setIsResetSalesModalOpen(true)}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-md shadow-xs transition text-xs cursor-pointer flex items-center gap-1.5"
                title="Reset Sales Data (Admin Dual Verification)"
              >
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>RESET SALES DATA</span>
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Netlify Backend URL, Custom Sheet ID & Profile Password Settings (Strictly Admin Only) */}
        {isAdmin && showSheetSettings && (
          <div className="bg-white p-3.5 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200 text-xs space-y-4 shadow-xs">
            {/* Netlify Backend URL */}
            <div className="space-y-1.5 pb-3 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-blue-600" />
                  <span>Production Netlify Backend URL (Android APK → Netlify → Google Sheets)</span>
                </h4>
                {getConfiguredApiBaseUrl() && (
                  <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    Active
                  </span>
                )}
              </div>
              <p className="text-slate-500 text-[11px]">
                All Google Sheets credentials remain securely on your Netlify backend. Enter your deployed Netlify site URL (e.g. <code className="font-mono text-slate-700">https://your-site.netlify.app</code>) so the Android APK communicates with Google Sheets through Netlify:
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={backendUrlInput}
                  onChange={(e) => setBackendUrlInput(e.target.value)}
                  placeholder="https://your-site-name.netlify.app"
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleSaveBackendUrl}
                  disabled={isTestingBackend}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                >
                  {isTestingBackend ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>{isTestingBackend ? 'Verifying Server...' : 'Connect & Verify Server'}</span>
                </button>
              </div>
            </div>

            {/* Custom Google Sheet ID */}
            <div className="space-y-1.5 pb-3 border-b border-slate-100">
              <h4 className="font-bold text-slate-900">Custom Google Sheet ID (Optional Override)</h4>
              <p className="text-slate-500 text-[11px]">
                Leave blank to use the <code className="font-mono text-slate-700">GOOGLE_SHEET_ID</code> configured in your Netlify environment variables, or paste a specific Spreadsheet ID / URL:
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={customSpreadsheetId}
                  onChange={(e) => {
                    setCustomSpreadsheetId(e.target.value);
                    localStorage.setItem('annpurna_custom_sheet_id', e.target.value);
                  }}
                  placeholder="Optional: Paste Spreadsheet ID or full Google Sheet URL..."
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={handleBatchSyncSheets}
                  disabled={isBatchSyncing}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs disabled:opacity-50 transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isBatchSyncing ? 'animate-spin' : ''}`} />
                  <span>{isBatchSyncing ? 'Syncing with Sheets...' : 'Save & Sync All Bills'}</span>
                </button>
              </div>
            </div>

            {/* Admin Profile Password Management */}
            <form onSubmit={handleAdminChangePassword} className="space-y-2">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                <span>Change Profile Password (Admin / Billing / Order)</span>
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <select
                  value={pwdTargetRole}
                  onChange={(e) => setPwdTargetRole(e.target.value as UserRole)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs text-slate-800"
                >
                  <option value="admin">Annapurna Admin (annapurna_admin)</option>
                  <option value="billing">Annapurna Billing (annapurna_billing)</option>
                  <option value="order">Annapurna Order (annapurna_order)</option>
                </select>
                <input
                  type="password"
                  value={pwdCurrentAdmin}
                  onChange={(e) => setPwdCurrentAdmin(e.target.value)}
                  placeholder="Current Admin Password"
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
                <input
                  type="password"
                  value={pwdNewValue}
                  onChange={(e) => setPwdNewValue(e.target.value)}
                  placeholder="New Password (min 6 chars)"
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
                <button
                  type="submit"
                  disabled={isChangingPwd}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs cursor-pointer transition disabled:opacity-50"
                >
                  {isChangingPwd ? 'Updating...' : 'Update Password'}
                </button>
              </div>
              {pwdFeedback && (
                <div
                  className={`p-2 rounded-md text-xs font-semibold ${
                    pwdFeedback.ok
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border border-rose-200'
                  }`}
                >
                  {pwdFeedback.msg}
                </div>
              )}
            </form>

            {/* Admin-Only Reset Sales Data Danger Zone */}
            <div className="pt-3 border-t border-rose-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-rose-50/60 p-3 rounded-lg border">
              <div className="space-y-0.5">
                <h4 className="font-extrabold text-rose-950 flex items-center gap-1.5 text-xs">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Danger Zone: Reset Sales Data (Admin Only)</span>
                </h4>
                <p className="text-[11px] text-rose-800">
                  Permanently clears all historical bills, 24h &amp; monthly sales totals, revenue analytics, sales calendar entries, and completed kitchen orders back to ₹0.00. Preserves menu items, user accounts, and Google Sheets config.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsResetSalesModalOpen(true)}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-lg text-xs transition cursor-pointer flex items-center gap-1.5 shrink-0 shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>RESET SALES DATA</span>
              </button>
            </div>

            {batchSyncFeedback && (
              <div className="p-2.5 rounded-md bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-800">
                {batchSyncFeedback}
              </div>
            )}
          </div>
        )}

        {/* Metrics Dashboard Cards (Strictly Admin Only — Hidden for Billing Profile) */}
        {isAdmin && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
            {/* Card 1: Rolling 24-Hour Sales */}
            <div className="bg-white p-3 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                    24h Sales
                  </p>
                  <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                    Rolling
                  </span>
                </div>
                <h3 className="text-base sm:text-2xl font-black text-slate-900 font-mono mt-0.5 truncate">
                  ₹{metrics.todaySalesRupees.toFixed(2)}
                </h3>
                <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
                  {metrics.todayBillsCount} {metrics.todayBillsCount === 1 ? 'bill' : 'bills'} in 24h
                </p>
              </div>
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>

            {/* Card 2: Monthly Sales */}
            <div className="bg-white p-3 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">
                  {metrics.currentMonthName || 'Monthly'}
                </p>
                <h3 className="text-base sm:text-2xl font-black text-slate-900 font-mono mt-0.5 truncate">
                  ₹{metrics.monthlySalesRupees.toFixed(2)}
                </h3>
                <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
                  {metrics.monthlyBillsCount} bills this month
                </p>
              </div>
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <Calendar className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>

            {/* Card 3: Total Bills */}
            <div className="bg-white p-3 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Total Bills
                </p>
                <h3 className="text-base sm:text-2xl font-black text-slate-900 font-mono mt-0.5">
                  {metrics.totalBills}
                </h3>
                <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
                  All time recorded
                </p>
              </div>
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>

            {/* Card 4: Total Revenue & Sync Status */}
            <div className="bg-white p-3 sm:p-4 rounded-lg sm:rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Total Revenue
                </p>
                <h3 className="text-base sm:text-2xl font-black text-blue-700 font-mono mt-0.5 truncate">
                  ₹{metrics.totalRevenueRupees.toFixed(2)}
                </h3>
                <p className="text-[10px] sm:text-[11px] text-emerald-600 font-medium mt-0.5 flex items-center gap-1 truncate">
                  <CheckCircle2 className="w-3 h-3 inline shrink-0" />
                  <span>{metrics.syncedBillsCount} synced</span>
                </p>
              </div>
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <DollarSign className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
            </div>
          </div>
        )}

        {/* View Switch: New Bill Terminal vs Bill History vs Kitchen Orders / Status vs Monthly Calendar */}
        {isAdmin && activeTab === 'calendar' ? (
          <MonthlySalesCalendar
            key={`cal-${resetEpoch}`}
            adminToken={adminToken}
            onSelectBill={(b) => setCalendarSelectedBill(b)}
            onShareWhatsApp={onShareWhatsApp}
            onPreviewPdf={(b) => (onPreviewPdf ? onPreviewPdf(b) : onBillCompleted(b))}
          />
        ) : activeTab === 'orders' ? (
          isAdmin ? (
            <OrderDashboard
              key={`ord-admin-${resetEpoch}`}
              token={adminToken}
              username={adminUsername}
              userRole="admin"
              onLogout={onLogout}
              embeddedInAdmin
              onShowToast={onShowToast}
            />
          ) : (
            <LiveOrderStatusPanel
              key={`ord-billing-${resetEpoch}`}
              token={adminToken}
              userRole="billing"
              onLogout={onLogout}
              onShowToast={onShowToast}
            />
          )
        ) : activeTab === 'history' ? (
          <BillHistoryView
            key={`hist-${resetEpoch}`}
            adminToken={adminToken}
            googleToken={isAdmin ? googleToken : null}
            userRole={userRole}
            onShareWhatsApp={onShareWhatsApp}
            onRefreshMetrics={() => refreshMetrics(true)}
          />
        ) : (
          <div className="space-y-5">
            {/* Billing Terminal: 2 Column Layout on Desktop, Clean Stacked Layout on Mobile */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-5">
              {/* Left Column (7 cols): Order Type, Customer Details & Menu Items */}
              <div className="lg:col-span-7 space-y-3.5 sm:space-y-4">
                {/* Order Type & Customer Details Card */}
                <div className="bg-white rounded-lg sm:rounded-xl p-3.5 sm:p-5 border border-slate-200 shadow-xs space-y-3.5">
                  {/* 1. Order Type Selection (Required) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1">
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

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOrderType('DINE_IN');
                          setOrderTypeError(null);
                        }}
                        className={`py-2.5 px-3 rounded-lg border text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                          orderType === 'DINE_IN'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <Utensils className="w-4 h-4 shrink-0" />
                        <span>Dine In</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setOrderType('PACK');
                          setOrderTypeError(null);
                        }}
                        className={`py-2.5 px-3 rounded-lg border text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                          orderType === 'PACK'
                            ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <Package className="w-4 h-4 shrink-0" />
                        <span>Pack (Takeaway)</span>
                      </button>
                    </div>
                  </div>

                  {/* 2. Customer Name & Mobile */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-0.5">
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
                          className={`w-full pl-9 pr-3 py-2 bg-slate-50 border rounded-lg text-base sm:text-sm font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
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
                        <span className="inline-flex items-center px-2.5 py-2 rounded-l-lg border border-r-0 border-slate-200 bg-slate-100 text-slate-600 font-mono text-xs font-bold">
                          {countryCode}
                        </span>
                        <div className="relative flex-1">
                          <input
                            type="tel"
                            inputMode="numeric"
                            value={mobileNumber}
                            onChange={handleMobileChange}
                            placeholder="9876543210 (10 digits)"
                            maxLength={10}
                            className={`w-full px-3 py-2 bg-slate-50 border rounded-r-lg text-base sm:text-sm font-mono font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                              mobileError ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                            }`}
                          />
                        </div>
                      </div>
                      {mobileError && <p className="text-[11px] text-rose-600 mt-1 font-semibold">{mobileError}</p>}
                    </div>
                  </div>

                  {/* 3. Optional Special Kitchen Note (Flows to Order Worker Dashboard) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                      <MessageSquarePlus className="w-3.5 h-3.5 text-amber-600" />
                      <span>Special Instructions for Kitchen (Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={specialInstructions}
                      onChange={(e) => setSpecialInstructions(e.target.value)}
                      placeholder="e.g. Less spicy, extra onions, pack chutney separately..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs sm:text-sm font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Menu Items Card (Touch-friendly Steppers) */}
                <div className="bg-white rounded-lg sm:rounded-xl p-3.5 sm:p-5 border border-slate-200 shadow-xs space-y-2.5">
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
                    <div className="py-2.5 flex items-center justify-between gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">Chole Bhature</h4>
                          <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                            ₹80
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">2 Bhature + Spiced Chole</p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity('CHOLE_BHATURE', -1)}
                          className="w-9 h-9 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={draftItems.CHOLE_BHATURE}
                          onChange={(e) => setDirectQuantity('CHOLE_BHATURE', Number(e.target.value))}
                          className="w-12 h-9 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity('CHOLE_BHATURE', 1)}
                          className="w-9 h-9 rounded-md bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Lassi - ₹40 */}
                    <div className="py-2.5 flex items-center justify-between gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">Lassi</h4>
                          <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                            ₹40
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">Sweet Creamy Yogurt Drink</p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity('LASSI', -1)}
                          className="w-9 h-9 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={draftItems.LASSI}
                          onChange={(e) => setDirectQuantity('LASSI', Number(e.target.value))}
                          className="w-12 h-9 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity('LASSI', 1)}
                          className="w-9 h-9 rounded-md bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Chole (Extra) - ₹40 */}
                    <div className="py-2.5 flex items-center justify-between gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">Chole</h4>
                          <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                            ₹40
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">Extra Chole Portion</p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity('CHOLE', -1)}
                          className="w-9 h-9 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={draftItems.CHOLE}
                          onChange={(e) => setDirectQuantity('CHOLE', Number(e.target.value))}
                          className="w-12 h-9 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity('CHOLE', 1)}
                          className="w-9 h-9 rounded-md bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Bhature (Single) - ₹25 */}
                    <div className="py-2.5 flex items-center justify-between gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">Bhature</h4>
                          <span className="font-mono font-bold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                            ₹25
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 truncate">Single Bhatura (1 Piece)</p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity('BHATURE', -1)}
                          className="w-9 h-9 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={draftItems.BHATURE}
                          onChange={(e) => setDirectQuantity('BHATURE', Number(e.target.value))}
                          className="w-12 h-9 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity('BHATURE', 1)}
                          className="w-9 h-9 rounded-md bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Cold Drink - MRP Input */}
                    <div className="py-2.5 flex items-center justify-between gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-slate-900 text-sm">Cold Drink</h4>
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] font-semibold text-slate-500">MRP:</span>
                            <div className="relative w-16">
                              <span className="absolute inset-y-0 left-1.5 flex items-center text-xs text-slate-400">
                                ₹
                              </span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="1"
                                value={coldDrinkMRP}
                                onChange={(e) => {
                                  setColdDrinkMRP(e.target.value);
                                  if (coldDrinkError) setColdDrinkError(null);
                                }}
                                className="w-full pl-4 pr-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono font-bold"
                              />
                            </div>
                          </div>
                        </div>
                        {coldDrinkError ? (
                          <p className="text-[11px] text-rose-600 font-semibold">{coldDrinkError}</p>
                        ) : (
                          <p className="text-xs text-slate-400 truncate">Chilled Soft Drink bottle</p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQuantity('COLD_DRINK', -1)}
                          className="w-9 h-9 rounded-md bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          value={draftItems.COLD_DRINK}
                          onChange={(e) => setDirectQuantity('COLD_DRINK', Number(e.target.value))}
                          className="w-12 h-9 text-center font-mono font-bold text-sm bg-slate-50 border border-slate-200 rounded-md focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateQuantity('COLD_DRINK', 1)}
                          className="w-9 h-9 rounded-md bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white flex items-center justify-center transition cursor-pointer font-bold"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column (5 cols): Bill Summary, Discount, Payment & Save */}
              <div className="lg:col-span-5 space-y-3.5 sm:space-y-4">
                <div className="bg-white rounded-lg sm:rounded-xl p-3.5 sm:p-5 border border-slate-200 shadow-xs space-y-3.5">
                  <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                    <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-blue-600" />
                      <span>Bill Summary</span>
                    </h3>

                    {billSummary.lines.length > 0 && (
                      <button
                        onClick={clearEntireBill}
                        className="text-xs text-rose-600 hover:text-rose-800 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Clear</span>
                      </button>
                    )}
                  </div>

                  {/* Items Breakdown */}
                  {billSummary.lines.length === 0 ? (
                    <div className="py-5 text-center text-slate-400">
                      <UtensilsCrossed className="w-7 h-7 mx-auto text-slate-200 mb-1" />
                      <p className="text-xs">No items added yet</p>
                      <p className="text-[11px] text-slate-300">Tap + to add items from the menu</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
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
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['Cash', 'UPI', 'Card'] as PaymentMethod[]).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPaymentMethod(m)}
                          className={`py-2 px-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                            paymentMethod === m
                              ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-xs'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {m === 'Cash' && <Banknote className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                          {m === 'UPI' && <Smartphone className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
                          {m === 'Card' && <CreditCard className="w-3.5 h-3.5 text-purple-600 shrink-0" />}
                          <span>{m}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Discount Percentage Input */}
                  <div className="pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-1.5">
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
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="any"
                        value={discountPercentInput}
                        onChange={handleDiscountPercentChange}
                        placeholder="0"
                        className={`w-full pl-3 pr-8 py-2 bg-slate-50 border rounded-lg text-base sm:text-sm font-mono font-bold focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                          discountError ? 'border-rose-400 bg-rose-50/50' : 'border-slate-200'
                        }`}
                      />
                      <span className="absolute inset-y-0 right-3 flex items-center text-xs font-bold text-slate-500">
                        %
                      </span>
                    </div>
                    {discountError && (
                      <p className="text-[11px] text-rose-600 font-semibold mt-1">{discountError}</p>
                    )}
                  </div>

                  {/* Totals Box */}
                  <div className="bg-slate-50 p-3 sm:p-3.5 rounded-lg border border-slate-200 space-y-1.5 text-xs">
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
                    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>{saveErrorMessage}</span>
                    </div>
                  )}

                  {/* Primary Action Button: Save & Generate Bill */}
                  <button
                    type="button"
                    onClick={handleSaveBill}
                    disabled={isSaving}
                    className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-extrabold rounded-lg shadow-sm transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Saving Bill &amp; Sending to Kitchen...</span>
                      </>
                    ) : (
                      <>
                        <Receipt className="w-4 h-4" />
                        <span>Generate Bill &amp; Send to Kitchen</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Live Order Status Strip right below New Bill so Billing & Admin can monitor active kitchen orders immediately */}
            <LiveOrderStatusPanel
              key={`live-strip-${resetEpoch}`}
              token={adminToken}
              userRole={userRole}
              onLogout={onLogout}
              onShowToast={onShowToast}
            />
          </div>
        )}

        {/* Modal Inspection for Bill clicked from Monthly Sales Calendar */}
        {isAdmin && calendarSelectedBill && (
          <BillDetailsModal
            bill={calendarSelectedBill}
            onClose={() => setCalendarSelectedBill(null)}
            onShareWhatsApp={onShareWhatsApp}
            onPreviewPdf={onPreviewPdf ? () => onPreviewPdf(calendarSelectedBill) : undefined}
            userRole={userRole}
          />
        )}

        {/* Admin-Only Reset Sales Data Dual Verification Modal */}
        {isAdmin && (
          <ResetSalesModal
            isOpen={isResetSalesModalOpen}
            adminToken={adminToken}
            currentMetrics={metrics}
            onClose={() => setIsResetSalesModalOpen(false)}
            onResetSuccess={(newMetrics: BusinessMetrics, auditEntry: ResetSalesAuditEntry) => {
              setMetrics(newMetrics);
              setResetEpoch((prev) => prev + 1);
              if (onShowToast) {
                onShowToast(
                  `Sales data reset complete (${auditEntry.deletedBillsCount} bills cleared to ₹0.00).`
                );
              }
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile Primary Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 shadow-lg safe-bottom"
      >
        <div className={`grid ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'} h-14`}>
          <button
            type="button"
            onClick={() => setActiveTab('terminal')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition cursor-pointer ${
              activeTab === 'terminal'
                ? 'text-blue-600 bg-blue-50/50'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>New Bill</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition cursor-pointer relative ${
              activeTab === 'history'
                ? 'text-blue-600 bg-blue-50/50'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <div className="relative flex items-center">
              <History className="w-4 h-4" />
              {isAdmin && metrics.totalBills > 0 && (
                <span className="ml-1 bg-blue-100 text-blue-800 text-[9px] px-1.5 rounded font-mono">
                  {metrics.totalBills}
                </span>
              )}
            </div>
            <span>Bill History</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('orders')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition cursor-pointer ${
              activeTab === 'orders'
                ? 'text-blue-600 bg-blue-50/50'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ChefHat className="w-4 h-4" />
            <span>{isAdmin ? 'Kitchen' : 'Order Status'}</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition cursor-pointer ${
                activeTab === 'calendar'
                  ? 'text-blue-600 bg-blue-50/50'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Calendar className="w-4 h-4" />
              <span>Calendar</span>
            </button>
          )}
        </div>
      </nav>
    </div>
  );
};
