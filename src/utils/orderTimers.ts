/**
 * Authoritative Kitchen Order Status & Timestamp Timer Calculations
 *
 * Uses real millisecond timestamps (`createdAt`, `startedAt`, `lateAt`, `completedAt`)
 * so preparation timers (00:00 -> 03:00) and late timers (+00:01 upwards after 3 minutes)
 * remain 100% accurate across page refreshes, logouts, logins, and devices.
 */

import {
  Bill,
  KitchenOrder,
  KitchenOrderStatus,
  PREP_TIME_LIMIT_MS,
} from '../types/billing';
import { resolveBillTimestampMs } from './billTimestamp';
import { formatCustomerNameWithJi } from './customerFormat';

export interface ComputedOrderTimerState {
  status: KitchenOrderStatus;
  effectiveStatus: KitchenOrderStatus;
  isLate: boolean;
  prepElapsedMs: number;
  prepTimerFormatted: string; // MM:SS (00:00 -> 03:00)
  prepDisplayFormatted: string; // MM:SS
  prepRemainingFormatted: string; // MM:SS countdown to 03:00
  lateElapsedMs: number;
  lateTimerFormatted: string; // "+MM:SS" when late, or "00:00"
  lateDisplayFormatted: string; // MM:SS
  totalElapsedMs: number;
  totalElapsedFormatted: string; // MM:SS
  lateAtTimestamp?: number;
}

/**
 * Formats a millisecond duration into `MM:SS` (or `HH:MM:SS` if >= 60 minutes).
 */
export function formatDurationMmSs(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Formats a millisecond epoch timestamp to Asia/Kolkata `hh:mm:ss A` string.
 */
export function formatKolkataTimeFromMs(timestampMs?: number): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date(timestampMs));
}

/**
 * Extracts a short, high-visibility order number from `billNumber` or `orderId`
 * (e.g., `ACB-0014` -> `#0014`, `ORD-20261106-0014-XYZ` -> `#0014`).
 */
export function extractProminentOrderNumber(billNumber?: string, orderId?: string): string {
  if (billNumber) {
    const parts = billNumber.split('-');
    const last = parts[parts.length - 1];
    if (last && /^\d+$/.test(last)) {
      return `#${last}`;
    }
  }
  if (orderId) {
    const parts = orderId.split('-');
    for (let i = parts.length - 1; i >= 0; i--) {
      if (/^\d{3,6}$/.test(parts[i])) {
        return `#${parts[i]}`;
      }
    }
    return `#${orderId.slice(-4).toUpperCase()}`;
  }
  return '#0001';
}

export interface OrderTimerInput {
  status?: KitchenOrderStatus;
  createdAt?: number;
  startedAt?: number;
  lateAt?: number;
  completedAt?: number;
  orderStatus?: KitchenOrderStatus;
  orderCreatedAt?: number;
  orderStartedAt?: number;
  orderLateAt?: number;
  orderCompletedAt?: number;
}

/**
 * Computes the real-time status, preparation timer, and late timer for an order or bill
 * using actual timestamps (`startedAt`, `completedAt`, and `nowMs`).
 */
export function computeOrderTimers(
  order: OrderTimerInput,
  nowMs: number = Date.now()
): ComputedOrderTimerState {
  const rawStatus: KitchenOrderStatus = order.status || order.orderStatus || 'WAITING';
  const createdAt = order.createdAt ?? order.orderCreatedAt;
  const startedAt = order.startedAt ?? order.orderStartedAt;
  const lateAt = order.lateAt ?? order.orderLateAt;
  const completedAt = order.completedAt ?? order.orderCompletedAt;

  // Case 1: Order is COMPLETED — timers are stopped at completedAt
  if (rawStatus === 'COMPLETED' || (completedAt && completedAt > 0)) {
    const endMs = completedAt || nowMs;
    const startMs = startedAt || createdAt || endMs;
    const totalElapsedMs = Math.max(0, endMs - startMs);
    const wasLate = totalElapsedMs > PREP_TIME_LIMIT_MS;
    const prepElapsedMs = wasLate ? PREP_TIME_LIMIT_MS : totalElapsedMs;
    const lateElapsedMs = wasLate ? totalElapsedMs - PREP_TIME_LIMIT_MS : 0;
    const prepFmt = formatDurationMmSs(prepElapsedMs);
    const lateFmt = formatDurationMmSs(lateElapsedMs);

    return {
      status: 'COMPLETED',
      effectiveStatus: 'COMPLETED',
      isLate: wasLate,
      prepElapsedMs,
      prepTimerFormatted: prepFmt,
      prepDisplayFormatted: prepFmt,
      prepRemainingFormatted: formatDurationMmSs(Math.max(0, PREP_TIME_LIMIT_MS - totalElapsedMs)),
      lateElapsedMs,
      lateTimerFormatted: wasLate ? `+${lateFmt}` : '00:00',
      lateDisplayFormatted: lateFmt,
      totalElapsedMs,
      totalElapsedFormatted: formatDurationMmSs(totalElapsedMs),
      lateAtTimestamp: wasLate ? startMs + PREP_TIME_LIMIT_MS : undefined,
    };
  }

  // Case 2: Order has been STARTED (PREPARING or LATE)
  if (startedAt && startedAt > 0) {
    const totalElapsedMs = Math.max(0, nowMs - startedAt);
    const isLate = totalElapsedMs >= PREP_TIME_LIMIT_MS || rawStatus === 'LATE';
    const prepElapsedMs = Math.min(PREP_TIME_LIMIT_MS, totalElapsedMs);
    const lateElapsedMs =
      totalElapsedMs > PREP_TIME_LIMIT_MS ? totalElapsedMs - PREP_TIME_LIMIT_MS : 0;
    const prepRemainingMs = Math.max(0, PREP_TIME_LIMIT_MS - totalElapsedMs);
    const prepFmt = formatDurationMmSs(prepElapsedMs);
    const lateFmt = formatDurationMmSs(lateElapsedMs);
    const resolvedStatus: KitchenOrderStatus = isLate ? 'LATE' : 'PREPARING';

    return {
      status: resolvedStatus,
      effectiveStatus: resolvedStatus,
      isLate,
      prepElapsedMs,
      prepTimerFormatted: prepFmt,
      prepDisplayFormatted: prepFmt,
      prepRemainingFormatted: formatDurationMmSs(prepRemainingMs),
      lateElapsedMs,
      lateTimerFormatted: isLate ? `+${lateFmt}` : '00:00',
      lateDisplayFormatted: lateFmt,
      totalElapsedMs,
      totalElapsedFormatted: formatDurationMmSs(totalElapsedMs),
      lateAtTimestamp: isLate ? lateAt || startedAt + PREP_TIME_LIMIT_MS : undefined,
    };
  }

  // Case 3: Order is WAITING (not started yet)
  return {
    status: 'WAITING',
    effectiveStatus: 'WAITING',
    isLate: false,
    prepElapsedMs: 0,
    prepTimerFormatted: '00:00',
    prepDisplayFormatted: '00:00',
    prepRemainingFormatted: '03:00',
    lateElapsedMs: 0,
    lateTimerFormatted: '00:00',
    lateDisplayFormatted: '00:00',
    totalElapsedMs: 0,
    totalElapsedFormatted: '00:00',
    lateAtTimestamp: undefined,
  };
}

/**
 * Converts a full `Bill` record into a sanitized `KitchenOrder` record with zero financial data.
 */
export function billToKitchenOrder(bill: Bill, nowMs: number = Date.now()): KitchenOrder {
  const createdAt = bill.orderCreatedAt || resolveBillTimestampMs(bill);
  const timerState = computeOrderTimers(
    {
      status: bill.orderStatus || 'WAITING',
      createdAt,
      startedAt: bill.orderStartedAt,
      lateAt: bill.orderLateAt,
      completedAt: bill.orderCompletedAt,
    },
    nowMs
  );

  return {
    id: bill.id,
    orderId: bill.orderId || bill.id,
    billNumber: bill.billNumber || bill.orderId || bill.id,
    orderNumber: extractProminentOrderNumber(bill.billNumber, bill.orderId),
    orderType: bill.orderType === 'PACK' ? 'PACK' : 'DINE_IN',
    orderTypeLabel: bill.orderType === 'PACK' ? 'PACKING' : 'DINE-IN',
    customerName: formatCustomerNameWithJi(bill.customerName || 'Guest'),
    items: (bill.items || []).map((item, idx) => ({
      id: item.id || `${bill.id}-item-${idx}`,
      itemKey: item.itemKey,
      name: item.name,
      quantity: item.quantity,
    })),
    totalQuantity:
      bill.itemCount || (bill.items || []).reduce((sum, item) => sum + item.quantity, 0),
    specialInstructions: bill.specialInstructions || undefined,
    status: timerState.effectiveStatus,
    createdAt,
    createdTimeFormatted: bill.billTime || formatKolkataTimeFromMs(createdAt),
    startedAt: bill.orderStartedAt,
    startedTimeFormatted: bill.orderStartedAt
      ? formatKolkataTimeFromMs(bill.orderStartedAt)
      : undefined,
    lateAt: timerState.lateAtTimestamp || bill.orderLateAt,
    completedAt: bill.orderCompletedAt,
    completedTimeFormatted: bill.orderCompletedAt
      ? formatKolkataTimeFromMs(bill.orderCompletedAt)
      : undefined,
    startedBy: bill.startedBy,
    completedBy: bill.completedBy,
  };
}
