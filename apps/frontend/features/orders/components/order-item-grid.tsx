'use client';

import { memo } from 'react';
import { formatUSD } from '@/lib/format';
import { ORDER_ITEM_STATUS_LABELS } from '../schemas/order.schema';
import type { OrderPreviewItem } from '../types';

/** Phụ đề Color / Size (nếu có) cho tên sản phẩm. */
function attrLabel(i: OrderPreviewItem): string | null {
  const parts = [i.color, i.size].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function itemStatusLabel(status: OrderPreviewItem['fulfillmentStatus']): string {
  return ORDER_ITEM_STATUS_LABELS[status] ?? status;
}

/**
 * OrderItemGrid — Detail (nested grid) của một Order, hiển thị NGAY DƯỚI dòng Order.
 * KHÔNG card/modal/drawer ở desktop — là Nested Grid. Mobile: mỗi item thành Card.
 * Cột: Product, Quantity, Unit Price, Total, Tracking Number, Fulfillment Status (tracking theo Item).
 */
function OrderItemGridBase({ items }: { items: OrderPreviewItem[] }) {
  return (
    <div className="border-l-2 border-primary/40 bg-muted/40 px-3 py-3 sm:px-6">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Đơn không có sản phẩm.</p>
      ) : (
        <>
          {/* Desktop / Tablet: nested grid (table) */}
          <table className="hidden w-full text-sm sm:table">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-4 text-left font-medium">Product</th>
                <th className="py-1.5 pr-4 text-right font-medium">Quantity</th>
                <th className="py-1.5 pr-4 text-right font-medium">Unit Price</th>
                <th className="py-1.5 pr-4 text-right font-medium">Total</th>
                <th className="py-1.5 pr-4 text-left font-medium">Tracking Number</th>
                <th className="py-1.5 text-left font-medium">Fulfillment Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const attr = attrLabel(i);
                return (
                  <tr key={i.id} className="border-t border-border/60">
                    <td className="py-1.5 pr-4">
                      <span>{i.productName}</span>
                      {attr && <span className="ml-1 text-xs text-muted-foreground">({attr})</span>}
                    </td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">{formatUSD(i.unitPrice)}</td>
                    <td className="py-1.5 pr-4 text-right font-medium tabular-nums">
                      {formatUSD(i.quantity * i.unitPrice)}
                    </td>
                    <td className="py-1.5 pr-4 text-muted-foreground">{i.trackingNumber || '—'}</td>
                    <td className="py-1.5">{itemStatusLabel(i.fulfillmentStatus)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Mobile: mỗi Order Item thành Card key-value */}
          <div className="space-y-2 sm:hidden">
            {items.map((i) => {
              const attr = attrLabel(i);
              return (
                <div key={i.id} className="rounded-md border bg-card p-3 text-sm">
                  <p className="font-medium">
                    {i.productName}
                    {attr && <span className="ml-1 text-xs text-muted-foreground">({attr})</span>}
                  </p>
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Quantity</dt>
                    <dd className="text-right tabular-nums">{i.quantity}</dd>
                    <dt className="text-muted-foreground">Unit Price</dt>
                    <dd className="text-right tabular-nums">{formatUSD(i.unitPrice)}</dd>
                    <dt className="text-muted-foreground">Total</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {formatUSD(i.quantity * i.unitPrice)}
                    </dd>
                    <dt className="text-muted-foreground">Tracking Number</dt>
                    <dd className="text-right">{i.trackingNumber || '—'}</dd>
                    <dt className="text-muted-foreground">Fulfillment Status</dt>
                    <dd className="text-right">{itemStatusLabel(i.fulfillmentStatus)}</dd>
                  </dl>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Chỉ render lại khi `items` (tham chiếu) đổi — tránh render lại toàn bộ bảng khi expand dòng khác. */
export const OrderItemGrid = memo(OrderItemGridBase);
