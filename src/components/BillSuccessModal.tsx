import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  CheckCircle2,
  FileText,
  Share2,
  ExternalLink,
  PlusCircle,
  Download,
  AlertTriangle,
  Receipt,
  FileSpreadsheet,
  Utensils,
  Package,
  RefreshCw,
  ArrowRight,
} from 'lucide-react';
import { Bill } from '../types/billing';
import {
  generateBillPdfBytes,
  createBillPdfFile,
  createBillPdfBlobUrl,
} from '../services/pdfGenerator';

interface BillSuccessModalProps {
  bill: Bill;
  onNewBill: () => void;
  onPreviewPdf: () => void;
  onRetrySync?: (bill: Bill) => void;
  isRetryingSync?: boolean;
}

export const BillSuccessModal: React.FC<BillSuccessModalProps> = ({
  bill,
  onNewBill,
  onPreviewPdf,
  onRetrySync,
  isRetryingSync,
}) => {
  const [sharingStatus, setSharingStatus] = useState<string | null>(null);

  // Trigger celebratory confetti on mount
  useEffect(() => {
    try {
      confetti({
        particleCount: 55,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#2563EB', '#16A34A', '#F59E0B', '#3B82F6'],
      });
    } catch {
      // ignore in headless environments
    }
  }, []);

  const handleShareOnWhatsApp = async () => {
    setSharingStatus('Preparing bill...');

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

      const greetingMessage = `*ANNPURNA CHOLE BHATURE*
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
            text: greetingMessage,
          });
          onNewBill();
          return;
        }
      } catch {
        // Fall back to WhatsApp click-to-chat URL
      }

      // Open WhatsApp click-to-chat
      const waUrl = `https://wa.me/${fullPhone}?text=${encodeURIComponent(greetingMessage)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');

      // Auto-return workflow: automatically reset to fresh New Bill screen
      setTimeout(() => {
        onNewBill();
      }, 500);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('WhatsApp share error:', err);
        setSharingStatus(`Share failed: ${err.message}`);
      }
    }
  };

  const handleDownloadPdf = async () => {
    try {
      const pdfBytes = await generateBillPdfBytes(bill);
      const blobUrl = createBillPdfBlobUrl(pdfBytes);
      const downloadLink = document.createElement('a');
      downloadLink.href = blobUrl;
      downloadLink.download = `Annpurna-Bill-${bill.orderId || bill.billNumber}.pdf`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (err: any) {
      alert(`Could not download PDF: ${err.message}`);
    }
  };

  const isSynced = bill.sheetsSyncStatus === 'synced' || bill.savedToSheets;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/65 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-blue-100 w-full max-w-lg my-auto overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Success Header Banner */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-6 text-center relative">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-2 shadow-inner">
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Bill Saved & Completed!
          </h2>
          <p className="text-blue-100 text-xs sm:text-sm mt-0.5 font-medium">
            Permanently recorded in database & ready for customer delivery
          </p>

          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 bg-blue-950/40 px-3 py-1 rounded-full text-xs font-mono font-bold tracking-wide text-white border border-blue-300/30">
              <Receipt className="w-3.5 h-3.5 text-blue-200" />
              {bill.orderId || bill.billNumber}
            </span>

            <span className="inline-flex items-center gap-1 bg-white/20 px-3 py-1 rounded-full text-xs font-bold text-white border border-white/20">
              {bill.orderType === 'PACK' ? (
                <>
                  <Package className="w-3.5 h-3.5" />
                  <span>Pack</span>
                </>
              ) : (
                <>
                  <Utensils className="w-3.5 h-3.5" />
                  <span>Dine In</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Bill Details Content */}
        <div className="p-5 sm:p-6 space-y-4">
          {/* Customer & Time Info */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 flex items-center justify-between text-xs sm:text-sm">
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Customer Details
              </span>
              <p className="font-bold text-slate-900 mt-0.5">{bill.customerName}</p>
              <p className="font-mono text-xs text-slate-600">
                {bill.countryCode} {bill.mobileNumber}
              </p>
            </div>

            <div className="text-right">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Grand Total ({bill.paymentMethod || 'Cash'})
              </span>
              <span className="font-mono font-extrabold text-blue-700 text-lg block mt-0.5">
                ₹{bill.grandTotalRupees.toFixed(2)}
              </span>
              <span className="text-[10px] text-slate-400">
                {bill.itemCount || bill.items.reduce((s, i) => s + i.quantity, 0)} items
              </span>
            </div>
          </div>

          {/* Google Sheets Synchronization Badge */}
          <div
            className={`rounded-2xl p-3.5 border text-xs flex items-center justify-between ${
              isSynced
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/70 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  isSynced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {isSynced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              </div>
              <div>
                <p className="font-bold">
                  {isSynced ? 'Synced to Google Sheets' : 'Google Sheets Sync Pending'}
                </p>
                <p className="text-[11px] text-slate-500">
                  {isSynced
                    ? 'Row recorded in Bills & Bill Items tabs'
                    : bill.sheetsSyncError || 'Click Retry Sync to record to sheet'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isSynced && bill.spreadsheetUrl && (
                <a
                  href={bill.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-white border border-emerald-300 text-emerald-800 font-semibold rounded-lg text-xs hover:bg-emerald-50 transition flex items-center gap-1"
                >
                  <span>Open Sheet</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}

              {!isSynced && onRetrySync && (
                <button
                  onClick={() => onRetrySync(bill)}
                  disabled={isRetryingSync}
                  className="px-2.5 py-1.5 bg-amber-600 text-white font-semibold rounded-lg text-xs hover:bg-amber-700 transition flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isRetryingSync ? 'animate-spin' : ''}`} />
                  <span>Retry Sync</span>
                </button>
              )}
            </div>
          </div>

          {/* Action Buttons: WhatsApp Workflow & Auto-Return */}
          <div className="space-y-2 pt-1">
            <button
              onClick={handleShareOnWhatsApp}
              className="w-full py-3.5 px-4 bg-[#25D366] hover:bg-[#20ba59] active:scale-[0.99] text-white font-extrabold rounded-2xl shadow-md flex items-center justify-center gap-2 transition text-sm cursor-pointer"
            >
              <Share2 className="w-5 h-5" />
              <span>Send WhatsApp & Start New Bill</span>
              <ArrowRight className="w-4 h-4 ml-1" />
            </button>
            <p className="text-[11px] text-center text-slate-400">
              Opens WhatsApp chat with formatted bill and returns to a fresh New Bill screen.
            </p>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={handleDownloadPdf}
                className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <Download className="w-4 h-4 text-slate-500" />
                <span>Download PDF</span>
              </button>

              <button
                onClick={onNewBill}
                className="py-2.5 px-3 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Next New Bill</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
