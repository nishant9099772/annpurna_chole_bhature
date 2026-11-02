import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Receipt,
  Award,
  DollarSign,
  User,
  Eye,
  FileText,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Bill, MonthlyReportData, DailySalesData } from '../types/billing';
import { CopyMobileButton } from './CopyMobileButton';
import { formatCustomerNameWithJi } from '../utils/customerFormat';
import {
  buildMonthlyReportFromBills,
  hydrateAndSyncBillsWithServer,
  loadPersistentBills,
  savePersistentBills,
} from '../utils/persistentBillsStorage';
import { apiFetch, parseApiJsonResponse } from '../utils/apiClient';

interface MonthlySalesCalendarProps {
  adminToken: string;
  onSelectBill: (bill: Bill) => void;
  onShareWhatsApp: (bill: Bill) => void;
  onPreviewPdf: (bill: Bill) => void;
}

export const MonthlySalesCalendar: React.FC<MonthlySalesCalendarProps> = ({
  adminToken,
  onSelectBill,
  onShareWhatsApp,
  onPreviewPdf,
}) => {
  const now = new Date();
  const [currentYear, setCurrentYear] = useState<number>(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(now.getMonth() + 1); // 1-12
  const [report, setReport] = useState<MonthlyReportData | null>(() =>
    buildMonthlyReportFromBills(loadPersistentBills(), now.getFullYear(), now.getMonth() + 1)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDayNumber, setSelectedDayNumber] = useState<number>(now.getDate());

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const fetchMonthlyReport = useCallback(
    async (year: number, month: number, forceHydrate: boolean = false) => {
      // Immediately render from persistent ledger so switching months feels instantaneous
      const immediateLocal = loadPersistentBills();
      setReport(buildMonthlyReportFromBills(immediateLocal, year, month));

      setIsLoading(true);
      try {
        await hydrateAndSyncBillsWithServer(adminToken, undefined, undefined, forceHydrate);

        const res = await apiFetch(`/api/reports/monthly?year=${year}&month=${month}`, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            Accept: 'application/json',
          },
        });

        const { ok, status, data } = await parseApiJsonResponse<any>(res);

        if (!ok) {
          throw new Error(data?.error || `Failed to load monthly data (HTTP ${status})`);
        }

        if (data?.report) {
          const reportBills: Bill[] = [];
          if (Array.isArray(data.report.dailyData)) {
            for (const day of data.report.dailyData) {
              if (Array.isArray(day.bills)) {
                reportBills.push(...day.bills);
              }
            }
          }
          if (reportBills.length > 0) {
            savePersistentBills(reportBills);
          }
          setReport(data.report);
        }
      } catch (err: any) {
        const localPersistent = loadPersistentBills();
        setReport(buildMonthlyReportFromBills(localPersistent, year, month));
      } finally {
        setIsLoading(false);
      }
    },
    [adminToken]
  );

  useEffect(() => {
    fetchMonthlyReport(currentYear, currentMonth, false);
  }, [fetchMonthlyReport, currentYear, currentMonth]);

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
    setSelectedDayNumber(1);
  };

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
    setSelectedDayNumber(1);
  };

  const handleCurrentMonthJump = () => {
    const today = new Date();
    setCurrentYear(today.getFullYear());
    setCurrentMonth(today.getMonth() + 1);
    setSelectedDayNumber(today.getDate());
  };

  const firstDayOfWeek = new Date(Date.UTC(currentYear, currentMonth - 1, 1)).getUTCDay();

  const selectedDayData: DailySalesData | undefined = report?.dailyData.find(
    (d) => d.dayNumber === selectedDayNumber
  );

  return (
    <div className="space-y-3.5 sm:space-y-5">
      {/* Calendar Header with Controls */}
      <div className="bg-white rounded-lg sm:rounded-xl border border-slate-200 p-3.5 sm:p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold shrink-0">
            <CalendarIcon className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              Monthly Sales Calendar
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-500">
              Daily transaction drill-down • Asia/Kolkata (IST)
            </p>
          </div>
        </div>

        {/* Month & Year Navigation */}
        <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-between md:justify-end">
          <button
            onClick={handleCurrentMonthJump}
            className="px-2.5 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
          >
            This Month
          </button>

          <div className="flex items-center bg-slate-100 rounded-md p-1 border border-slate-200">
            <button
              onClick={handlePrevMonth}
              title="Previous Month"
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 px-1.5">
              <select
                value={currentMonth}
                onChange={(e) => {
                  setCurrentMonth(parseInt(e.target.value, 10));
                  setSelectedDayNumber(1);
                }}
                className="bg-transparent text-xs font-bold text-slate-800 border-none focus:outline-hidden cursor-pointer"
              >
                {monthNames.map((m, idx) => (
                  <option key={m} value={idx + 1}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={currentYear}
                onChange={(e) => {
                  setCurrentYear(parseInt(e.target.value, 10));
                  setSelectedDayNumber(1);
                }}
                className="bg-transparent text-xs font-bold text-slate-800 border-none focus:outline-hidden cursor-pointer"
              >
                {[2024, 2025, 2026, 2027, 2028].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleNextMonth}
              title="Next Month"
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => fetchMonthlyReport(currentYear, currentMonth, true)}
            disabled={isLoading}
            title="Refresh Report"
            className="p-2 text-slate-600 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 border border-slate-200 rounded-md transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Monthly Summary Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        <div className="bg-white rounded-lg sm:rounded-xl border border-slate-200 p-3 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider truncate">
              {monthNames[currentMonth - 1]} Revenue
            </span>
            <div className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <DollarSign className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-base sm:text-2xl font-black text-slate-900 font-mono truncate">
            ₹{(report?.totalRevenueRupees || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
            Across {report?.totalBills || 0} completed orders
          </div>
        </div>

        <div className="bg-white rounded-lg sm:rounded-xl border border-slate-200 p-3 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Bills</span>
            <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <Receipt className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-base sm:text-2xl font-black text-slate-900 font-mono">
            {report?.totalBills || 0}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
            Orders in {monthNames[currentMonth - 1]}
          </div>
        </div>

        <div className="bg-white rounded-lg sm:rounded-xl border border-slate-200 p-3 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Avg Ticket</span>
            <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-base sm:text-2xl font-black text-slate-900 font-mono">
            ₹{(report?.averageBillValueRupees || 0).toFixed(0)}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate">
            Average order value
          </div>
        </div>

        <div className="bg-white rounded-lg sm:rounded-xl border border-slate-200 p-3 sm:p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Best Day</span>
            <div className="w-6 h-6 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Award className="w-3.5 h-3.5" />
            </div>
          </div>
          {report?.bestSalesDay ? (
            <div>
              <div className="text-base sm:text-2xl font-black text-amber-600 font-mono truncate">
                ₹{report.bestSalesDay.revenueRupees.toLocaleString('en-IN')}
              </div>
              <div className="text-[10px] sm:text-[11px] font-semibold text-slate-700 mt-0.5 truncate">
                Day {report.bestSalesDay.dayNumber} ({report.bestSalesDay.billsCount} orders)
              </div>
            </div>
          ) : (
            <div>
              <div className="text-base sm:text-xl font-bold text-slate-400">—</div>
              <div className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">No sales yet</div>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid & Transaction Breakdown Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-5">
        {/* Calendar Grid (7 cols on lg) */}
        <div className="lg:col-span-7 bg-white rounded-lg sm:rounded-xl border border-slate-200 p-3 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-1.5">
            <h3 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
              <span>{report?.monthLabel || `${monthNames[currentMonth - 1]} ${currentYear}`}</span>
              <span className="text-[11px] text-slate-400 font-normal hidden sm:inline">
                (Tap any date to inspect bills)
              </span>
            </h3>
            {report?.bestSalesDay && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                Peak: Day {report.bestSalesDay.dayNumber} (₹{report.bestSalesDay.revenueRupees})
              </span>
            )}
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1.5 text-center text-[10px] sm:text-xs font-bold text-slate-400">
            <span>SUN</span>
            <span>MON</span>
            <span>TUE</span>
            <span>WED</span>
            <span>THU</span>
            <span>FRI</span>
            <span>SAT</span>
          </div>

          {/* Calendar Day Cells */}
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="h-14 sm:h-20 rounded-md bg-slate-50/60 border border-transparent"
              />
            ))}

            {report?.dailyData.map((day) => {
              const isSelected = day.dayNumber === selectedDayNumber;
              const isPeakDay = report.bestSalesDay?.dayNumber === day.dayNumber;
              const hasSales = day.revenueRupees > 0;
              const isToday =
                now.getFullYear() === currentYear &&
                now.getMonth() + 1 === currentMonth &&
                now.getDate() === day.dayNumber;

              return (
                <button
                  key={day.date}
                  onClick={() => setSelectedDayNumber(day.dayNumber)}
                  className={`h-14 sm:h-20 p-1 sm:p-2 rounded-md text-left transition-all relative flex flex-col justify-between border cursor-pointer overflow-hidden ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600 ring-1 ring-blue-300 shadow-xs'
                      : isPeakDay
                      ? 'bg-amber-50/70 border-amber-300 text-slate-800 hover:border-amber-400'
                      : hasSales
                      ? 'bg-emerald-50/40 border-emerald-200 hover:border-blue-300 text-slate-800'
                      : 'bg-white border-slate-100 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`text-[11px] sm:text-xs font-black leading-none ${
                        isSelected
                          ? 'text-white'
                          : isToday
                          ? 'px-1 py-0.5 rounded bg-blue-100 text-blue-700'
                          : 'text-slate-800'
                      }`}
                    >
                      {day.dayNumber}
                    </span>

                    {day.billsCount > 0 && (
                      <span
                        className={`text-[9px] font-bold px-1 rounded-xs ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-200/80 text-slate-700'
                        }`}
                      >
                        {day.billsCount}
                      </span>
                    )}
                  </div>

                  <div className="mt-auto w-full">
                    {hasSales ? (
                      <div
                        className={`text-[9px] sm:text-xs font-black tracking-tight leading-none truncate ${
                          isSelected ? 'text-white' : 'text-emerald-700'
                        }`}
                      >
                        ₹{day.revenueRupees.toLocaleString('en-IN')}
                      </div>
                    ) : (
                      <div
                        className={`text-[9px] ${
                          isSelected ? 'text-blue-200' : 'text-slate-300'
                        }`}
                      >
                        —
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2 text-[11px] text-slate-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-100 border border-emerald-300 inline-block" />
                Sales
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-100 border border-amber-300 inline-block" />
                Peak Day
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                Selected
              </span>
            </div>
            <div className="text-[10px] text-slate-400">Asia/Kolkata (IST)</div>
          </div>
        </div>

        {/* Selected Day Transactions Drill-down (5 cols on lg) */}
        <div className="lg:col-span-5 bg-white rounded-lg sm:rounded-xl border border-slate-200 p-3.5 sm:p-5 shadow-xs flex flex-col">
          <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 mb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">
                Day {selectedDayNumber} Transactions
              </h3>
              <p className="text-xs text-slate-500">
                {selectedDayData
                  ? `${selectedDayData.dayName}, ${selectedDayNumber} ${monthNames[currentMonth - 1]} ${currentYear}`
                  : ''}
              </p>
            </div>
            {selectedDayData && (
              <div className="text-right">
                <div className="text-sm font-black text-slate-900 font-mono">
                  ₹{selectedDayData.revenueRupees.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedDayData.billsCount} order{selectedDayData.billsCount === 1 ? '' : 's'}
                </div>
              </div>
            )}
          </div>

          {/* Transactions List */}
          <div className="flex-1 overflow-y-auto max-h-[420px] space-y-2.5 pr-0.5">
            {selectedDayData && selectedDayData.bills.length > 0 ? (
              selectedDayData.bills.map((bill) => (
                <div
                  key={bill.id}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-blue-300 transition-all text-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-black text-blue-600">
                          {bill.orderId || bill.billNumber}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-xs ${
                            bill.orderType === 'PACK'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {bill.orderTypeLabel || (bill.orderType === 'PACK' ? 'Pack' : 'Dine In')}
                        </span>
                      </div>
                      <div className="text-slate-800 font-semibold mt-1 flex items-center gap-1.5 flex-wrap">
                        <User className="w-3 h-3 text-slate-400 shrink-0" />
                        <span>{formatCustomerNameWithJi(bill.customerName)}</span>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600 font-mono">
                          {bill.countryCode || '+91'} {bill.mobileNumber}
                        </span>
                        <CopyMobileButton
                          countryCode={bill.countryCode || '+91'}
                          mobileNumber={bill.mobileNumber}
                        />
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-slate-900 font-mono">
                        ₹{bill.grandTotalRupees}
                      </div>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-xs inline-block mt-0.5 ${
                          bill.savedToSheets || bill.sheetsSyncStatus === 'synced'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {bill.savedToSheets || bill.sheetsSyncStatus === 'synced'
                          ? 'Synced'
                          : 'Pending'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white rounded p-2 border border-slate-100 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">Items: </span>
                    {bill.itemDetailsSummary ||
                      bill.items.map((i) => `${i.name} (${i.quantity})`).join(', ')}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
                    <span>
                      Subtotal: ₹{bill.subtotalRupees}
                      {bill.discountPercent || bill.discountRupees ? (
                        <span className="text-rose-600 ml-1">
                          (Disc {bill.discountPercent || 0}%: -₹
                          {bill.discountAmountRupees ?? bill.discountRupees})
                        </span>
                      ) : null}
                    </span>
                    <span className="text-slate-400">{bill.billTime || bill.dateTimeKolkata}</span>
                  </div>

                  <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200">
                    <button
                      onClick={() => onSelectBill(bill)}
                      className="flex-1 py-1.5 px-2 rounded bg-white border border-slate-200 text-slate-700 font-semibold text-[11px] hover:bg-slate-100 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <Eye className="w-3 h-3 text-slate-500" />
                      View
                    </button>
                    <button
                      onClick={() => onPreviewPdf(bill)}
                      className="py-1.5 px-2.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[11px] hover:bg-blue-100 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      <FileText className="w-3 h-3" />
                      Receipt
                    </button>
                    <button
                      onClick={() => onShareWhatsApp(bill)}
                      className="py-1.5 px-2.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px] hover:bg-emerald-100 flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    >
                      WhatsApp
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-10 text-center text-slate-400">
                <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-300 stroke-1" />
                <p className="font-semibold text-xs text-slate-500">No transactions on this date</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Orders generated on Day {selectedDayNumber} will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
