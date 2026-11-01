import React from 'react';
import { X, Download, Printer, Share2 } from 'lucide-react';
import { Bill } from '../types/billing';

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
  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `Annpurna-Bill-${bill.billNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = pdfUrl;
    document.body.appendChild(iframe);
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Top Bar */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-amber-50/70">
          <div>
            <h3 className="font-bold text-amber-950 text-base sm:text-lg flex items-center gap-2">
              <span>Receipt Preview</span>
              <span className="text-xs bg-amber-200/80 text-amber-900 font-mono px-2 py-0.5 rounded-md">
                {bill.billNumber}
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Customer: {bill.customerName} ({bill.countryCode} {bill.mobileNumber})
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-full transition"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* PDF Viewer Frame */}
        <div className="flex-1 bg-slate-100 p-2 sm:p-4 overflow-hidden flex justify-center items-center">
          <iframe
            src={`${pdfUrl}#toolbar=0&navpanes=0`}
            className="w-full h-[58vh] rounded-lg shadow-sm bg-white border border-slate-300"
            title="Receipt PDF Preview"
          />
        </div>

        {/* Modal Actions */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 transition"
            >
              <Download className="w-4 h-4 text-slate-600" />
              <span>Download PDF</span>
            </button>
            <button
              onClick={handlePrint}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5 transition"
            >
              <Printer className="w-4 h-4 text-slate-600" />
              <span className="hidden sm:inline">Print Receipt</span>
            </button>
          </div>

          <button
            onClick={onShareWhatsApp}
            className="px-4 py-2 bg-[#25D366] hover:bg-[#20BD5A] text-white text-xs sm:text-sm font-bold rounded-xl flex items-center gap-2 shadow-sm transition active:scale-95 cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>Share on WhatsApp</span>
          </button>
        </div>
      </div>
    </div>
  );
};
