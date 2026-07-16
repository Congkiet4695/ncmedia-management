'use client';

import { ORDER_STATUS_LABELS } from '../schemas/order.schema';
import type { OrderStatus, OrderStatusHistory } from '../types';

function label(status: OrderStatus | null): string {
  return status ? ORDER_STATUS_LABELS[status] : '—';
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Timeline trạng thái đơn (order_status_histories), mới nhất trên cùng. */
export function OrderTimeline({ history }: { history: OrderStatusHistory[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có lịch sử trạng thái.</p>;
  }

  const ordered = [...history].reverse();

  return (
    <ol className="relative space-y-4 border-l pl-5">
      {ordered.map((h) => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[1.4rem] top-1 size-2.5 rounded-full bg-primary" />
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            {h.oldStatus ? (
              <span>
                <span className="text-muted-foreground">{label(h.oldStatus)}</span>
                <span className="mx-1 text-muted-foreground">→</span>
                <span className="font-medium">{label(h.newStatus)}</span>
              </span>
            ) : (
              <span className="font-medium">{label(h.newStatus)}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
          {h.note && <p className="mt-0.5 text-sm">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}
