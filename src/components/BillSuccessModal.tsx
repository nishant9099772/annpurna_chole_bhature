import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  CheckCircle2,
  Share2,
  ExternalLink,
  PlusCircle,
  Download,
  AlertTriangle,
  Receipt,
  Utensils,
  Package,
  RefreshCw,
  ArrowRight,
  Printer,
  Eye,
} from 'lucide-react';
import { Bill } from '../types/billing';
import {
  generateBillPdfBytes,
  createBillPdfFile,
  createBillPdfBlobUrl,
} from '../services/pdfGenerator';
import { CopyMobileButton } from './CopyMobileButton';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import { printPosReceipt } from '../utils/posReceiptPrinter';
import { apiFetch, parseApiJsonResponse } from '../utils/apiClient';

interface BillSuccessModalProps {
  bill: Bill;
  onNewBill: () => void;
  onPreviewPdf: () => void;
  onRetrySync?: (bill: Bill) => void;
  isRetryingSync?: boolean;
  adminToken?: string;
}

export const BillSuccessModal: React.FC<BillSuccessModalProps> = ({
  bill,
  onNewBill,
  onPreviewPdf,
  onRetrySync,
  isRetryingSync,
  adminToken,
}) => {
  const [sharingStatus, setSharingStatus] = useState<string | null>(null);
  const formattedCustomerName = formatCustomerNameWithJi(bill.customerName);
  const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
  const discAmt =
    bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;
  const totalQty = bill.itemCount || bill.items.reduce((s, i) => s + i.quantity, 0);

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
    setSharingStatus('Preparing WhatsApp receipt...');

    try {
      const cleanCountry = bill.countryCode.replace(/\D/g, '') || '91';
      const cleanMobile = bill.mobileNumber.replace(/\D/g, '').slice(-10);
      const fullPhone = `${cleanCountry}${cleanMobile}`;

      const itemsList = bill.items
        .map(
          (i) =>
            `• ${i.name} x ${i.quantity} (₹${i.unitPriceRupees.toFixed(2)}) = ₹${i.lineTotalRupees.toFixed(2)}`
        )
        .join('\n');

      const greetingMessage = `*ANNAPURNA CHOLE BHATURE*
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

      // 1. Check if server-side Official WhatsApp Business Cloud API is configured
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
            setSharingStatus(apiData.message || 'Sent automatically via WhatsApp Cloud API!');
            setTimeout(() => {
              onNewBill();
            }, 900);
            return;
          }
        } catch {
          // Proceed to Click-to-Chat fallback
        }
      }

      // 2. Try native Web Share API with PDF file on mobile devices if supported
      try {
        const pdfBytes = await generateBillPdfBytes(bill);
        const pdfFile = createBillPdfFile(
          pdfBytes,
          `Annapurna-Bill-${bill.orderId || bill.billNumber}.pdf`
        );

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

      // 3. Open WhatsApp Click-to-Chat with prefilled receipt
      const waUrl = `https://wa.me/${fullPhone}?text=${encodeURIComponent(greetingMessage)}`;
      const waLink = document.createElement('a');
      waLink.href = waUrl;
      waLink.target = '_blank';
      waLink.rel = 'noopener noreferrer';
      document.body.appendChild(waLink);
      waLink.click();
      document.body.removeChild(waLink);

      setSharingStatus('WhatsApp opened with prefilled bill — press Send in WhatsApp.');

      setTimeout(() => {
        onNewBill();
      }, 600);
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
      downloadLink.download = `Annapurna-Bill-${bill.orderId || bill.billNumber}.pdf`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (err: any) {
      setSharingStatus(`Could not download PDF: ${err.message}`);
    }
  };

  // Strictly truthful Google Sheets status check
  const isSynced = bill.savedToSheets === true && bill.sheetsSyncStatus === 'synced';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-slate-950/65 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-blue-100 w-full max-w-lg my-auto overflow-hidden animate-in zoom-in-95 duration-200 max-h-[94dvh] flex flex-col">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white p-4 sm:p-5 text-center relative shrink-0">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center mx-auto mb-1.5 shadow-inner">
            <CheckCircle2 className="w-5 h-5 text-white" />
          </div>
          <h2 className="text-base sm:text-xl font-black tracking-tight">
            ANNAPURNA CHOLE BHATURE
          </h2>
          <p className="text-blue-100 text-[11px] sm:text-xs mt-0.5 font-medium">
            Contact / WhatsApp: +91 8800896679 • POS Tax Invoice &amp; Receipt
          </p>

          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 bg-blue-950/40 px-2.5 py-0.5 rounded-md text-xs font-mono font-bold tracking-wide text-white border border-blue-300/30">
              <Receipt className="w-3.5 h-3.5 text-blue-200" />
              {bill.orderId || bill.billNumber}
            </span>

            <span className="inline-flex items-center gap-1 bg-white/20 px-2.5 py-0.5 rounded-md text-xs font-bold text-white border border-white/20">
              {bill.orderType === 'PACK' ? (
                <>
                  <Package className="w-3.5 h-3.5" />
                  <span>Pack (Takeaway)</span>
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

        {/* Receipt Body */}
        <div className="p-3.5 sm:p-5 space-y-3 overflow-y-auto flex-1">
          {/* Customer & Metadata */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3 flex items-center justify-between gap-2 text-xs">
            <div className="min-w-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Customer Details
              </span>
              <p className="font-bold text-slate-900 text-sm mt-0.5 truncate">{formattedCustomerName}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="font-mono text-xs text-slate-600">
                  {bill.countryCode} {bill.mobileNumber}
                </span>
                <CopyMobileButton
                  countryCode={bill.countryCode}
                  mobileNumber={bill.mobileNumber}
                />
              </div>
              <span className="text-[11px] text-slate-500 font-mono block mt-1">
                {bill.dateTimeKolkata}
              </span>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Final Payable ({bill.paymentMethod || 'Cash'})
              </span>
              <span className="font-mono font-black text-emerald-700 text-lg sm:text-xl block mt-0.5">
                ₹{bill.grandTotalRupees.toFixed(2)}
              </span>
              <span className="text-[11px] text-slate-500 font-semibold">
                {totalQty} {totalQty === 1 ? 'item' : 'items'} • #{bill.billNumber}
              </span>
            </div>
          </div>

          {/* Itemized POS Summary */}
          <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
            <div className="bg-slate-100 px-3 py-2 font-bold text-slate-700 grid grid-cols-12 text-[11px] uppercase">
              <span className="col-span-6">Item Purchased</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Price</span>
              <span className="col-span-2 text-right">Amount</span>
            </div>
            <div className="divide-y divide-slate-100 max-h-32 sm:max-h-36 overflow-y-auto">
              {bill.items.map((item, idx) => (
                <div key={item.id || idx} className="px-3 py-2 grid grid-cols-12 items-center font-mono">
                  <span className="col-span-6 font-sans font-semibold text-slate-900 truncate">
                    {item.name}
                  </span>
                  <span className="col-span-2 text-center text-slate-700">{item.quantity}</span>
                  <span className="col-span-2 text-right text-slate-600">
                    ₹{item.unitPriceRupees.toFixed(0)}
                  </span>
                  <span className="col-span-2 text-right font-bold text-slate-900">
                    ₹{item.lineTotalRupees.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
            <div className="bg-slate-50 px-3 py-2.5 border-t border-slate-200 space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-mono font-bold">₹{bill.subtotalRupees.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Discount Percentage:</span>
                <span className="font-mono font-bold">{discPct}%</span>
              </div>
              <div className="flex justify-between text-rose-600 font-semibold">
                <span>Discount Amount:</span>
                <span className="font-mono">- ₹{discAmt.toFixed(2)}</span>
              </div>
              <div className="pt-1.5 border-t border-slate-200 flex justify-between items-center text-sm">
                <span className="font-extrabold text-slate-900">Final Payable Amount:</span>
                <span className="font-mono font-black text-emerald-700 text-base">
                  ₹{bill.grandTotalRupees.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* Truthful Google Sheets Synchronization Status */}
          <div
            className={`rounded-lg p-3 border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
              isSynced
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/80 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
              <div
                className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                  isSynced ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {isSynced ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              </div>
              <div className="min-w-0">
                <p className="font-bold">
                  {isSynced
                    ? 'Saved Successfully to Google Sheets'
                    : 'Saved Locally — Pending Google Sheets Sync'}
                </p>
                <p className="text-[11px] text-slate-600 break-words">
                  {isSynced
                    ? 'Verified row written in Bills & Bill Items tabs'
                    : bill.sheetsSyncError || 'Queued safely; tap Retry Sync to record in Google Sheets'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              {isSynced && bill.spreadsheetUrl && (
                <a
                  href={bill.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-white border border-emerald-300 text-emerald-800 font-semibold rounded-md text-xs hover:bg-emerald-50 transition flex items-center gap-1"
                >
                  <span>Open Sheet</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}

              {!isSynced && onRetrySync && (
                <button
                  onClick={() => onRetrySync(bill)}
                  disabled={isRetryingSync}
                  className="px-3 py-1.5 bg-amber-600 text-white font-semibold rounded-md text-xs hover:bg-amber-700 transition flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isRetryingSync ? 'animate-spin' : ''}`} />
                  <span>{isRetryingSync ? 'Syncing...' : 'Retry Sync'}</span>
                </button>
              )}
            </div>
          </div>

          {sharingStatus && (
            <p className="text-xs font-semibold text-blue-700 text-center bg-blue-50 py-1.5 px-3 rounded-lg">
              {sharingStatus}
            </p>
          )}

          {/* Action Buttons: WhatsApp, Print 80mm/A4, Preview/Download PDF, Next Bill */}
          <div className="space-y-2 pt-1">
            <button
              onClick={handleShareOnWhatsApp}
              className="w-full py-3 px-4 bg-[#25D366] hover:bg-[#20ba59] active:scale-[0.99] text-white font-extrabold rounded-lg shadow-sm flex items-center justify-center gap-2 transition text-xs sm:text-sm cursor-pointer"
            >
              <Share2 className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
              <span className="truncate">Share Bill on WhatsApp ({bill.countryCode} {bill.mobileNumber})</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </button>
            <p className="text-[11px] text-center text-slate-500">
              Opens WhatsApp with the prefilled receipt — press <strong>Send</strong> in WhatsApp to deliver.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <button
                onClick={() => printPosReceipt(bill, '80mm')}
                className="py-2.5 px-2.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>80mm Print</span>
              </button>

              <button
                onClick={onPreviewPdf}
                className="py-2.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>View Receipt</span>
              </button>

              <button
                onClick={handleDownloadPdf}
                className="py-2.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF</span>
              </button>

              <button
                onClick={onNewBill}
                className="py-2.5 px-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>Next Bill</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
