/**
 * Annpurna Chole Bhature - Main Application Entry
 * Full-stack orchestrator managing admin login, billing dashboard,
 * Google Sheets workspace token, PDF receipt viewer, and 3D Thali showcase.
 */
import React, { useState, useEffect } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { Bill } from './types/billing';
import { initAuth, googleLogout } from './services/firebaseAuth';
import {
  generateBillPdfBytes,
  createBillPdfBlobUrl,
  createBillPdfFile,
} from './services/pdfGenerator';
import { AdminLogin } from './components/AdminLogin';
import { BillingDashboard } from './components/BillingDashboard';
import { BillSuccessModal } from './components/BillSuccessModal';
import { PdfPreviewModal } from './components/PdfPreviewModal';
import { RecentBillsDrawer } from './components/RecentBillsDrawer';
import { ThaliCanvas3D } from './components/ThaliCanvas3D';

export default function App() {
  // Admin Authentication State
  const [adminToken, setAdminToken] = useState<string | null>(() => {
    return localStorage.getItem('annpurna_admin_token') || 'annpurna-admin-session-active';
  });
  const [adminUsername, setAdminUsername] = useState<string>(() => {
    return localStorage.getItem('annpurna_admin_user') || 'admin';
  });

  // Google Workspace Auth State (for Google Sheets sync)
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);

  // Completed Bills in current shift
  const [shiftBills, setShiftBills] = useState<Bill[]>([]);
  const [activeCompletedBill, setActiveCompletedBill] = useState<Bill | null>(null);
  const [isRetryingSync, setIsRetryingSync] = useState(false);

  // Modals & Drawers
  const [previewPdfBill, setPreviewPdfBill] = useState<Bill | null>(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [isRecentDrawerOpen, setIsRecentDrawerOpen] = useState(false);
  const [is3DModalOpen, setIs3DModalOpen] = useState(false);
  const [toastNotification, setToastNotification] = useState<string | null>(null);

  // Auto-dismiss toast after 4 seconds
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => setToastNotification(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

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

  // Fetch recent bills from backend on login
  useEffect(() => {
    if (!adminToken) return;

    fetch('/api/bills', {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.bills) {
          setShiftBills(data.bills);
        }
      })
      .catch((err) => console.log('Could not load prior bills:', err));
  }, [adminToken]);

  // Handle Admin Login Success
  const handleAdminLoginSuccess = (token: string, username: string) => {
    localStorage.setItem('annpurna_admin_token', token);
    localStorage.setItem('annpurna_admin_user', username);
    setAdminToken(token);
    setAdminUsername(username);
  };

  // Handle Admin Logout
  const handleAdminLogout = () => {
    if (adminToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem('annpurna_admin_token');
    localStorage.removeItem('annpurna_admin_user');
    setAdminToken(null);
    googleLogout().catch(() => {});
  };

  // Handle Bill Completion
  const handleBillCompleted = (newBill: Bill) => {
    setShiftBills((prev) => [newBill, ...prev]);
    setActiveCompletedBill(newBill);
  };

  // Trigger PDF Preview Modal
  const handleOpenPdfPreview = async (bill: Bill) => {
    try {
      const pdfBytes = await generateBillPdfBytes(bill);
      const url = createBillPdfBlobUrl(pdfBytes);
      setPreviewPdfBill(bill);
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

  // Retry Sync Handler
  const handleRetrySync = async (bill: Bill) => {
    if (!googleToken) {
      setToastNotification('Please connect Google Sheets first to sync records.');
      return;
    }

    setIsRetryingSync(true);
    try {
      const res = await fetch(`/api/bills/${bill.id}/retry-sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          googleAccessToken: googleToken,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Retry sync failed');
      }

      setToastNotification(`Bill ${bill.orderId || bill.billNumber} successfully synced to Google Sheets!`);
      if (activeCompletedBill && activeCompletedBill.id === bill.id) {
        setActiveCompletedBill(data.bill);
      }
      setShiftBills((prev) =>
        prev.map((b) => (b.id === bill.id ? data.bill : b))
      );
    } catch (err: any) {
      setToastNotification(`Sync failed: ${err.message}`);
    } finally {
      setIsRetryingSync(false);
    }
  };

  // WhatsApp sharing handler with Order ID, itemized breakdown, and auto-return
  const handleQuickWhatsAppShare = async (bill: Bill) => {
    try {
      const cleanCountry = bill.countryCode.replace(/\D/g, '') || '91';
      const cleanMobile = bill.mobileNumber.replace(/\D/g, '');
      const fullPhone = `${cleanCountry}${cleanMobile}`;

      const itemsList = bill.items
        .map((i) => `• ${i.name} x ${i.quantity} = ₹${i.lineTotalRupees.toFixed(2)}`)
        .join('\n');

      const discountPart =
        (bill.discountPercent || bill.discountRupees || 0) > 0
          ? `\nDiscount (${bill.discountPercent || 0}%): -₹${(bill.discountAmountRupees ?? bill.discountRupees).toFixed(2)}`
          : '';

      const msg = `*ANNPURNA CHOLE BHATURE*
Customer Bill & Receipt
--------------------------------
Order ID: ${bill.orderId || bill.id}
Bill Number: ${bill.billNumber}
Order Type: ${bill.orderTypeLabel}
Date & Time: ${bill.dateTimeKolkata}
Customer: ${bill.customerName} (${bill.countryCode} ${bill.mobileNumber})
--------------------------------
ITEMS:
${itemsList}
--------------------------------
Subtotal: ₹${bill.subtotalRupees.toFixed(2)}${discountPart}
*Final Amount: ₹${bill.grandTotalRupees.toFixed(2)}*
Payment Method: ${bill.paymentMethod || 'Cash'}
Status: Paid & Completed
--------------------------------
Thank you for dining with us! For feedback or queries, contact +91 8800896679.`;

      // Try file sharing if supported
      try {
        const pdfBytes = await generateBillPdfBytes(bill);
        const pdfFile = createBillPdfFile(pdfBytes, `Annpurna-Bill-${bill.orderId || bill.billNumber}.pdf`);

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

      setToastNotification(`WhatsApp opened for ${bill.customerName}.`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setToastNotification(`WhatsApp share: ${err.message}`);
      }
    }
  };

  // If Admin is not logged in, show Admin Login view
  if (!adminToken) {
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
      />

      {/* Bill Success Modal */}
      {activeCompletedBill && (
        <BillSuccessModal
          bill={activeCompletedBill}
          onNewBill={() => setActiveCompletedBill(null)}
          onPreviewPdf={() => handleOpenPdfPreview(activeCompletedBill)}
          onRetrySync={handleRetrySync}
          isRetryingSync={isRetryingSync}
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
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-slate-900 text-white text-xs sm:text-sm font-medium px-4 py-3 rounded-2xl shadow-2xl border border-slate-700/60 animate-in fade-in slide-in-from-bottom-2 duration-200 flex items-center justify-between gap-3">
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
