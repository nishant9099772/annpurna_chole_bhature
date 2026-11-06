import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Timer,
  AlertTriangle,
  CheckCircle2,
  Utensils,
  Package,
  RefreshCw,
  ChefHat,
  Play,
} from 'lucide-react';
import { KitchenOrder, UserRole } from '../types/billing';
import { computeOrderTimers, formatKolkataTimeFromMs } from '../utils/orderTimers';
import { apiFetch, parseApiJsonResponse } from '../utils/apiClient';

interface LiveOrderStatusPanelProps {
  token: string;
  userRole: UserRole;
  onLogout?: () => void;
  onShowToast?: (msg: string) => void;
}

/**
 * Live Order Status & Preparation Timer Monitor for the Billing Profile (read-only status & timers)
 * and Admin Profile (full Start/Complete override controls).
 */
export const LiveOrderStatusPanel: React.FC<LiveOrderStatusPanelProps> = ({
  token,
  userRole,
  onLogout,
  onShowToast,
}) => {
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [filterStatus, setFilterStatus] = useState<'active' | 'all' | 'completed'>('active');
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const canControl = userRole === 'admin';

  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await apiFetch('/api/orders', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      if (res.status === 401 && onLogout) {
        onLogout();
        return;
      }
      const { ok, data } = await parseApiJsonResponse<{ orders?: KitchenOrder[] }>(res);
      if (ok && Array.isArray(data?.orders)) {
        setOrders(data.orders);
      }
    } catch {
      // ignore transient poll error
    } finally {
      setIsLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchOrders();
    const poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchOrders();
    }, 3000);
    return () => clearInterval(poll);
  }, [fetchOrders]);

  const handleAdminStart = async (orderId: string, orderNumber: string) => {
    if (!canControl) return;
    setBusyOrderId(orderId);
    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/start`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { ok, data } = await parseApiJsonResponse<{ order?: KitchenOrder }>(res);
      if (ok && data?.order) {
        setOrders((prev) => prev.map((o) => (o.id === data.order!.id ? data.order! : o)));
        if (onShowToast) onShowToast(`Order ${orderNumber} started.`);
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleAdminComplete = async (orderId: string, orderNumber: string) => {
    if (!canControl) return;
    setBusyOrderId(orderId);
    try {
      const res = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const { ok, data } = await parseApiJsonResponse<{ order?: KitchenOrder }>(res);
      if (ok && data?.order) {
        setOrders((prev) => prev.map((o) => (o.id === data.order!.id ? data.order! : o)));
        if (onShowToast) onShowToast(`Order ${orderNumber} completed.`);
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const enriched = orders.map((o) => {
    const timers = computeOrderTimers(
      {
        orderStatus: o.status,
        orderCreatedAt: o.createdAt,
        orderStartedAt: o.startedAt,
        orderLateAt: o.lateAt,
        orderCompletedAt: o.completedAt,
      },
      nowMs
    );
    return {
      ...o,
      status: timers.status,
      prepTimerFormatted: timers.prepTimerFormatted,
      isLate: timers.isLate,
      lateTimerFormatted: timers.lateTimerFormatted,
    };
  });

  const waitingCount = enriched.filter((o) => o.status === 'WAITING').length;
  const preparingCount = enriched.filter((o) => o.status === 'PREPARING').length;
  const lateCount = enriched.filter((o) => o.status === 'LATE').length;
  const completedCount = enriched.filter((o) => o.status === 'COMPLETED').length;

  const filtered = enriched
    .filter((o) => {
      if (filterStatus === 'active') return o.status !== 'COMPLETED';
      if (filterStatus === 'completed') return o.status === 'COMPLETED';
      return true;
    })
    .sort((a, b) => {
      if (a.status !== 'COMPLETED' && b.status !== 'COMPLETED') {
        return a.createdAt - b.createdAt; // FIFO
      }
      return b.createdAt - a.createdAt;
    });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3.5 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
                Live Kitchen Order Status
              </h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {canControl ? 'Admin Full Control' : 'Live Status View Only'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Real-time 3-minute preparation timer &amp; late order tracking synchronized with Kitchen
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setFilterStatus('active')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              filterStatus === 'active'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Active ({waitingCount + preparingCount + lateCount})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({enriched.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterStatus('completed')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              filterStatus === 'completed'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Completed ({completedCount})
          </button>
          <button
            type="button"
            onClick={fetchOrders}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
            title="Refresh Order Status"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Status Summary Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-between">
          <span className="text-xs font-bold text-amber-900">Waiting</span>
          <span className="font-mono font-black text-base text-amber-950">{waitingCount}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between">
          <span className="text-xs font-bold text-blue-900">Preparing</span>
          <span className="font-mono font-black text-base text-blue-950">{preparingCount}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-between">
          <span className="text-xs font-bold text-rose-900">Late (&gt;3m)</span>
          <span className="font-mono font-black text-base text-rose-950">{lateCount}</span>
        </div>
        <div className="px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between">
          <span className="text-xs font-bold text-emerald-900">Completed</span>
          <span className="font-mono font-black text-base text-emerald-950">{completedCount}</span>
        </div>
      </div>

      {isLoading && filtered.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-xs font-medium">
          Loading kitchen order status...
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-slate-400 text-xs font-medium">
          No orders in this view.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {filtered.map((order) => {
            const isPack = order.orderType === 'PACK';
            const isWaiting = order.status === 'WAITING';
            const isPreparing = order.status === 'PREPARING';
            const isLate = order.status === 'LATE';
            const isCompleted = order.status === 'COMPLETED';

            return (
              <div
                key={order.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-sm text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                      {order.orderNumber}
                    </span>
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase flex items-center gap-1 ${
                        isPack ? 'bg-purple-100 text-purple-900' : 'bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      {isPack ? <Package className="w-3 h-3" /> : <Utensils className="w-3 h-3" />}
                      <span>{order.orderTypeLabel}</span>
                    </span>
                    <span className="font-bold text-xs text-slate-900">{order.customerName}</span>
                    <span className="text-[11px] font-mono text-slate-400">
                      • {order.createdTimeFormatted}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 font-medium">
                    {order.items.map((i) => `${i.name} × ${i.quantity}`).join(', ')}
                  </p>
                </div>

                <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
                  {/* Timer Display */}
                  <div className="flex items-center gap-1.5 font-mono text-xs bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-lg">
                    <Timer className="w-3.5 h-3.5 text-slate-500" />
                    <span className="font-bold text-slate-800">{order.prepTimerFormatted}</span>
                    {order.isLate && (
                      <span className="text-rose-600 font-black ml-1">
                        ({order.lateTimerFormatted} LATE)
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
                  {isWaiting && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-900 font-bold text-xs">
                      <Clock className="w-3 h-3" />
                      <span>Waiting</span>
                    </span>
                  )}
                  {isPreparing && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-100 text-blue-900 font-bold text-xs">
                      <Timer className="w-3 h-3" />
                      <span>Preparing</span>
                    </span>
                  )}
                  {isLate && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 text-white font-bold text-xs">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Late</span>
                    </span>
                  )}
                  {isCompleted && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-100 text-emerald-900 font-bold text-xs">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>
                        Completed{' '}
                        {order.completedAt ? formatKolkataTimeFromMs(order.completedAt) : ''}
                      </span>
                    </span>
                  )}

                  {/* Admin Manual Override Controls */}
                  {canControl && !isCompleted && (
                    <div className="flex items-center gap-1.5">
                      {isWaiting && (
                        <button
                          type="button"
                          onClick={() => handleAdminStart(order.id, order.orderNumber)}
                          disabled={busyOrderId === order.id}
                          className="px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Start</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleAdminComplete(order.id, order.orderNumber)}
                        disabled={busyOrderId === order.id}
                        className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Complete</span>
                      </button>
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
};
