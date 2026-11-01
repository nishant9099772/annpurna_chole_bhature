import React from 'react';
import {
  X,
  Receipt,
  FileText,
  Share2,
  ExternalLink,
  Download,
  Utensils,
  Package,
  CreditCard,
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { Bill } from '../types/billing';
import {
  generateBillPdfBytes,
  createBillPdfBlobUrl,
} from '../services/pdfGenerator';

interface BillDetailsModalProps {
  bill: Bill | null;
  onClose: () => void;
  onShareWhatsApp: (bill: Bill) => void;
  onRetrySync?: (bill: Bill) => void;
  isRetryingSync?: boolean;
  onPreviewPdf?: () => void;
}

export const BillDetailsModal: React.FC<BillDetailsModalProps> = ({
  bill,
  onClose,
  onShareWhatsApp,
  onRetrySync,
  isRetryingSync,
  onPreviewPdf,
}) => {
  if (!bill) return null;

  const handleDownloadPdf = async () => {
    try {
      const pdfBytes = await generateBillPdfBytes(bill);
      const blobUrl = createBillPdfBlobUrl(pdfBytes);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `Annpurna-Bill-${bill.orderId || bill.billNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`Could not download PDF: ${err.message}`);
    }
  };

  const isPack = bill.orderType === 'PACK';
  const hasDiscount = (bill.discountRupees || 0) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm text-slate-900">
                  {bill.orderId || bill.billNumber}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isPack
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {bill.orderTypeLabel}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                Bill #{bill.billNumber} • {bill.dateTimeKolkata}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-full transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-sm flex-1">
          {/* Customer & Payment Bar */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80">
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Customer Details
              </span>
              <p className="font-bold text-slate-900 mt-0.5">{bill.customerName}</p>
              <p className="font-mono text-xs text-slate-600">
                {bill.countryCode} {bill.mobileNumber}
              </p>
            </div>

            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Payment Info
              </span>
              <div className="flex items-center gap-1.5 mt-0.5 font-bold text-slate-800 text-xs">
                {bill.paymentMethod === 'UPI' && <Smartphone className="w-3.5 h-3.5 text-blue-600" />}
                {bill.paymentMethod === 'Card' && <CreditCard className="w-3.5 h-3.5 text-purple-600" />}
                {(!bill.paymentMethod || bill.paymentMethod === 'Cash') && (
                  <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                )}
                <span>{bill.paymentMethod || 'Cash'}</span>
              </div>
              <span className="text-[11px] text-slate-400 block mt-0.5">
                Account: {bill.userId || 'admin'}
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-100/80 px-3.5 py-2 text-xs font-semibold text-slate-600 grid grid-cols-12">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Rate</span>
              <span className="col-span-2 text-right">Amount</span>
            </div>
            <div className="divide-y divide-slate-100">
              {bill.items.map((item) => (
                <div key={item.id} className="px-3.5 py-2 text-xs grid grid-cols-12 items-center">
                  <span className="col-span-6 font-medium text-slate-800">{item.name}</span>
                  <span className="col-span-2 text-center font-mono text-slate-600">{item.quantity}</span>
                  <span className="col-span-2 text-right font-mono text-slate-600">
                    ₹{item.unitPriceRupees.toFixed(2)}
                  </span>
                  <span className="col-span-2 text-right font-mono font-bold text-slate-900">
                    ₹{item.lineTotalRupees.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing Totals Box */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span className="font-mono">₹{bill.subtotalRupees.toFixed(2)}</span>
            </div>

            {hasDiscount && (
              <div className="flex justify-between text-rose-600 font-medium">
                <span>Discount ({bill.discountPercent || 0}%):</span>
                <span className="font-mono">- ₹{(bill.discountAmountRupees ?? bill.discountRupees).toFixed(2)}</span>
              </div>
            )}

            <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm">
              <span className="font-bold text-slate-900">Grand Total:</span>
              <span className="font-mono font-extrabold text-blue-700 text-base">
                ₹{bill.grandTotalRupees.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Sync Status Banner */}
          <div className="p-3 rounded-xl border flex items-center justify-between text-xs bg-white">
            <div className="flex items-center gap-2">
              {bill.sheetsSyncStatus === 'synced' || bill.savedToSheets ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <div>
                    <span className="font-bold text-emerald-800">Synced to Google Sheets</span>
                    {bill.spreadsheetUrl && (
                      <a
                        href={bill.spreadsheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline block text-[11px] flex items-center gap-1"
                      >
                        <span>Open Spreadsheet</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  <div>
                    <span className="font-bold text-amber-900">Sync Pending / Failed</span>
                    <p className="text-[11px] text-slate-500">
                      {bill.sheetsSyncError || 'Not yet recorded in connected sheet'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {(!bill.savedToSheets || bill.sheetsSyncStatus === 'failed') && onRetrySync && (
              <button
                onClick={() => onRetrySync(bill)}
                disabled={isRetryingSync}
                className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetryingSync ? 'animate-spin' : ''}`} />
                <span>Retry Sync</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
          <button
            onClick={handleDownloadPdf}
            className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-xl border border-slate-300 text-xs flex items-center gap-1.5 transition shadow-xs"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Download PDF</span>
          </button>

          <button
            onClick={() => onShareWhatsApp(bill)}
            className="px-4 py-2 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition shadow-sm"
          >
            <Share2 className="w-4 h-4" />
            <span>Send WhatsApp</span>
          </button>
        </div>
      </div>
    </div>
  );
};
