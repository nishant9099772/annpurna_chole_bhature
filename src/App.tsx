/**
 * Annapurna Chole Bhature - Main Application Entry
 * Full-stack orchestrator managing 3-Profile RBAC authentication (Admin, Billing, Order),
 * automatic 24-hour session expiration, synchronized live kitchen orders,
 * Google Sheets workspace token, PDF receipt viewer, and 3D Thali showcase.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Bill, UserRole } from './types/billing';
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
import { apiFetch, parseApiJsonResponse } from './utils/apiClient';
import { AdminLogin } from './components/AdminLogin';
import { BillingDashboard } from './components/BillingDashboard';
import { OrderDashboard } from './components/OrderDashboard';
import { BillSuccessModal } from './components/BillSuccessModal';
import { PdfPreviewModal } from './components/PdfPreviewModal';
import { RecentBillsDrawer } from './components/RecentBillsDrawer';
import { ThaliCanvas3D } from './components/ThaliCanvas3D';

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 Hours

export default function App() {
  // Authentication State — strictly verified against backend /api/auth/me
  const [adminToken, setAdminToken] = useState<string | null>(() => {
    const stored = localStorage.getItem('annpurna_admin_token');
    if (!stored || !stored.startsWith('acb.')) {
      localStorage.removeItem('annpurna_admin_token');
      return null;
    }
    return stored;
  });
  const [adminUsername, setAdminUsername] = useState<string>(() => {
    return localStorage.getItem('annpurna_admin_user') || 'annapurna_admin';
  });
  const [userRole, setUserRole] = useState<UserRole>(() => {
    const storedRole = localStorage.getItem('annpurna_user_role');
    if (storedRole === 'billing' || storedRole === 'order') return storedRole;
    return 'admin';
  });
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(() => {
    const rawExp = localStorage.getItem('annpurna_session_expires_at');
    const parsed = rawExp ? Number(rawExp) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  });

  const [isSessionVerified, setIsSessionVerified] = useState<boolean>(false);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(() => {
    const stored = localStorage.getItem('annpurna_admin_token');
    return Boolean(stored && stored.startsWith('acb.'));
  });

  // Google Workspace Auth State (for Google Sheets sync — Admin only)
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

  // Handle Logout — ONLY clears authentication session token; NEVER deletes sales/bill/order records
  const handleAdminLogout = useCallback(() => {
    if (adminToken) {
      apiFetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem('annpurna_admin_token');
    localStorage.removeItem('annpurna_admin_user');
    localStorage.removeItem('annpurna_user_role');
    localStorage.removeItem('annpurna_session_expires_at');
    setAdminToken(null);
    setSessionExpiresAt(null);
    setIsSessionVerified(false);
    setActiveCompletedBill(null);
  }, [adminToken]);

  // Automatic 24-Hour Session Expiration Watcher
  useEffect(() => {
    if (!adminToken || !sessionExpiresAt) return;

    const checkExpiry = () => {
      if (Date.now() >= sessionExpiresAt) {
        handleAdminLogout();
        setToastNotification('Your 24-hour session has expired. Please log in again.');
      }
    };

    checkExpiry();
    const timer = setInterval(checkExpiry, 1000);
    return () => clearInterval(timer);
  }, [adminToken, sessionExpiresAt, handleAdminLogout]);

  // Verify existing session token with server on mount and token changes
  useEffect(() => {
    if (!adminToken) {
      setIsSessionVerified(false);
      setIsCheckingSession(false);
      return;
    }

    let cancelled = false;
    setIsCheckingSession(true);

    apiFetch('/api/auth/me', {
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
          const resolvedRole: UserRole =
            data.role === 'billing' || data.role === 'order' ? data.role : 'admin';
          setUserRole(resolvedRole);
          localStorage.setItem('annpurna_user_role', resolvedRole);
          if (typeof data.expiresAt === 'number' && data.expiresAt > 0) {
            setSessionExpiresAt(data.expiresAt);
            localStorage.setItem('annpurna_session_expires_at', String(data.expiresAt));
          }
        } else {
          throw new Error('Not authenticated');
        }
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem('annpurna_admin_token');
        localStorage.removeItem('annpurna_admin_user');
        localStorage.removeItem('annpurna_user_role');
        localStorage.removeItem('annpurna_session_expires_at');
        setAdminToken(null);
        setSessionExpiresAt(null);
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

  // Bidirectionally hydrate & fetch persistent bills from backend after session is verified (Admin & Billing only)
  useEffect(() => {
    if (!adminToken || !isSessionVerified) return;
    if (userRole === 'order') return;

    hydrateAndSyncBillsWithServer(adminToken, userRole === 'admin' ? googleToken : null)
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
  }, [adminToken, isSessionVerified, userRole, googleToken, handleAdminLogout]);

  // Handle Login Success (3-Profile Aware)
  const handleAdminLoginSuccess = (
    token: string,
    username: string,
    role: UserRole,
    expiresAt?: number
  ) => {
    const effectiveExpiresAt =
      typeof expiresAt === 'number' && expiresAt > Date.now()
        ? expiresAt
        : Date.now() + SESSION_DURATION_MS;

    localStorage.setItem('annpurna_admin_token', token);
    localStorage.setItem('annpurna_admin_user', username);
    localStorage.setItem('annpurna_user_role', role);
    localStorage.setItem('annpurna_session_expires_at', String(effectiveExpiresAt));

    setAdminUsername(username);
    setUserRole(role);
    setSessionExpiresAt(effectiveExpiresAt);
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

  // Retry Sync Handler (Admin Only)
  const handleRetrySync = async (bill: Bill) => {
    if (userRole !== 'admin') return;
    setIsRetryingSync(true);
    try {
      const customSheetId = localStorage.getItem('annpurna_custom_sheet_id') || undefined;
      const res = await apiFetch(`/api/bills/${bill.id}/retry-sheets`, {
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
          const apiRes = await apiFetch(`/api/bills/${bill.id}/send-whatsapp`, {
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

  // Profile 3: Annapurna Order — Dedicated Kitchen / Worker Dashboard Only (Zero Billing or Financial Data)
  if (userRole === 'order') {
    return (
      <div className="min-h-screen bg-slate-100 select-text">
        <OrderDashboard
          token={adminToken}
          username={adminUsername}
          userRole="order"
          onLogout={handleAdminLogout}
          sessionExpiresAt={sessionExpiresAt}
          onShowToast={(msg) => setToastNotification(msg)}
        />

        {toastNotification && (
          <div className="fixed bottom-5 left-3 right-3 sm:left-auto sm:right-5 z-[60] max-w-md bg-slate-900 text-white text-xs sm:text-sm font-semibold px-3.5 py-2.5 rounded-lg shadow-2xl border border-slate-700/60 flex items-center justify-between gap-3">
            <span className="break-words">{toastNotification}</span>
            <button
              onClick={() => setToastNotification(null)}
              className="text-slate-400 hover:text-white p-1 rounded-md cursor-pointer shrink-0"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  // Profile 1 (Annapurna Admin) & Profile 2 (Annapurna Billing)
  return (
    <div className="min-h-screen bg-slate-50 select-text">
      <BillingDashboard
        adminUsername={adminUsername}
        adminToken={adminToken}
        userRole={userRole}
        sessionExpiresAt={sessionExpiresAt}
        onLogout={handleAdminLogout}
        onBillCompleted={handleBillCompleted}
        onOpen3DModal={() => {
          if (userRole === 'admin') setIs3DModalOpen(true);
        }}
        googleUser={userRole === 'admin' ? googleUser : null}
        googleToken={userRole === 'admin' ? googleToken : null}
        onGoogleAuthChange={(u, t) => {
          if (userRole === 'admin') {
            setGoogleUser(u);
            setGoogleToken(t);
          }
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
          onRetrySync={userRole === 'admin' ? handleRetrySync : undefined}
          isRetryingSync={isRetryingSync}
          adminToken={adminToken}
          userRole={userRole}
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

      {/* 3D Thali Full-Screen Interactive Inspection Modal (Admin Only) */}
      {userRole === 'admin' && is3DModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-xs">
          <div className="w-full max-w-4xl">
            <ThaliCanvas3D isModal onClose={() => setIs3DModalOpen(false)} />
          </div>
        </div>
      )}

      {/* Floating In-App Notification Toast */}
      {toastNotification && (
        <div className="fixed bottom-16 md:bottom-5 left-3 right-3 sm:left-auto sm:right-5 z-[60] max-w-md bg-slate-900 text-white text-xs sm:text-sm font-semibold px-3.5 py-2.5 rounded-lg shadow-2xl border border-slate-700/60 animate-in fade-in slide-in-from-bottom-2 duration-200 flex items-center justify-between gap-3">
          <span className="break-words">{toastNotification}</span>
          <button
            onClick={() => setToastNotification(null)}
            className="text-slate-400 hover:text-white p-1 rounded-md cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
