import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  UtensilsCrossed,
  Clock,
  Play,
  CheckCircle2,
  AlertTriangle,
  Utensils,
  Package,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  LogOut,
  RefreshCw,
  ChefHat,
  ListOrdered,
  CheckCheck,
  Layers,
  MessageSquareWarning,
  Timer,
} from 'lucide-react';
import { KitchenOrder, UserRole } from '../types/billing';
import { computeOrderTimers, formatKolkataTimeFromMs } from '../utils/orderTimers';
import { apiFetch, parseApiJsonResponse } from '../utils/apiClient';

interface OrderDashboardProps {
  token: string;
  username: string;
  userRole: UserRole;
  onLogout?: () => void;
  sessionExpiresAt?: number | null;
  /** When true, renders inside Admin Dashboard without duplicate top-level page chrome */
  embeddedInAdmin?: boolean;
  onShowToast?: (msg: string) => void;
}

type OrderSectionTab = 'fifo' | 'all' | 'completed';

/**
 * Plays a pleasant, audible two-tone kitchen bell chime using the browser's Web Audio API
 * when a new order arrives in the queue. Requires zero external audio files.
 */
function playKitchenNewOrderBell(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // First bell tone (A5 = 880 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.28, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.45);

    // Second bell tone (C#6 = 1108.73 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1108.73, now + 0.18);
    gain2.gain.setValueAtTime(0.32, now + 0.18);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.18);
    osc2.stop(now + 0.85);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Ignore audio context autoplay restrictions if user hasn't interacted yet
  }
}

export const OrderDashboard: React.FC<OrderDashboardProps> = ({
  token,
  username,
  userRole,
  onLogout,
  sessionExpiresAt,
  embeddedInAdmin = false,
  onShowToast,
}) => {
  const [activeSection, setActiveSection] = useState<OrderSectionTab>('fifo');
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('annpurna_kitchen_sound') !== 'muted';
    } catch {
      return true;
    }
  });

  // 1-second live clock tick for accurate 3-minute prep & late timers
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Track action in-flight & confirmation state for "COMPLETED"
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [confirmCompleteOrderId, setConfirmCompleteOrderId] = useState<string | null>(null);

  // Track known order IDs so we can play the chime only when a genuinely new order arrives
  const knownOrderIdsRef = useRef<Set<string> | null>(null);

  const canControlOrders = userRole === 'order' || userRole === 'admin';

  // Online / Offline listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 1-second live timer ticker
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch synchronized live orders from backend
  const fetchOrders = useCallback(
    async (silent: boolean = false) => {
      if (!silent) setIsRefreshing(true);
      try {
        const res = await apiFetch('/api/orders', {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (res.status === 401) {
          if (onLogout) onLogout();
          return;
        }

        const { ok, data } = await parseApiJsonResponse<{
          success?: boolean;
          orders?: KitchenOrder[];
          error?: string;
        }>(res);

        if (!ok || !data?.orders) {
          throw new Error(data?.error || 'Could not load kitchen orders');
        }

        const incoming = data.orders;
        setOrders(incoming);
        setErrorMessage(null);
        setIsOnline(true);

        // Check if any new WAITING order arrived since last poll
        const currentIds = new Set(incoming.map((o) => o.id));
        if (knownOrderIdsRef.current !== null) {
          let hasNewWaiting = false;
          for (const order of incoming) {
            if (!knownOrderIdsRef.current.has(order.id) && order.status === 'WAITING') {
              hasNewWaiting = true;
              break;
            }
          }
          if (hasNewWaiting && soundEnabled) {
            playKitchenNewOrderBell();
          }
        }
        knownOrderIdsRef.current = currentIds;
      } catch (err: any) {
        if (!silent) {
          setErrorMessage(err?.message || 'Unable to sync live orders.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [token, onLogout, soundEnabled]
  );

  // Initial load + real-time 2.5s polling synchronization across all 3 profiles
  useEffect(() => {
    fetchOrders(false);
    const pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchOrders(true);
    }, 2500);
    return () => clearInterval(pollTimer);
  }, [fetchOrders]);

  // Toggle sound alert
  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try {
      localStorage.setItem('annpurna_kitchen_sound', next ? 'enabled' : 'muted');
    } catch {
      // ignore
    }
    if (next) {
      playKitchenNewOrderBell();
    }
  };

  // Start Order Handler (One-way lock: WAITING -> PREPARING)
  const handleStartOrder = async (order: KitchenOrder) => {
    if (!canControlOrders || order.startedAt || order.status !== 'WAITING') return;
    setBusyOrderId(order.id);
    setErrorMessage(null);

    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(order.id)}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 && onLogout) {
        onLogout();
        return;
      }

      const { ok, data } = await parseApiJsonResponse<{
        success?: boolean;
        order?: KitchenOrder;
        error?: string;
      }>(res);

      if (!ok || !data?.order) {
        throw new Error(data?.error || 'Could not start order');
      }

      const updatedOrder = data.order;
      setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
      setNowMs(Date.now());
      if (onShowToast) {
        onShowToast(`Order ${order.orderNumber} started! 3-minute timer running.`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to start order.');
    } finally {
      setBusyOrderId(null);
    }
  };

  // Complete Order Handler (Requires confirmation step)
  const handleCompleteOrder = async (order: KitchenOrder) => {
    if (!canControlOrders || order.status === 'COMPLETED') return;
    setBusyOrderId(order.id);
    setConfirmCompleteOrderId(null);
    setErrorMessage(null);

    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(order.id)}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.status === 401 && onLogout) {
        onLogout();
        return;
      }

      const { ok, data } = await parseApiJsonResponse<{
        success?: boolean;
        order?: KitchenOrder;
        error?: string;
      }>(res);

      if (!ok || !data?.order) {
        throw new Error(data?.error || 'Could not complete order');
      }

      const updatedOrder = data.order;
      setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
      setNowMs(Date.now());
      if (onShowToast) {
        onShowToast(`Order ${order.orderNumber} marked as COMPLETED!`);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to complete order.');
    } finally {
      setBusyOrderId(null);
    }
  };

  // Recompute live timer state for each order at `nowMs`
  const enrichedOrders = orders.map((order) => {
    const timers = computeOrderTimers(
      {
        orderStatus: order.status,
        orderCreatedAt: order.createdAt,
        orderStartedAt: order.startedAt,
        orderLateAt: order.lateAt,
        orderCompletedAt: order.completedAt,
      },
      nowMs
    );
    return {
      ...order,
      status: timers.status,
      prepElapsedMs: timers.prepElapsedMs,
      prepTimerFormatted: timers.prepTimerFormatted,
      isLate: timers.isLate,
      lateElapsedMs: timers.lateElapsedMs,
      lateTimerFormatted: timers.lateTimerFormatted,
    };
  });

  // Section A: First Come, First Served (FIFO) — Active orders sorted oldest-first (createdAt ASC)
  const fifoOrders = enrichedOrders
    .filter((o) => o.status !== 'COMPLETED')
    .sort((a, b) => a.createdAt - b.createdAt);

  // Section B: All Orders — Active FIFO first, then Completed newest-first
  const allOrdersSorted = [
    ...fifoOrders,
    ...enrichedOrders
      .filter((o) => o.status === 'COMPLETED')
      .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt)),
  ];

  // Section C: Completed Orders — Completed sorted newest-first
  const completedOrders = enrichedOrders
    .filter((o) => o.status === 'COMPLETED')
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt));

  const displayedOrders =
    activeSection === 'fifo'
      ? fifoOrders
      : activeSection === 'completed'
      ? completedOrders
      : allOrdersSorted;

  const waitingCount = enrichedOrders.filter((o) => o.status === 'WAITING').length;
  const preparingCount = enrichedOrders.filter((o) => o.status === 'PREPARING').length;
  const lateCount = enrichedOrders.filter((o) => o.status === 'LATE').length;
  const completedCount = completedOrders.length;

  // Remaining session time indicator
  const sessionRemainingText = (() => {
    if (!sessionExpiresAt) return '24h Session';
    const diffMs = Math.max(0, sessionExpiresAt - nowMs);
    const hrs = Math.floor(diffMs / 3_600_000);
    const mins = Math.floor((diffMs % 3_600_000) / 60_000);
    return `${hrs}h ${mins}m left`;
  })();

  const renderContent = () => (
    <div className="space-y-4">
      {/* Live Kitchen Status Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-3 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800 block">
              Waiting
            </span>
            <span className="text-2xl sm:text-3xl font-black font-mono text-amber-950">
              {waitingCount}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-200/80 text-amber-900 flex items-center justify-center font-bold">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-3 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-800 block">
              Preparing (≤3m)
            </span>
            <span className="text-2xl sm:text-3xl font-black font-mono text-blue-950">
              {preparingCount}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-200/80 text-blue-900 flex items-center justify-center font-bold">
            <Timer className="w-5 h-5" />
          </div>
        </div>

        <div
          className={`rounded-xl p-3 flex items-center justify-between border-2 ${
            lateCount > 0
              ? 'bg-rose-100 border-rose-500 animate-pulse'
              : 'bg-rose-50/70 border-rose-200'
          }`}
        >
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-800 block">
              Late (&gt;3m)
            </span>
            <span className="text-2xl sm:text-3xl font-black font-mono text-rose-950">
              {lateCount}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-rose-200 text-rose-900 flex items-center justify-center font-bold">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-3 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800 block">
              Completed
            </span>
            <span className="text-2xl sm:text-3xl font-black font-mono text-emerald-950">
              {completedCount}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-200/80 text-emerald-900 flex items-center justify-center font-bold">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3 Required Kitchen Sections Switcher */}
      <div className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-xs grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => setActiveSection('fifo')}
          className={`py-3 px-2.5 sm:px-4 rounded-lg font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 transition cursor-pointer ${
            activeSection === 'fifo'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <ListOrdered className="w-4 h-4 shrink-0" />
          <span className="truncate">First Come, First Served</span>
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-xs ${
              activeSection === 'fifo'
                ? 'bg-amber-900/40 text-white'
                : 'bg-amber-100 text-amber-900'
            }`}
          >
            {fifoOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('all')}
          className={`py-3 px-2.5 sm:px-4 rounded-lg font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 transition cursor-pointer ${
            activeSection === 'all'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4 shrink-0" />
          <span className="truncate">All Orders</span>
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-xs ${
              activeSection === 'all' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-800'
            }`}
          >
            {enrichedOrders.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSection('completed')}
          className={`py-3 px-2.5 sm:px-4 rounded-lg font-extrabold text-xs sm:text-sm flex items-center justify-center gap-1.5 sm:gap-2 transition cursor-pointer ${
            activeSection === 'completed'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
          }`}
        >
          <CheckCheck className="w-4 h-4 shrink-0" />
          <span className="truncate">Completed Orders</span>
          <span
            className={`px-2 py-0.5 rounded-md font-mono text-xs ${
              activeSection === 'completed'
                ? 'bg-emerald-950/40 text-white'
                : 'bg-emerald-100 text-emerald-900'
            }`}
          >
            {completedCount}
          </span>
        </button>
      </div>

      {/* Section Description Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <h2 className="text-sm sm:text-base font-black text-slate-900">
            {activeSection === 'fifo' &&
              'A. First Come, First Served Queue (Oldest Pending Order First)'}
            {activeSection === 'all' &&
              'B. All Orders (Waiting, Preparing, Late & Completed)'}
            {activeSection === 'completed' &&
              'C. Completed Orders History'}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {embeddedInAdmin && (
            <button
              type="button"
              onClick={toggleSound}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 cursor-pointer transition ${
                soundEnabled
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-100 border-slate-200 text-slate-600'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              <span>{soundEnabled ? 'Bell Alert ON' : 'Bell Muted'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => fetchOrders(false)}
            disabled={isRefreshing}
            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Sync Queue</span>
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs sm:text-sm font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchOrders(false)}
            className="underline font-bold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Orders Grid */}
      {isLoading && displayedOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-amber-600 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-700">Loading Live Kitchen Queue...</p>
        </div>
      ) : displayedOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-2">
          <ChefHat className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base sm:text-lg font-extrabold text-slate-800">
            {activeSection === 'fifo'
              ? 'All Caught Up! No Pending Kitchen Orders'
              : activeSection === 'completed'
              ? 'No Completed Orders Yet'
              : 'No Orders Recorded Yet'}
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
            {activeSection === 'fifo'
              ? 'New bills generated at the Billing Counter will appear here automatically in First Come, First Served order.'
              : 'Orders will appear here as soon as bills are created.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayedOrders.map((order, index) => {
            const isWaiting = order.status === 'WAITING';
            const isPreparing = order.status === 'PREPARING';
            const isLate = order.status === 'LATE';
            const isCompleted = order.status === 'COMPLETED';
            const isPack = order.orderType === 'PACK';
            const isBusy = busyOrderId === order.id;
            const isConfirmingComplete = confirmCompleteOrderId === order.id;

            // Progress bar percentage for 3-minute prep window
            const prepProgressPct = Math.min(
              100,
              Math.round((order.prepElapsedMs / 180_000) * 100)
            );

            return (
              <div
                key={order.id}
                className={`rounded-xl border-2 shadow-sm overflow-hidden flex flex-col justify-between transition ${
                  isLate
                    ? 'bg-rose-50/60 border-rose-500 ring-2 ring-rose-500/20'
                    : isPreparing
                    ? 'bg-blue-50/40 border-blue-400'
                    : isWaiting
                    ? 'bg-white border-amber-400'
                    : 'bg-slate-50 border-emerald-300 opacity-95'
                }`}
              >
                {/* Card Top Header: Queue Rank, Order Number, DINE-IN / PACKING Badge */}
                <div>
                  <div
                    className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${
                      isLate
                        ? 'bg-rose-600 text-white border-rose-700'
                        : isPreparing
                        ? 'bg-blue-700 text-white border-blue-800'
                        : isWaiting
                        ? 'bg-amber-500 text-slate-950 border-amber-600'
                        : 'bg-emerald-700 text-white border-emerald-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {activeSection === 'fifo' && !isCompleted && (
                        <span className="px-2 py-0.5 rounded bg-black/25 text-white font-mono text-xs font-black">
                          FIFO #{index + 1}
                        </span>
                      )}
                      <span className="text-xl sm:text-2xl font-black font-mono tracking-tight">
                        {order.orderNumber}
                      </span>
                    </div>

                    {/* Prominent DINE-IN vs PACKING Badge */}
                    <span
                      className={`px-3 py-1 rounded-lg font-black text-xs sm:text-sm uppercase tracking-wider flex items-center gap-1.5 shadow-xs shrink-0 ${
                        isPack
                          ? 'bg-purple-950 text-amber-300 border-2 border-amber-300'
                          : 'bg-white text-emerald-900 border-2 border-emerald-700'
                      }`}
                    >
                      {isPack ? (
                        <>
                          <Package className="w-4 h-4 shrink-0" />
                          <span>PACKING</span>
                        </>
                      ) : (
                        <>
                          <Utensils className="w-4 h-4 shrink-0" />
                          <span>DINE-IN</span>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Customer Name, Creation Time & Status Badge */}
                  <div className="px-4 py-3 bg-white/90 border-b border-slate-200/80 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-base sm:text-lg font-black text-slate-900 truncate">
                        {order.customerName}
                      </p>
                      <p className="text-xs font-mono text-slate-500">
                        Ordered: <strong className="text-slate-700">{order.createdTimeFormatted}</strong>
                        <span className="mx-1.5">•</span>
                        <span>{order.billNumber}</span>
                      </p>
                    </div>

                    {/* Current Status Pill */}
                    <div className="shrink-0 text-right">
                      {isWaiting && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-900 border border-amber-300 font-black text-xs uppercase">
                          <Clock className="w-3.5 h-3.5" />
                          <span>WAITING</span>
                        </span>
                      )}
                      {isPreparing && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-100 text-blue-900 border border-blue-300 font-black text-xs uppercase">
                          <Timer className="w-3.5 h-3.5 animate-spin" />
                          <span>PREPARING</span>
                        </span>
                      )}
                      {isLate && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white font-black text-xs uppercase animate-bounce">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          <span>LATE ORDER</span>
                        </span>
                      )}
                      {isCompleted && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-900 border border-emerald-300 font-black text-xs uppercase">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>COMPLETED</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ordered Items & Quantities List (Large, Bold for Kitchen Workers) */}
                  <div className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
                      <span>Item Name</span>
                      <span>Qty ({order.totalQuantity} total)</span>
                    </div>

                    <div className="divide-y divide-slate-200/70 bg-white rounded-lg border border-slate-200 overflow-hidden">
                      {order.items.map((item, idx) => (
                        <div
                          key={`${order.id}-item-${idx}`}
                          className="px-3.5 py-2.5 flex items-center justify-between gap-2"
                        >
                          <span className="font-extrabold text-slate-900 text-sm sm:text-base">
                            {item.name}
                          </span>
                          <span className="px-3 py-1 rounded-lg bg-slate-900 text-white font-mono font-black text-base sm:text-lg shrink-0">
                            × {item.quantity}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Special Instructions / Kitchen Notes */}
                    {order.specialInstructions && (
                      <div className="p-3 rounded-lg bg-amber-50 border-2 border-amber-300 text-amber-950 flex items-start gap-2">
                        <MessageSquareWarning className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                        <div className="text-xs sm:text-sm">
                          <span className="font-black uppercase text-[10px] tracking-wider block text-amber-800">
                            Special Kitchen Note:
                          </span>
                          <span className="font-bold">{order.specialInstructions}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom Section: 3-Minute Preparation Timer + Late Timer + Action Buttons */}
                <div className="p-4 pt-0 space-y-3">
                  {/* Live Preparation Timer & Late Timer Box */}
                  <div
                    className={`p-3 rounded-xl border ${
                      isLate
                        ? 'bg-rose-100/90 border-rose-400 text-rose-950'
                        : isPreparing
                        ? 'bg-blue-50 border-blue-200 text-blue-950'
                        : isCompleted
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : 'bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider block opacity-75">
                          3-Min Prep Timer
                        </span>
                        <span className="font-mono font-black text-xl sm:text-2xl">
                          {order.prepTimerFormatted}
                        </span>
                        <span className="text-xs font-mono opacity-75 ml-1">/ 03:00</span>
                      </div>

                      {/* Late Timer (Starts counting up after 03:00) */}
                      {(order.isLate || order.lateElapsedMs > 0) && (
                        <div className="text-right bg-rose-600 text-white px-3 py-1.5 rounded-lg shadow-xs">
                          <span className="text-[10px] font-extrabold uppercase tracking-wider block">
                            Late By
                          </span>
                          <span className="font-mono font-black text-lg sm:text-xl">
                            {order.lateTimerFormatted}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Visual 3-Minute Progress Bar */}
                    {!isWaiting && (
                      <div className="w-full h-2 bg-white/80 rounded-full overflow-hidden mt-2 border border-black/5">
                        <div
                          className={`h-full transition-all duration-500 ${
                            order.isLate
                              ? 'bg-rose-600'
                              : isCompleted
                              ? 'bg-emerald-600'
                              : 'bg-blue-600'
                          }`}
                          style={{ width: `${prepProgressPct}%` }}
                        />
                      </div>
                    )}

                    {/* Timestamps Metadata */}
                    <div className="mt-2 pt-1.5 border-t border-black/10 flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono">
                      {order.startedAt ? (
                        <span>Started: {formatKolkataTimeFromMs(order.startedAt)}</span>
                      ) : (
                        <span>Not started yet</span>
                      )}
                      {order.completedAt && (
                        <span className="font-bold text-emerald-800">
                          Done: {formatKolkataTimeFromMs(order.completedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Large Touch-Friendly Worker Controls (START & COMPLETED) */}
                  {canControlOrders && !isCompleted && (
                    <div className="space-y-2">
                      {isConfirmingComplete ? (
                        <div className="p-3 bg-emerald-950 text-white rounded-xl space-y-2.5 animate-in fade-in duration-150">
                          <p className="text-xs sm:text-sm font-extrabold text-center">
                            Confirm Order {order.orderNumber} ({order.orderTypeLabel}) is ready &amp; completed?
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmCompleteOrderId(null)}
                              disabled={isBusy}
                              className="py-2.5 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs sm:text-sm cursor-pointer transition"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCompleteOrder(order)}
                              disabled={isBusy}
                              className="py-2.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition"
                            >
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>{isBusy ? 'Saving...' : 'Yes, Complete'}</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2.5">
                          {/* START Button: Immediately disabled & locked once started */}
                          <button
                            type="button"
                            onClick={() => handleStartOrder(order)}
                            disabled={!isWaiting || Boolean(order.startedAt) || isBusy}
                            className={`py-3.5 px-3 rounded-xl font-black text-sm sm:text-base flex items-center justify-center gap-2 transition shadow-xs ${
                              isWaiting && !order.startedAt
                                ? 'bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white cursor-pointer'
                                : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                            }`}
                          >
                            <Play className="w-4 h-4 fill-current shrink-0" />
                            <span>{isWaiting ? 'START' : 'STARTED'}</span>
                          </button>

                          {/* COMPLETED Button: Opens confirmation step */}
                          <button
                            type="button"
                            onClick={() => setConfirmCompleteOrderId(order.id)}
                            disabled={isBusy}
                            className="py-3.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-black text-sm sm:text-base flex items-center justify-center gap-2 transition shadow-xs cursor-pointer disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>COMPLETED</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (embeddedInAdmin) {
    return renderContent();
  }

  return (
    <div className="min-h-dvh bg-slate-100 flex flex-col text-slate-900">
      {/* Top Kitchen Worker Header */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-md safe-top">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shrink-0 shadow-xs">
              <UtensilsCrossed className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-black text-base sm:text-xl tracking-tight truncate">
                  Annapurna Kitchen Order Display
                </h1>
                <span className="hidden sm:inline-block px-2 py-0.5 text-[11px] font-black uppercase bg-amber-500 text-slate-950 rounded-md">
                  Annapurna Order
                </span>
              </div>
              <p className="text-[11px] text-slate-300 truncate">
                Worker Queue • 3-Min Target Timer • {sessionRemainingText}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Online / Offline Status Badge */}
            <div
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border ${
                isOnline
                  ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                  : 'bg-rose-950 border-rose-500 text-rose-300 animate-pulse'
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Live Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  <span>Offline</span>
                </>
              )}
            </div>

            {/* New Order Sound Bell Toggle */}
            <button
              type="button"
              onClick={toggleSound}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                soundEnabled
                  ? 'bg-amber-500 text-slate-950 border-amber-400'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Toggle New Order Sound Bell"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              <span className="hidden sm:inline">{soundEnabled ? 'Bell ON' : 'Muted'}</span>
            </button>

            {/* Logout Button */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer"
                title={`Logout (${username})`}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-4 flex-1 w-full">
        {renderContent()}
      </main>
    </div>
  );
};
