import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Receipt,
  Award,
  DollarSign,
  Clock,
  User,
  Phone,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
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
  const [report, setReport] = useState<MonthlyReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
    async (year: number, month: number) => {
      setIsLoading(true);
      setError(null);
      try {
        // Hydrate server with any persistent client bills first so cold-started serverless instances have full history
        await hydrateAndSyncBillsWithServer(adminToken);

        const res = await fetch(`/api/reports/monthly?year=${year}&month=${month}`, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
            Accept: 'application/json',
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to load monthly data (HTTP ${res.status})`);
        }

        const data = await res.json();
        if (data.report) {
          // Merge any bills returned in the report into the persistent ledger
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
        } else {
          throw new Error('Invalid monthly report response');
        }
      } catch (err: any) {
        console.error('Error fetching monthly report, using persistent ledger fallback:', err);
        const localPersistent = loadPersistentBills();
        if (localPersistent.length > 0) {
          setReport(buildMonthlyReportFromBills(localPersistent, year, month));
        } else {
          setError(err.message || 'Could not load sales report');
        }
      } finally {
        setIsLoading(false);
      }
    },
    [adminToken]
  );

  useEffect(() => {
    fetchMonthlyReport(currentYear, currentMonth);
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

  // Find first day of the week (0 = Sunday, 1 = Monday, etc.)
  const firstDayOfWeek = new Date(Date.UTC(currentYear, currentMonth - 1, 1)).getUTCDay();

  // Selected Day info
  const selectedDayData: DailySalesData | undefined = report?.dailyData.find(
    (d) => d.dayNumber === selectedDayNumber
  );

  return (
    <div className="space-y-6">
      {/* Calendar Header with Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 md:p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Monthly Sales Calendar
            </h2>
            <p className="text-xs text-slate-500">
              Interactive sales analytics & daily transaction drill-down • Auto-resets on the 1st
            </p>
          </div>
        </div>

        {/* Month & Year Navigation */}
        <div className="flex items-center flex-wrap gap-2 w-full md:w-auto justify-between md:justify-end">
          <button
            onClick={handleCurrentMonthJump}
            className="px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
          >
            This Month
          </button>

          <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
            <button
              onClick={handlePrevMonth}
              title="Previous Month"
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded-md transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 px-2">
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
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-white rounded-md transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={() => fetchMonthlyReport(currentYear, currentMonth)}
            disabled={isLoading}
            title="Refresh Report"
            className="p-2 text-slate-600 hover:text-blue-600 bg-slate-100 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Monthly Summary Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {/* Total Revenue */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">
              {report?.monthLabel || 'Month'} Revenue
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            ₹{(report?.totalRevenueRupees || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Total sales across {report?.totalBills || 0} completed orders
          </div>
        </div>

        {/* Total Bills */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Bills</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {report?.totalBills || 0}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Orders processed in {monthNames[currentMonth - 1]}
          </div>
        </div>

        {/* Average Bill Value */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Avg Order Value</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            ₹{(report?.averageBillValueRupees || 0).toFixed(0)}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Average ticket size per customer
          </div>
        </div>

        {/* Best Sales Day */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Best Sales Day</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Award className="w-4 h-4" />
            </div>
          </div>
          {report?.bestSalesDay ? (
            <div>
              <div className="text-2xl font-black text-amber-600">
                ₹{report.bestSalesDay.revenueRupees.toLocaleString('en-IN')}
              </div>
              <div className="text-[11px] font-semibold text-slate-700 mt-1">
                Day {report.bestSalesDay.dayNumber} ({report.bestSalesDay.billsCount} orders)
              </div>
            </div>
          ) : (
            <div>
              <div className="text-xl font-bold text-slate-400">—</div>
              <div className="text-[11px] text-slate-400 mt-1">No sales recorded yet</div>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid & Transaction Breakdown Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Calendar Grid (8 cols on lg) */}
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-4 md:p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span>{report?.monthLabel || `${monthNames[currentMonth - 1]} ${currentYear}`}</span>
              <span className="text-xs text-slate-400 font-normal">
                (Click any date to view orders)
              </span>
            </h3>
            {report?.bestSalesDay && (
              <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500" />
                Peak: Day {report.bestSalesDay.dayNumber} (₹{report.bestSalesDay.revenueRupees})
              </span>
            )}
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1.5 mb-2 text-center text-xs font-bold text-slate-400">
            <span>SUN</span>
            <span>MON</span>
            <span>TUE</span>
            <span>WED</span>
            <span>THU</span>
            <span>FRI</span>
            <span>SAT</span>
          </div>

          {/* Calendar Day Cells */}
          <div className="grid grid-cols-7 gap-1.5">
            {/* Blank leading cells */}
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="h-16 md:h-20 rounded-lg bg-slate-50/60 border border-transparent"
              />
            ))}

            {/* Days of the month */}
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
                  className={`h-16 md:h-20 p-1.5 md:p-2 rounded-lg text-left transition-all relative flex flex-col justify-between border cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-300 shadow-md'
                      : isPeakDay
                      ? 'bg-amber-50/70 border-amber-300 text-slate-800 hover:border-amber-400'
                      : hasSales
                      ? 'bg-emerald-50/40 border-emerald-200 hover:border-blue-300 text-slate-800'
                      : 'bg-white border-slate-100 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-black ${
                        isSelected
                          ? 'text-white'
                          : isToday
                          ? 'w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center'
                          : 'text-slate-800'
                      }`}
                    >
                      {day.dayNumber}
                    </span>

                    {isPeakDay && !isSelected && (
                      <span className="text-[10px] font-bold text-amber-600">★</span>
                    )}

                    {day.billsCount > 0 && (
                      <span
                        className={`text-[10px] font-bold px-1 rounded-sm ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-200/80 text-slate-700'
                        }`}
                      >
                        {day.billsCount}
                      </span>
                    )}
                  </div>

                  <div className="mt-auto">
                    {hasSales ? (
                      <div
                        className={`text-[11px] md:text-xs font-black tracking-tight leading-none ${
                          isSelected ? 'text-white' : 'text-emerald-700'
                        }`}
                      >
                        ₹{day.revenueRupees.toLocaleString('en-IN')}
                      </div>
                    ) : (
                      <div
                        className={`text-[10px] ${
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

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-100 border border-emerald-300 inline-block" />
                Sales Recorded
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-amber-100 border border-amber-300 inline-block" />
                Peak Sales Day
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 inline-block" />
                Selected
              </span>
            </div>
            <div className="text-[11px] text-slate-400">Timezone: Asia/Kolkata (IST)</div>
          </div>
        </div>

        {/* Selected Day Transactions Drill-down (5 cols on lg) */}
        <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-4 md:p-6 shadow-xs flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
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
                <div className="text-sm font-black text-slate-900">
                  ₹{selectedDayData.revenueRupees.toLocaleString('en-IN')}
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedDayData.billsCount} order{selectedDayData.billsCount === 1 ? '' : 's'}
                </div>
              </div>
            )}
          </div>

          {/* Transactions List */}
          <div className="flex-1 overflow-y-auto max-h-[460px] space-y-3 pr-1">
            {selectedDayData && selectedDayData.bills.length > 0 ? (
              selectedDayData.bills.map((bill) => (
                <div
                  key={bill.id}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-blue-300 transition-all text-xs space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-blue-600">{bill.billNumber}</span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-sm ${
                            bill.orderType === 'PACK'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {bill.orderTypeLabel || (bill.orderType === 'PACK' ? 'Pack' : 'Dine In')}
                        </span>
                      </div>
                      <div className="text-slate-800 font-semibold mt-1 flex items-center gap-1.5 flex-wrap">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{formatCustomerNameWithJi(bill.customerName)}</span>
                        <span className="text-slate-300">•</span>
                        <span className="text-slate-600 font-mono">{bill.countryCode || '+91'} {bill.mobileNumber}</span>
                        <CopyMobileButton
                          countryCode={bill.countryCode || '+91'}
                          mobileNumber={bill.mobileNumber}
                        />
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900">
                        ₹{bill.grandTotalRupees}
                      </div>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded-sm inline-block mt-0.5 ${
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

                  {/* Items summary */}
                  <div className="bg-white rounded-md p-2 border border-slate-100 text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-700">Items: </span>
                    {bill.itemDetailsSummary ||
                      bill.items.map((i) => `${i.name} (${i.quantity})`).join(', ')}
                  </div>

                  {/* Pricing Breakdown: Subtotal, Discount %, Final */}
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                    <span>
                      Subtotal: ₹{bill.subtotalRupees}
                      {(bill.discountPercent || bill.discountRupees) ? (
                        <span className="text-rose-600 ml-1">
                          (Disc {bill.discountPercent || 0}%: -₹{bill.discountAmountRupees ?? bill.discountRupees})
                        </span>
                      ) : null}
                    </span>
                    <span className="text-slate-400">{bill.billTime || bill.dateTimeKolkata}</span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
                    <button
                      onClick={() => onSelectBill(bill)}
                      className="flex-1 py-1 px-2 rounded-md bg-white border border-slate-200 text-slate-700 font-semibold text-[11px] hover:bg-slate-100 flex items-center justify-center gap-1 transition-colors"
                    >
                      <Eye className="w-3 h-3 text-slate-500" />
                      View Bill
                    </button>
                    <button
                      onClick={() => onPreviewPdf(bill)}
                      className="py-1 px-2 rounded-md bg-blue-50 text-blue-700 border border-blue-200 font-semibold text-[11px] hover:bg-blue-100 flex items-center justify-center gap-1 transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      PDF
                    </button>
                    <button
                      onClick={() => onShareWhatsApp(bill)}
                      className="py-1 px-2 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold text-[11px] hover:bg-emerald-100 flex items-center justify-center gap-1 transition-colors"
                    >
                      WhatsApp
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-slate-400">
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
