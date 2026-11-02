import React from 'react';
import { X, Receipt, ExternalLink, FileText, Share2, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { Bill } from '../types/billing';
import { CopyMobileButton } from './CopyMobileButton';
import { formatCustomerNameWithJi } from '../utils/customerFormat';

interface RecentBillsDrawerProps {
  bills: Bill[];
  isOpen: boolean;
  onClose: () => void;
  onSelectBill: (bill: Bill) => void;
  onShareWhatsApp: (bill: Bill) => void;
}

export const RecentBillsDrawer: React.FC<RecentBillsDrawerProps> = ({
  bills,
  isOpen,
  onClose,
  onSelectBill,
  onShareWhatsApp,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-200 safe-top safe-bottom">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-blue-600" />
              <span>Shift Bills Record</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {bills.length} {bills.length === 1 ? 'bill' : 'bills'} logged during current session
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List of Bills */}
        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-2.5">
          {bills.length === 0 ? (
            <div className="text-center py-16 px-4">
              <div className="w-11 h-11 bg-blue-50 rounded-lg flex items-center justify-center mx-auto mb-3 text-blue-600">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-700 text-sm">No Bills Created Yet</h3>
              <p className="text-xs text-slate-400 mt-1">
                Completed bills will appear here with instant options to reprint or share via WhatsApp.
              </p>
            </div>
          ) : (
            bills.map((bill) => {
              const isSynced = bill.sheetsSyncStatus === 'synced' || bill.savedToSheets;

              return (
                <div
                  key={bill.id}
                  className="bg-white border border-slate-200 hover:border-blue-400 rounded-lg p-3.5 shadow-xs transition hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-mono font-bold text-blue-900 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                          {bill.orderId || bill.billNumber}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            bill.orderType === 'PACK'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {bill.orderTypeLabel}
                        </span>
                        {isSynced ? (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Synced</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                            <AlertCircle className="w-3 h-3" />
                            <span>Pending</span>
                          </span>
                        )}
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm mt-1.5 truncate">{formatCustomerNameWithJi(bill.customerName)}</h4>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-xs text-slate-500 font-mono">
                          {bill.countryCode} {bill.mobileNumber}
                        </span>
                        <CopyMobileButton
                          countryCode={bill.countryCode}
                          mobileNumber={bill.mobileNumber}
                        />
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-base font-black text-slate-900 font-mono">
                        ₹{bill.grandTotalRupees.toFixed(2)}
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {bill.itemCount || bill.items.reduce((s, i) => s + i.quantity, 0)} items
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <span className="text-slate-400 text-[11px]">{bill.dateTimeKolkata}</span>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onSelectBill(bill)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md flex items-center gap-1 transition cursor-pointer"
                        title="View PDF"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>PDF</span>
                      </button>

                      <button
                        onClick={() => onShareWhatsApp(bill)}
                        className="px-2.5 py-1 bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#1b9a4a] font-semibold rounded-md flex items-center gap-1 transition cursor-pointer"
                        title="Share via WhatsApp"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>WhatsApp</span>
                      </button>

                      {bill.spreadsheetUrl && (
                        <a
                          href={bill.spreadsheetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-slate-400 hover:text-blue-700 transition"
                          title="Open in Google Sheets"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
