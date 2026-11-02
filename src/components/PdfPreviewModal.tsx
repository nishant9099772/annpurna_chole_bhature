import React, { useState } from 'react';
import { X, Download, Printer, Share2, Receipt, FileText } from 'lucide-react';
import { Bill } from '../types/billing';
import { CopyMobileButton } from './CopyMobileButton';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import { printPosReceipt } from '../utils/posReceiptPrinter';

interface PdfPreviewModalProps {
  bill: Bill;
  pdfUrl: string;
  onClose: () => void;
  onShareWhatsApp: () => void;
}

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({
  bill,
  pdfUrl,
  onClose,
  onShareWhatsApp,
}) => {
  const [viewMode, setViewMode] = useState<'pos' | 'pdf'>('pos');
  const formattedCustomerName = formatCustomerNameWithJi(bill.customerName);
  const discPct = bill.discountPercent !== undefined ? bill.discountPercent : 0;
  const discAmt =
    bill.discountAmountRupees !== undefined ? bill.discountAmountRupees : bill.discountRupees || 0;
  const totalQty = bill.itemCount || bill.items.reduce((s, i) => s + i.quantity, 0);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `Annapurna-Bill-${bill.orderId || bill.billNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-6 bg-slate-950/65 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[93dvh] flex flex-col overflow-hidden">
        {/* Modal Top Bar */}
        <div className="px-3.5 sm:px-5 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-extrabold text-slate-900 text-sm sm:text-lg">
                POS Customer Bill Preview
              </h3>
              <span className="text-xs bg-blue-100 text-blue-900 font-mono font-bold px-2 py-0.5 rounded-md">
                {bill.orderId || bill.billNumber}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-1 flex-wrap">
              <span>
                Customer: <strong className="text-slate-900">{formattedCustomerName}</strong>
              </span>
              <span className="font-mono">
                ({bill.countryCode} {bill.mobileNumber})
              </span>
              <CopyMobileButton
                countryCode={bill.countryCode}
                mobileNumber={bill.mobileNumber}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Switch between Live POS Receipt and Vector PDF */}
            <div className="hidden sm:flex bg-slate-200/80 p-0.5 rounded-lg text-xs font-bold">
              <button
                type="button"
                onClick={() => setViewMode('pos')}
                className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition cursor-pointer ${
                  viewMode === 'pos' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>POS Receipt</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition cursor-pointer ${
                  viewMode === 'pdf' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>PDF View</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Receipt / PDF Viewer Area */}
        <div className="flex-1 bg-slate-100 p-2.5 sm:p-5 overflow-y-auto flex justify-center items-start">
          {viewMode === 'pos' ? (
            <div className="w-full max-w-md bg-white border border-slate-300 rounded-lg shadow-sm p-3.5 sm:p-5 text-slate-900 font-sans">
              {/* Restaurant Branding Header */}
              <div className="text-center border-b-2 border-dashed border-slate-300 pb-3 mb-3">
                <h2 className="text-base sm:text-xl font-black tracking-tight text-blue-900">
                  ANNAPURNA CHOLE BHATURE
                </h2>
                <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
                  Authentic North Indian Cuisine • POS Tax Invoice &amp; Receipt
                </p>
                <p className="text-xs font-bold text-slate-800 mt-1 font-mono">
                  Contact / WhatsApp: +91 8800896679
                </p>
                <span
                  className={`inline-block mt-2 px-2.5 py-0.5 rounded-md text-[11px] font-extrabold tracking-wide border ${
                    bill.orderType === 'PACK'
                      ? 'bg-blue-50 text-blue-800 border-blue-200'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}
                >
                  ORDER TYPE: {bill.orderType === 'PACK' ? 'PACK (TAKEAWAY)' : 'DINE IN'}
                </span>
              </div>

              {/* Bill Metadata */}
              <div className="text-xs space-y-1.5 border-b-2 border-dashed border-slate-300 pb-3 mb-3">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Unique Order ID:</span>
                  <span className="font-mono font-bold text-blue-800">{bill.orderId || bill.id}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Bill Number:</span>
                  <span className="font-mono font-bold text-slate-900">{bill.billNumber}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Date &amp; Time (IST):</span>
                  <span className="font-mono text-slate-800 text-right">{bill.dateTimeKolkata}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Customer Name:</span>
                  <span className="font-bold text-slate-900 text-right">{formattedCustomerName}</span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-slate-500 font-semibold">Customer Mobile:</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-semibold text-slate-900">
                      {bill.countryCode} {bill.mobileNumber}
                    </span>
                    <CopyMobileButton
                      countryCode={bill.countryCode}
                      mobileNumber={bill.mobileNumber}
                    />
                  </div>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 font-semibold">Payment Method:</span>
                  <span className="font-bold text-emerald-700">
                    {bill.paymentMethod || 'Cash'} ({bill.paymentStatus || 'Paid'})
                  </span>
                </div>
              </div>

              {/* Itemized Table */}
              <table className="w-full text-xs mb-3 border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-800 text-slate-900 font-extrabold uppercase text-[11px]">
                    <th className="py-1.5 text-left">Item</th>
                    <th className="py-1.5 text-center w-10">Qty</th>
                    <th className="py-1.5 text-right w-16">Price</th>
                    <th className="py-1.5 text-right w-20">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dotted divide-slate-200 font-mono">
                  {bill.items.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="py-2 font-sans font-semibold text-slate-900">
                        {idx + 1}. {item.name}
                      </td>
                      <td className="py-2 text-center text-slate-700">{item.quantity}</td>
                      <td className="py-2 text-right text-slate-700">
                        ₹{item.unitPriceRupees.toFixed(0)}
                      </td>
                      <td className="py-2 text-right font-bold text-slate-900">
                        ₹{item.lineTotalRupees.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals Breakdown */}
              <div className="border-t-2 border-slate-800 pt-3 space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-700">
                  <span className="font-semibold">
                    Subtotal ({totalQty} {totalQty === 1 ? 'item' : 'items'}):
                  </span>
                  <span className="font-mono font-bold">₹{bill.subtotalRupees.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="font-semibold">Discount Percentage:</span>
                  <span className="font-mono font-bold">{discPct}%</span>
                </div>
                <div className="flex justify-between text-rose-700 font-semibold">
                  <span>Discount Amount:</span>
                  <span className="font-mono">- ₹{discAmt.toFixed(2)}</span>
                </div>

                <div className="mt-2.5 p-3 bg-emerald-50 border-2 border-emerald-600 rounded-lg flex justify-between items-center">
                  <div>
                    <span className="font-black text-slate-900 text-xs sm:text-sm block">
                      FINAL PAYABLE AMOUNT
                    </span>
                    <span className="text-[10px] text-emerald-800 font-semibold">
                      Inclusive of all items • {bill.paymentMethod || 'Cash'}
                    </span>
                  </div>
                  <span className="font-mono font-black text-emerald-700 text-xl sm:text-2xl">
                    ₹{bill.grandTotalRupees.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Thank You Footer */}
              <div className="mt-4 pt-3 border-t-2 border-dashed border-slate-300 text-center text-[11px] text-slate-600 space-y-0.5">
                <p className="font-extrabold text-slate-900">
                  Thank you for visiting ANNAPURNA CHOLE BHATURE!
                </p>
                <p>We appreciate your patronage. Please visit again soon!</p>
                <p className="font-mono text-[10px] text-slate-500">
                  Support / WhatsApp: +91 8800896679
                </p>
              </div>
            </div>
          ) : (
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0`}
              className="w-full h-[58vh] rounded-lg shadow-sm bg-white border border-slate-300"
              title="Receipt PDF Preview"
            />
          )}
        </div>

        {/* Modal Actions */}
        <div className="px-3.5 sm:px-5 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              onClick={handleDownload}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Download PDF</span>
            </button>
            <button
              onClick={() => printPosReceipt(bill, '80mm')}
              className="px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer"
              title="Print formatted for 80mm thermal POS printer"
            >
              <Printer className="w-4 h-4 text-blue-700" />
              <span>Print 80mm POS</span>
            </button>
            <button
              onClick={() => printPosReceipt(bill, 'A4')}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg flex items-center gap-1.5 transition cursor-pointer"
              title="Print formatted for A4 paper"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span>Print A4</span>
            </button>
          </div>

          <button
            onClick={onShareWhatsApp}
            className="px-4 py-2 bg-[#25D366] hover:bg-[#20BD5A] text-white text-xs sm:text-sm font-bold rounded-lg flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>Share on WhatsApp</span>
          </button>
        </div>
      </div>
    </div>
  );
};
