import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  X,
  Filter,
  Calendar,
  CreditCard,
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  FileText,
  Share2,
  ChevronLeft,
  ChevronRight,
  Receipt,
  User,
  Phone,
  ArrowUpDown,
} from 'lucide-react';
import { Bill, PaymentMethod } from '../types/billing';
import { BillDetailsModal } from './BillDetailsModal';
import { CopyMobileButton } from './CopyMobileButton';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import {
  hydrateAndSyncBillsWithServer,
  savePersistentBills,
  upsertPersistentBill,
} from '../utils/persistentBillsStorage';

interface BillHistoryViewProps {
  adminToken: string;
  googleToken: string | null;
  onShareWhatsApp: (bill: Bill) => void;
  onRefreshMetrics?: () => void;
}

export const BillHistoryView: React.FC<BillHistoryViewProps> = ({
  adminToken,
  googleToken,
  onShareWhatsApp,
  onRefreshMetrics,
}) => {
  const [bills, setBills] = useState<Bill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrderType, setSelectedOrderType] = useState<string>('all');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('all');
  const [selectedSyncStatus, setSelectedSyncStatus] = useState<string>('all');
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const itemsPerPage = 20;

  // Selected Bill for Full Modal Inspection
  const [selectedBillForDetails, setSelectedBillForDetails] = useState<Bill | null>(null);
  const [retryingBillId, setRetryingBillId] = useState<string | null>(null);

  // Fetch Bills from Server (hydrating persistent client bills first so cold-start instances have full history)
  const fetchBills = useCallback(async (page: number = 1) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      await hydrateAndSyncBillsWithServer(adminToken, googleToken);

      const params = new URLSearchParams({
        page: String(page),
        limit: String(itemsPerPage),
      });

      if (searchTerm.trim()) params.append('search', searchTerm.trim());
      if (selectedOrderType !== 'all') params.append('orderType', selectedOrderType);
      if (selectedPaymentMethod !== 'all') params.append('paymentMethod', selectedPaymentMethod);
      if (selectedSyncStatus !== 'all') params.append('syncStatus', selectedSyncStatus);
      if (selectedDateFilter !== 'all') params.append('dateFilter', selectedDateFilter);

      const res = await fetch(`/api/bills?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to load bills (HTTP ${res.status})`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error('Server returned unexpected non-JSON response');
      }

      const data = await res.json();
      const loadedBills: Bill[] = Array.isArray(data.bills) ? data.bills : [];
      if (loadedBills.length > 0) {
        savePersistentBills(loadedBills);
      }
      setBills(loadedBills);
      setTotalPages(data.totalPages || 1);
      setTotalCount(data.total || 0);
      setCurrentPage(data.page || 1);
    } catch (err: any) {
      console.error('Fetch bills error:', err);
      setErrorMessage(err.message || 'Could not load bills');
    } finally {
      setIsLoading(false);
    }
  }, [adminToken, googleToken, searchTerm, selectedOrderType, selectedPaymentMethod, selectedSyncStatus, selectedDateFilter]);

  // Refetch when filters or search change
  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchBills(1);
    }, 250);
    return () => clearTimeout(timeout);
  }, [fetchBills]);

  // Handle Retry Sync (supports Server Service Account, Apps Script Web App, or Client OAuth Token)
  const handleRetrySync = async (bill: Bill) => {
    setRetryingBillId(bill.id);
    setErrorMessage(null);
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

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Sync retry failed');
      }

      const syncedBill: Bill = data.bill || {
        ...bill,
        savedToSheets: true,
        sheetsSyncStatus: 'synced',
      };

      upsertPersistentBill(syncedBill);

      // Update local state with the synced bill
      setBills((prev) =>
        prev.map((b) => (b.id === bill.id ? syncedBill : b))
      );

      if (selectedBillForDetails && selectedBillForDetails.id === bill.id) {
        setSelectedBillForDetails(syncedBill);
      }

      try {
        const raw = localStorage.getItem('annpurna_pending_sync_bills');
        if (raw) {
          const list: Bill[] = JSON.parse(raw);
          const remaining = list.filter((b) => b.orderId !== bill.orderId && b.id !== bill.id);
          localStorage.setItem('annpurna_pending_sync_bills', JSON.stringify(remaining));
        }
      } catch {
        // ignore
      }

      window.dispatchEvent(
        new CustomEvent('annpurna:toast', {
          detail: { message: `Bill ${bill.orderId || bill.billNumber} synced to Google Sheets!` },
        })
      );

      if (onRefreshMetrics) onRefreshMetrics();
    } catch (err: any) {
      setErrorMessage(`Sync failed for ${bill.orderId || bill.billNumber}: ${err.message}`);
    } finally {
      setRetryingBillId(null);
    }
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedOrderType('all');
    setSelectedPaymentMethod('all');
    setSelectedSyncStatus('all');
    setSelectedDateFilter('all');
  };

  const hasActiveFilters =
    searchTerm.trim() !== '' ||
    selectedOrderType !== 'all' ||
    selectedPaymentMethod !== 'all' ||
    selectedSyncStatus !== 'all' ||
    selectedDateFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* Search Bar & Instant Filter Controls */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs space-y-3">
        {/* Main Search Input */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Order ID (e.g. ORD-...), Customer name, Bill #, or Mobile..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition placeholder:text-slate-400"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition"
              title="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Pills Row */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Date Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedDateFilter}
              onChange={(e) => setSelectedDateFilter(e.target.value)}
              className="bg-transparent focus:outline-hidden text-xs font-semibold cursor-pointer text-slate-800"
            >
              <option value="all">All Dates</option>
              <option value="24h">Last 24 Hours (Rolling)</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="this_month">This Month</option>
            </select>
          </div>

          {/* Payment Method Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700">
            <CreditCard className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedPaymentMethod}
              onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              className="bg-transparent focus:outline-hidden text-xs font-semibold cursor-pointer text-slate-800"
            >
              <option value="all">All Payments</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
            </select>
          </div>

          {/* Order Type Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedOrderType}
              onChange={(e) => setSelectedOrderType(e.target.value)}
              className="bg-transparent focus:outline-hidden text-xs font-semibold cursor-pointer text-slate-800"
            >
              <option value="all">All Types</option>
              <option value="DINE_IN">Dine In</option>
              <option value="PACK">Pack (Takeaway)</option>
            </select>
          </div>

          {/* Sync Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700">
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedSyncStatus}
              onChange={(e) => setSelectedSyncStatus(e.target.value)}
              className="bg-transparent focus:outline-hidden text-xs font-semibold cursor-pointer text-slate-800"
            >
              <option value="all">All Sync States</option>
              <option value="synced">Synced</option>
              <option value="failed">Failed / Pending</option>
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearAllFilters}
              className="text-xs text-blue-600 hover:text-blue-800 font-semibold px-2 py-1 transition"
            >
              Reset Filters
            </button>
          )}

          <div className="ml-auto text-xs text-slate-400 font-medium">
            Showing {bills.length} of {totalCount} records
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => fetchBills(currentPage)}
            className="text-xs font-bold text-rose-900 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Bill List Table / Cards */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mb-2" />
            <p className="text-xs font-medium">Loading historical records...</p>
          </div>
        ) : bills.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Receipt className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <h4 className="font-bold text-slate-800 text-sm">No Bills Found</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {hasActiveFilters
                ? 'No bills match your current search and filter criteria. Try clearing filters.'
                : 'No bills have been created yet. Generated bills will permanently persist here.'}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="mt-3 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition"
              >
                Clear All Filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {bills.map((bill) => {
              const isSynced = bill.sheetsSyncStatus === 'synced' || bill.savedToSheets;
              const isRetrying = retryingBillId === bill.id;

              return (
                <div
                  key={bill.id}
                  className="p-4 sm:p-5 hover:bg-slate-50/80 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  {/* Left Column: Order ID, Type, Customer */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-xs text-blue-800 bg-blue-50 border border-blue-200/60 px-2 py-0.5 rounded-md">
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

                      {/* Payment Method Badge */}
                      <span className="text-[10px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                        {bill.paymentMethod || 'Cash'}
                      </span>

                      {/* Sync Status Badge */}
                      {isSynced ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-2 py-0.5 rounded-md">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Synced</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200/60 px-2 py-0.5 rounded-md">
                          <AlertCircle className="w-3 h-3 text-amber-600" />
                          <span>Failed Sync</span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-600 pt-0.5 flex-wrap">
                      <span className="font-bold text-slate-900">{formatCustomerNameWithJi(bill.customerName)}</span>
                      <span className="text-slate-300">•</span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono">{bill.countryCode} {bill.mobileNumber}</span>
                        <CopyMobileButton
                          countryCode={bill.countryCode}
                          mobileNumber={bill.mobileNumber}
                        />
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="text-slate-400 text-[11px]">{bill.dateTimeKolkata}</span>
                    </div>

                    <div className="text-[11px] text-slate-500 truncate max-w-md">
                      {bill.itemDetailsSummary || bill.items.map((i) => `${i.name} (${i.quantity})`).join(', ')}
                    </div>
                  </div>

                  {/* Right Column: Amount & Action Buttons */}
                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    <div className="text-left sm:text-right">
                      <div className="font-mono font-extrabold text-slate-900 text-base">
                        ₹{bill.grandTotalRupees.toFixed(2)}
                      </div>
                      <span className="text-[10px] text-slate-400 block">
                        {(bill.discountPercent || bill.discountRupees) ? (
                          <span className="text-rose-600 font-semibold mr-1">
                            Disc {bill.discountPercent || 0}% (-₹{bill.discountAmountRupees ?? bill.discountRupees}) •
                          </span>
                        ) : null}
                        {bill.itemCount || bill.items.reduce((s, i) => s + i.quantity, 0)} items
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Retry Sync Button if unsynced */}
                      {!isSynced && (
                        <button
                          onClick={() => handleRetrySync(bill)}
                          disabled={isRetrying}
                          className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-semibold rounded-lg border border-amber-200 transition flex items-center gap-1 disabled:opacity-50"
                          title="Retry Sync to Google Sheets"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                          <span className="hidden sm:inline">Retry</span>
                        </button>
                      )}

                      {/* WhatsApp Share Button */}
                      <button
                        onClick={() => onShareWhatsApp(bill)}
                        className="px-2.5 py-1.5 bg-[#25D366]/10 hover:bg-[#25D366]/20 text-[#1b9a4a] text-xs font-semibold rounded-lg transition flex items-center gap-1"
                        title="Share on WhatsApp"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">WhatsApp</span>
                      </button>

                      {/* View Details Button */}
                      <button
                        onClick={() => setSelectedBillForDetails(bill)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg transition flex items-center gap-1"
                        title="View Full Bill Details"
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        <span>View</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div>
              Page <span className="font-bold">{currentPage}</span> of{' '}
              <span className="font-bold">{totalPages}</span> ({totalCount} total bills)
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fetchBills(currentPage - 1)}
                disabled={currentPage <= 1 || isLoading}
                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40 transition flex items-center gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>

              <button
                onClick={() => fetchBills(currentPage + 1)}
                disabled={currentPage >= totalPages || isLoading}
                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-40 transition flex items-center gap-1"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bill Details Modal */}
      <BillDetailsModal
        bill={selectedBillForDetails}
        onClose={() => setSelectedBillForDetails(null)}
        onShareWhatsApp={onShareWhatsApp}
        onRetrySync={handleRetrySync}
        isRetryingSync={retryingBillId === selectedBillForDetails?.id}
      />
    </div>
  );
};
