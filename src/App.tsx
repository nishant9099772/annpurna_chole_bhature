/**
 * Annpurna Chole Bhature - Main Application Entry
 * Full-stack orchestrator managing mandatory server-verified login, billing dashboard,
 * Google Sheets workspace token, PDF receipt viewer, and 3D Thali showcase.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Bill } from './types/billing';
import { initAuth } from './services/firebaseAuth';
import {
  generateBillPdfBytes,
  createBillPdfBlobUrl,
  createBillPdfFile,
} from './services/pdfGenerator';
import { formatCustomerNameWithJi } from './utils/customerFormat';
import {
  hydrateAndSyncBillsWithServer,
  loadPersistentBills,
  upsertPersistentBill,
} from './utils/persistentBillsStorage';
import { parseApiJsonResponse } from './utils/apiClient';
import { AdminLogin } from './components/AdminLogin';
import { BillingDashboard } from './components/BillingDashboard';
import { BillSuccessModal } from './components/BillSuccessModal';
import { PdfPreviewModal } from './components/PdfPreviewModal';
import { RecentBillsDrawer } from './components/RecentBillsDrawer';
import { ThaliCanvas3D } from './components/ThaliCanvas3D';

export default function App() {
  // Admin Authentication State — strictly verified against backend /api/auth/me
  const [adminToken, setAdminToken] = useState<string | null>(() => {
    const stored = localStorage.getItem('annpurna_admin_token');
    // Reject legacy hardcoded bypass tokens
    if (!stored || !stored.startsWith('acb.')) {
      localStorage.removeItem('annpurna_admin_token');
      return null;
    }
    return stored;
  });
  const [adminUsername, setAdminUsername] = useState<string>(() => {
    return localStorage.getItem('annpurna_admin_user') || 'admin';
  });
  const [isSessionVerified, setIsSessionVerified] = useState<boolean>(false);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(() => {
    const stored = localStorage.getItem('annpurna_admin_token');
    return Boolean(stored && stored.startsWith('acb.'));
  });

  // Google Workspace Auth State (for Google Sheets sync)
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);

  // Completed Bills persisted across sessions, logouts, logins, and refreshes
  const [shiftBills, setShiftBills] = useState<Bill[]>(() => loadPersistentBills());
  const [activeCompletedBill, setActiveCompletedBill] = useState<Bill | null>(null);
  const [isRetryingSync, setIsRetryingSync] = useState(false);

  // Modals & Drawers
  const [previewPdfBill, setPreviewPdfBill] = useState<Bill | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [isRecentDrawerOpen, setIsRecentDrawerOpen] = useState(false);
  const [is3DModalOpen, setIs3DModalOpen] = useState(false);
  const [toastNotification, setToastNotification] = useState<string | null>(null);

  // Auto-dismiss toast after 3.5 seconds
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => setToastNotification(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

  // Listen for global toast events (e.g. from CopyMobileButton)
  useEffect(() => {
    const handleToastEvent = (e: Event) => {
      const custom = e as CustomEvent<{ message?: string }>;
      if (custom.detail?.message) {
        setToastNotification(custom.detail.message);
      }
    };
    window.addEventListener('annpurna:toast', handleToastEvent);
    return () => window.removeEventListener('annpurna:toast', handleToastEvent);
  }, []);

  // Verify existing session token with server on mount and token changes
  useEffect(() => {
    if (!adminToken) {
      setIsSessionVerified(false);
      setIsCheckingSession(false);
      return;
    }

    let cancelled = false;
    setIsCheckingSession(true);

    fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${adminToken}`,
        Accept: 'application/json',
      },
    })
      .then(async (res) => {
        const { ok, data } = await parseApiJsonResponse<any>(res);
        if (!ok || !data) {
          throw new Error('Session invalid or expired');
        }
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        if (data?.isAuthenticated) {
          setIsSessionVerified(true);
          if (data.username) {
            setAdminUsername(data.username);
            localStorage.setItem('annpurna_admin_user', data.username);
          }
        } else {
          throw new Error('Not authenticated');
        }
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem('annpurna_admin_token');
        localStorage.removeItem('annpurna_admin_user');
        setAdminToken(null);
        setIsSessionVerified(false);
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adminToken]);

  // Initialize Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  // Handle Admin Logout — ONLY clears authentication session token; NEVER deletes sales/bill records
  const handleAdminLogout = useCallback(() => {
    if (adminToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem('annpurna_admin_token');
    localStorage.removeItem('annpurna_admin_user');
    setAdminToken(null);
    setIsSessionVerified(false);
    setActiveCompletedBill(null);
  }, [adminToken]);

  // Bidirectionally hydrate & fetch persistent bills from backend after session is verified
  useEffect(() => {
    if (!adminToken || !isSessionVerified) return;

    hydrateAndSyncBillsWithServer(adminToken, googleToken)
      .then(({ bills }) => {
        setShiftBills(bills);
      })
      .catch((err: any) => {
        if (err?.status === 401) {
          handleAdminLogout();
          return;
        }
        console.log('Could not hydrate prior bills:', err);
      });
  }, [adminToken, isSessionVerified, googleToken, handleAdminLogout]);

  // Handle Admin Login Success
  const handleAdminLoginSuccess = (token: string, username: string) => {
    localStorage.setItem('annpurna_admin_token', token);
    localStorage.setItem('annpurna_admin_user', username);
    setAdminUsername(username);
    setAdminToken(token);
    setIsSessionVerified(true);
    setIsCheckingSession(false);
  };

  // Helper to manage persistent localStorage pending-sync queue
  const upsertPendingSyncBill = useCallback((bill: Bill) => {
    try {
      const raw = localStorage.getItem('annpurna_pending_sync_bills');
      const list: Bill[] = raw ? JSON.parse(raw) : [];
      const filtered = list.filter((b) => b.orderId !== bill.orderId && b.id !== bill.id);
      if (!bill.savedToSheets || bill.sheetsSyncStatus !== 'synced') {
        filtered.push(bill);
      }
      localStorage.setItem('annpurna_pending_sync_bills', JSON.stringify(filtered));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  // Handle Bill Completion
  const handleBillCompleted = (newBill: Bill) => {
    const normalizedBill: Bill = {
      ...newBill,
      customerName: formatCustomerNameWithJi(newBill.customerName),
    };
    upsertPendingSyncBill(normalizedBill);
    const mergedBills = upsertPersistentBill(normalizedBill);
    setShiftBills(mergedBills);
    setActiveCompletedBill(normalizedBill);
  };

  // Trigger PDF Preview Modal
  const handleOpenPdfPreview = async (bill: Bill) => {
    try {
      const normalizedBill: Bill = {
        ...bill,
        customerName: formatCustomerNameWithJi(bill.customerName),
      };
      const pdfBytes = await generateBillPdfBytes(normalizedBill);
      const url = createBillPdfBlobUrl(pdfBytes);
      setPreviewPdfBill(normalizedBill);
      setPreviewPdfUrl(url);
    } catch (err: any) {
      setToastNotification(`Could not generate PDF preview: ${err.message}`);
    }
  };

  // Close PDF Preview
  const handleClosePdfPreview = () => {
    if (previewPdfUrl) {
      URL.revokeObjectURL(previewPdfUrl);
    }
    setPreviewPdfBill(null);
    setPreviewPdfUrl(null);
  };

  // Retry Sync Handler (supports Server Service Account, Apps Script, or Client OAuth Token)
  const handleRetrySync = async (bill: Bill) => {
    setIsRetryingSync(true);
    try {
      const customSheetId = localStorage.getItem('annpurna_custom_sheet_id') || undefined;
      const res = await fetch(`/api/bills/${bill.id}/retry-sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          googleAccessToken: googleToken || undefined,
          customSpreadsheetId: customSheetId,
          billPayload: bill,
        }),
      });

      if (res.status === 401) {
        handleAdminLogout();
        return;
      }

      const { ok, data } = await parseApiJsonResponse<any>(res);
      if (!ok || !data?.success) {
        throw new Error(data?.error || 'Retry sync failed');
      }

      const syncedBill: Bill = data.bill || {
        ...bill,
        savedToSheets: true,
        sheetsSyncStatus: 'synced',
      };
      upsertPendingSyncBill(syncedBill);
      const mergedBills = upsertPersistentBill(syncedBill);

      setToastNotification(
        `Bill ${bill.orderId || bill.billNumber} saved to Google Sheets!`
      );
      if (activeCompletedBill && activeCompletedBill.id === bill.id) {
        setActiveCompletedBill(syncedBill);
      }
      setShiftBills(mergedBills);
    } catch (err: any) {
      setToastNotification(`Sync failed: ${err.message}`);
    } finally {
      setIsRetryingSync(false);
    }
  };

  // WhatsApp sharing handler with Order ID, " Ji" formatted name, itemized breakdown, and Cloud API / Click-to-Chat support
  const handleQuickWhatsAppShare = async (bill: Bill) => {
    try {
      const formattedCustomerName = formatCustomerNameWithJi(bill.customerName);
      const cleanCountry = bill.countryCode.replace(/\D/g, '') || '91';
      const cleanMobile = bill.mobileNumber.replace(/\D/g, '').slice(-10);
      const fullPhone = `${cleanCountry}${cleanMobile}`;

      const itemsList = bill.items
        .map(
          (i) =>
            `• ${i.name} x ${i.quantity} (₹${i.unitPriceRupees.toFixed(2)}) = ₹${i.lineTotalRupees.toFixed(2)}`
        )
        .join('\n');

      const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
      const discAmt =
        bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;

      const msg = `*ANNAPURNA CHOLE BHATURE*
POS Tax Invoice & Customer Receipt
Contact / WhatsApp: +91 8800896679
--------------------------------
Order ID: *${bill.orderId || bill.id}*
Bill Number: ${bill.billNumber}
Order Type: ${bill.orderTypeLabel}
Date & Time: ${bill.dateTimeKolkata}
Customer: *${formattedCustomerName}* (${bill.countryCode} ${bill.mobileNumber})
--------------------------------
*ITEMS PURCHASED:*
${itemsList}
--------------------------------
Subtotal: ₹${bill.subtotalRupees.toFixed(2)}
Discount (${discPct}%): -₹${discAmt.toFixed(2)}
*FINAL PAYABLE AMOUNT: ₹${bill.grandTotalRupees.toFixed(2)}*
Payment Method: ${bill.paymentMethod || 'Cash'} (${bill.paymentStatus || 'Paid'})
--------------------------------
Thank you for visiting *ANNAPURNA CHOLE BHATURE*! For feedback or queries, contact +91 8800896679.`;

      // 1. Check Official WhatsApp Business Cloud API first if configured on server
      if (adminToken) {
        try {
          const apiRes = await fetch(`/api/bills/${bill.id}/send-whatsapp`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${adminToken}`,
            },
            body: JSON.stringify({ bill }),
          });
          const { ok, data: apiData } = await parseApiJsonResponse<any>(apiRes);
          if (ok && apiData?.deliveredAutomatically && apiData?.mode === 'cloud_api') {
            setToastNotification(apiData.message || `WhatsApp sent to ${formattedCustomerName}!`);
            return;
          }
        } catch {
          // Proceed to Click-to-Chat
        }
      }

      // 2. Try file sharing if supported on mobile
      try {
        const pdfBytes = await generateBillPdfBytes({
          ...bill,
          customerName: formattedCustomerName,
        });
        const pdfFile = createBillPdfFile(
          pdfBytes,
          `Annapurna-Bill-${bill.orderId || bill.billNumber}.pdf`
        );

        if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
          await navigator.share({
            files: [pdfFile],
            title: `Bill ${bill.orderId || bill.billNumber}`,
            text: msg,
          });
          return;
        }
      } catch {
        // Fall back to link
      }

      const waLink = document.createElement('a');
      waLink.href = `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
      waLink.target = '_blank';
      waLink.rel = 'noopener noreferrer';
      document.body.appendChild(waLink);
      waLink.click();
      document.body.removeChild(waLink);

      setToastNotification(
        `WhatsApp opened for ${formattedCustomerName} — press Send in WhatsApp to complete.`
      );
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setToastNotification(`WhatsApp share: ${err.message}`);
      }
    }
  };

  // Show brief verification state while checking existing token on initial load
  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#FFFDF9] flex flex-col items-center justify-center p-4">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-sm font-semibold text-amber-900">Verifying secure session...</p>
      </div>
    );
  }

  // Mandatory Login Protection: If not authenticated & verified, show Login Screen first
  if (!adminToken || !isSessionVerified) {
    return <AdminLogin onLoginSuccess={handleAdminLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 select-text">
      {/* Primary Billing Workspace */}
      <BillingDashboard
        adminUsername={adminUsername}
        adminToken={adminToken}
        onLogout={handleAdminLogout}
        onBillCompleted={handleBillCompleted}
        onOpen3DModal={() => setIs3DModalOpen(true)}
        googleUser={googleUser}
        googleToken={googleToken}
        onGoogleAuthChange={(u, t) => {
          setGoogleUser(u);
          setGoogleToken(t);
        }}
        onShareWhatsApp={handleQuickWhatsAppShare}
        onPreviewPdf={handleOpenPdfPreview}
        onShowToast={(msg) => setToastNotification(msg)}
      />

      {/* Bill Success Modal */}
      {activeCompletedBill && (
        <BillSuccessModal
          bill={activeCompletedBill}
          onNewBill={() => setActiveCompletedBill(null)}
          onPreviewPdf={() => handleOpenPdfPreview(activeCompletedBill)}
          onRetrySync={handleRetrySync}
          isRetryingSync={isRetryingSync}
          adminToken={adminToken}
        />
      )}

      {/* Vector PDF Preview Modal */}
      {previewPdfBill && previewPdfUrl && (
        <PdfPreviewModal
          bill={previewPdfBill}
          pdfUrl={previewPdfUrl}
          onClose={handleClosePdfPreview}
          onShareWhatsApp={() => handleQuickWhatsAppShare(previewPdfBill)}
        />
      )}

      {/* Shift Bills History Drawer */}
      <RecentBillsDrawer
        bills={shiftBills}
        isOpen={isRecentDrawerOpen}
        onClose={() => setIsRecentDrawerOpen(false)}
        onSelectBill={handleOpenPdfPreview}
        onShareWhatsApp={handleQuickWhatsAppShare}
      />

      {/* 3D Thali Full-Screen Interactive Inspection Modal */}
      {is3DModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-4xl">
            <ThaliCanvas3D isModal onClose={() => setIs3DModalOpen(false)} />
          </div>
        </div>
      )}

      {/* Floating In-App Notification Toast */}
      {toastNotification && (
        <div className="fixed bottom-5 right-5 z-[60] max-w-md bg-slate-900 text-white text-xs sm:text-sm font-semibold px-4 py-3 rounded-2xl shadow-2xl border border-slate-700/60 animate-in fade-in slide-in-from-bottom-2 duration-200 flex items-center justify-between gap-3">
          <span>{toastNotification}</span>
          <button
            onClick={() => setToastNotification(null)}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
