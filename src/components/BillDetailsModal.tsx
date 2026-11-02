import React from 'react';
import {
  X,
  Receipt,
  Share2,
  ExternalLink,
  Download,
  CreditCard,
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Printer,
} from 'lucide-react';
import { Bill } from '../types/billing';
import {
  generateBillPdfBytes,
  createBillPdfBlobUrl,
} from '../services/pdfGenerator';
import { CopyMobileButton } from './CopyMobileButton';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import { printPosReceipt } from '../utils/posReceiptPrinter';

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
}) => {
  if (!bill) return null;

  const handleDownloadPdf = async () => {
    try {
      const pdfBytes = await generateBillPdfBytes(bill);
      const blobUrl = createBillPdfBlobUrl(pdfBytes);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `Annapurna-Bill-${bill.orderId || bill.billNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      console.error('Could not download PDF:', err.message);
    }
  };

  const isPack = bill.orderType === 'PACK';
  const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
  const discAmt =
    bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;
  const isSynced = bill.savedToSheets === true && bill.sheetsSyncStatus === 'synced';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 max-h-[93dvh] flex flex-col">
        {/* Modal Header */}
        <div className="p-3.5 sm:p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-xs sm:text-sm text-slate-900">
                  {bill.orderId || bill.billNumber}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                    isPack
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {bill.orderTypeLabel}
                </span>
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 font-mono mt-0.5 truncate">
                ANNAPURNA CHOLE BHATURE • Bill #{bill.billNumber}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-3.5 sm:p-5 overflow-y-auto space-y-3.5 text-sm flex-1">
          {/* Customer & Payment Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50/80 p-3 rounded-lg border border-slate-200/80">
            <div>
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Customer Details
              </span>
              <p className="font-bold text-slate-900 mt-0.5">{formatCustomerNameWithJi(bill.customerName)}</p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="font-mono text-xs text-slate-600">
                  {bill.countryCode} {bill.mobileNumber}
                </span>
                <CopyMobileButton
                  countryCode={bill.countryCode}
                  mobileNumber={bill.mobileNumber}
                />
              </div>
              <span className="text-[11px] text-slate-400 font-mono block mt-1">
                {bill.dateTimeKolkata}
              </span>
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
                <span>{bill.paymentMethod || 'Cash'} ({bill.paymentStatus || 'Paid'})</span>
              </div>
              <span className="text-[11px] text-slate-500 block mt-1 font-mono">
                Support: +91 8800896679
              </span>
            </div>
          </div>

          {/* Items Table */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-100/80 px-3 py-2 text-xs font-semibold text-slate-600 grid grid-cols-12">
              <span className="col-span-6">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Price</span>
              <span className="col-span-2 text-right">Amount</span>
            </div>
            <div className="divide-y divide-slate-100">
              {bill.items.map((item) => (
                <div key={item.id} className="px-3 py-2 text-xs grid grid-cols-12 items-center">
                  <span className="col-span-6 font-medium text-slate-800 truncate">{item.name}</span>
                  <span className="col-span-2 text-center font-mono text-slate-600">{item.quantity}</span>
                  <span className="col-span-2 text-right font-mono text-slate-600">
                    ₹{item.unitPriceRupees.toFixed(0)}
                  </span>
                  <span className="col-span-2 text-right font-mono font-bold text-slate-900">
                    ₹{item.lineTotalRupees.toFixed(0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Pricing Totals Box (Always displays Subtotal, Discount %, Discount Amount, Final Payable) */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span className="font-mono font-semibold">₹{bill.subtotalRupees.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-slate-600">
              <span>Discount Percentage:</span>
              <span className="font-mono font-semibold">{discPct}%</span>
            </div>

            <div className="flex justify-between text-rose-600 font-medium">
              <span>Discount Amount:</span>
              <span className="font-mono">- ₹{discAmt.toFixed(2)}</span>
            </div>

            <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm">
              <span className="font-bold text-slate-900">Final Payable Amount:</span>
              <span className="font-mono font-extrabold text-emerald-700 text-base">
                ₹{bill.grandTotalRupees.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Sync Status Banner */}
          <div className="p-3 rounded-lg border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs bg-white">
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              {isSynced ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 sm:mt-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-emerald-800">Saved in Google Sheets</span>
                    {bill.spreadsheetUrl && (
                      <a
                        href={bill.spreadsheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-[11px] flex items-center gap-1"
                      >
                        <span>Open Spreadsheet</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-amber-900">Saved Locally — Pending Sheets Sync</span>
                    <p className="text-[11px] text-slate-500 break-words">
                      {bill.sheetsSyncError || 'Not yet recorded in connected Google Sheet'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {!isSynced && onRetrySync && (
              <button
                onClick={() => onRetrySync(bill)}
                disabled={isRetryingSync}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-md text-xs flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer shrink-0 self-end sm:self-center"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetryingSync ? 'animate-spin' : ''}`} />
                <span>{isRetryingSync ? 'Syncing...' : 'Retry Sync'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              onClick={handleDownloadPdf}
              className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-lg border border-slate-300 text-xs flex items-center gap-1.5 transition shadow-xs cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-500" />
              <span>PDF</span>
            </button>
            <button
              onClick={() => printPosReceipt(bill, '80mm')}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <Printer className="w-4 h-4 text-blue-700" />
              <span>Print 80mm</span>
            </button>
            <button
              onClick={() => printPosReceipt(bill, 'A4')}
              className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>Print A4</span>
            </button>
          </div>

          <button
            onClick={() => onShareWhatsApp(bill)}
            className="px-4 py-2 bg-[#25D366] hover:bg-[#20ba59] text-white font-bold rounded-lg text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>Send WhatsApp</span>
          </button>
        </div>
      </div>
    </div>
  );
};
