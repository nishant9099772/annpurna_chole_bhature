import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Trash2,
  ShieldAlert,
  Lock,
  CheckCircle2,
  X,
  RefreshCw,
  FileSpreadsheet,
  ChefHat,
  History,
} from 'lucide-react';
import { BusinessMetrics, ResetSalesAuditEntry } from '../types/billing';
import { apiFetch, parseApiJsonResponse } from '../utils/apiClient';
import { clearAllPersistentBills } from '../utils/persistentBillsStorage';

interface ResetSalesModalProps {
  isOpen: boolean;
  adminToken: string;
  currentMetrics: BusinessMetrics;
  onClose: () => void;
  onResetSuccess: (newMetrics: BusinessMetrics, auditEntry: ResetSalesAuditEntry) => void;
}

const REQUIRED_CONFIRMATION_PHRASE = 'RESET ALL SALES DATA';

export const ResetSalesModal: React.FC<ResetSalesModalProps> = ({
  isOpen,
  adminToken,
  currentMetrics,
  onClose,
  onResetSuccess,
}) => {
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [auditHistory, setAuditHistory] = useState<ResetSalesAuditEntry[]>([]);

  useEffect(() => {
    if (!isOpen) {
      setAdminPassword('');
      setConfirmationPhrase('');
      setErrorMessage(null);
      setIsSubmitting(false);
      return;
    }

    // Load recent reset audit entries when modal opens
    let mounted = true;
    (async () => {
      try {
        const res = await apiFetch('/api/admin/reset-audit', {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            Accept: 'application/json',
          },
        });
        const { ok, data } = await parseApiJsonResponse<{
          auditLog?: ResetSalesAuditEntry[];
        }>(res);
        if (mounted && ok && Array.isArray(data?.auditLog)) {
          setAuditHistory(data.auditLog.slice(0, 3));
        }
      } catch {
        // ignore audit load error
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isOpen, adminToken]);

  if (!isOpen) return null;

  const isPhraseExactMatch = confirmationPhrase.trim() === REQUIRED_CONFIRMATION_PHRASE;
  const canSubmit = Boolean(adminPassword.trim().length > 0 && isPhraseExactMatch && !isSubmitting);

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!adminPassword.trim()) {
      setErrorMessage('Please enter your current Admin password.');
      return;
    }

    if (!isPhraseExactMatch) {
      setErrorMessage(`Please type the exact confirmation phrase: ${REQUIRED_CONFIRMATION_PHRASE}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/admin/reset-sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          adminPassword,
          confirmationPhrase: confirmationPhrase.trim(),
        }),
      });

      const { ok, data } = await parseApiJsonResponse<{
        success?: boolean;
        message?: string;
        error?: string;
        auditEntry?: ResetSalesAuditEntry;
        lastResetTimestamp?: number;
        metrics?: BusinessMetrics;
      }>(res);

      if (!ok || !data?.success) {
        throw new Error(data?.error || `Reset failed (HTTP ${res.status})`);
      }

      // Immediately purge local browser storage & set reset watermark so old bills never resurrect
      clearAllPersistentBills(data.lastResetTimestamp || Date.now());

      const updatedMetrics: BusinessMetrics = data.metrics || {
        ...currentMetrics,
        totalBills: 0,
        todaySalesRupees: 0,
        todayBillsCount: 0,
        rolling24hSalesRupees: 0,
        rolling24hBillsCount: 0,
        monthlySalesRupees: 0,
        monthlyBillsCount: 0,
        totalRevenueRupees: 0,
        syncedBillsCount: 0,
        failedBillsCount: 0,
      };

      const auditEntry: ResetSalesAuditEntry = data.auditEntry || {
        resetId: 'RST-NOW',
        timestamp: Date.now(),
        dateTimeKolkata: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        adminUsername: 'annapurna_admin',
        deletedBillsCount: currentMetrics.totalBills,
        deletedRevenueRupees: currentMetrics.totalRevenueRupees,
      };

      onResetSuccess(updatedMetrics, auditEntry);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not reset sales data.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-sales-modal-title"
    >
      <div className="bg-white rounded-2xl border-2 border-rose-300 shadow-2xl max-w-lg w-full overflow-hidden my-auto">
        {/* Top Danger Banner */}
        <div className="bg-rose-600 text-white px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h2 id="reset-sales-modal-title" className="text-base sm:text-lg font-black tracking-tight">
                RESET SALES DATA (Admin Only)
              </h2>
              <p className="text-xs text-rose-100 font-medium truncate">
                Dual-Verification Destructive Action • Cannot Be Undone
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg bg-rose-700/60 hover:bg-rose-700 text-white transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleConfirmReset} className="p-4 sm:p-6 space-y-4 text-xs sm:text-sm">
          {/* Current Data Snapshot */}
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between font-bold text-rose-950">
              <span>Current Recorded Bills to Clear:</span>
              <span className="font-mono text-sm sm:text-base font-black">
                {currentMetrics.totalBills} Bills (₹{currentMetrics.totalRevenueRupees.toFixed(2)})
              </span>
            </div>
            <p className="text-xs text-rose-800 leading-relaxed">
              This will permanently reset <strong>24h Sales</strong>, <strong>Monthly Sales</strong>,{' '}
              <strong>Total Revenue</strong>, <strong>Bill History</strong>,{' '}
              <strong>Sales Calendar</strong>, and <strong>Completed Kitchen Orders</strong> back to{' '}
              <strong className="font-mono">₹0.00</strong>.
            </p>
          </div>

          {/* What is Preserved vs What is Reset */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200 space-y-1">
              <p className="font-extrabold text-emerald-950 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Preserved Intact</span>
              </p>
              <ul className="text-[11px] text-emerald-900 space-y-0.5 pl-1">
                <li>• Menu items &amp; prices</li>
                <li>• All 3 user profiles &amp; passwords</li>
                <li>• Google Sheets &amp; API settings</li>
              </ul>
            </div>

            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 space-y-1">
              <p className="font-extrabold text-amber-950 flex items-center gap-1.5">
                <ChefHat className="w-4 h-4 text-amber-700 shrink-0" />
                <span>Kitchen &amp; Sheets Guard</span>
              </p>
              <ul className="text-[11px] text-amber-900 space-y-0.5 pl-1">
                <li>• Blocked if orders are PREPARING</li>
                <li>• Reset watermark prevents old Sheet rows from re-importing</li>
              </ul>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <span>
              <strong>Google Sheets Note:</strong> Resetting clears the application database to ₹0.00
              and sets a reset timestamp watermark so historical rows in your Google Sheet will not
              re-import into the app. Your external Google Drive spreadsheet file itself remains safe.
            </span>
          </div>

          {/* Step 1: Current Admin Password */}
          <div className="space-y-1.5">
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-rose-600" />
              <span>1. Enter Current Admin Password *</span>
            </label>
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => {
                setAdminPassword(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="Enter annapurna_admin password"
              autoComplete="current-password"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-rose-500"
            />
          </div>

          {/* Step 2: Exact Confirmation Phrase */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-800">
                2. Type Confirmation Phrase *
              </label>
              <span
                className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded ${
                  isPhraseExactMatch
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {REQUIRED_CONFIRMATION_PHRASE}
              </span>
            </div>
            <input
              type="text"
              value={confirmationPhrase}
              onChange={(e) => {
                setConfirmationPhrase(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="Type RESET ALL SALES DATA"
              className={`w-full px-3.5 py-2.5 bg-slate-50 border rounded-xl text-sm font-mono font-bold focus:bg-white focus:outline-hidden focus:ring-2 ${
                isPhraseExactMatch
                  ? 'border-emerald-400 focus:ring-emerald-500 text-emerald-900'
                  : 'border-slate-300 focus:ring-rose-500 text-slate-900'
              }`}
            />
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs font-bold flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Recent Audit History (if any) */}
          {auditHistory.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                <History className="w-3.5 h-3.5" />
                <span>Recent Reset Audit Log:</span>
              </p>
              <div className="space-y-1 max-h-20 overflow-y-auto">
                {auditHistory.map((entry) => (
                  <div
                    key={entry.resetId}
                    className="text-[11px] font-mono text-slate-600 bg-slate-50 px-2.5 py-1 rounded border border-slate-200 flex items-center justify-between"
                  >
                    <span>
                      {entry.dateTimeKolkata} ({entry.adminUsername})
                    </span>
                    <span className="font-bold text-rose-700">
                      -{entry.deletedBillsCount} bills
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs sm:text-sm transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition shadow-sm cursor-pointer disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span>Resetting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span>RESET SALES DATA</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
