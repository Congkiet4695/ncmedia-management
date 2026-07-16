'use client';

import { memo, useCallback, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, ClipboardList, Eye, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatDate, formatUSD } from '@/lib/format';
import { OrderItemGrid } from './order-item-grid';
import { OrderClaimAction, OrderFulfillmentBadge } from './order-fulfillment';
import { OrderStatusBadge } from './order-status-badge';
import type { OrderListItem } from '../types';

/** Số cột của Order Grid (để colSpan cho dòng Detail). */
const COL_SPAN = 12;

interface OrderTableProps {
  orders: OrderListItem[];
  loading?: boolean;
  currentUserId?: string;
  canClaim: boolean;
  canRelease: boolean;
  busyId?: string | null;
  onDelete: (order: OrderListItem) => void;
  onClaim: (id: string) => void;
  onRelease: (id: string) => void;
}

interface OrderRowProps {
  order: OrderListItem;
  open: boolean;
  rendered: boolean;
  currentUserId?: string;
  canClaim: boolean;
  canRelease: boolean;
  busy: boolean;
  onToggle: (id: string) => void;
  onDelete: (order: OrderListItem) => void;
  onClaim: (id: string) => void;
  onRelease: (id: string) => void;
}

/** Một dòng Order + dòng Detail (nested grid). Memo hoá → expand dòng này không render lại dòng khác. */
const OrderRow = memo(function OrderRow({
  order,
  open,
  rendered,
  currentUserId,
  canClaim,
  canRelease,
  busy,
  onToggle,
  onDelete,
  onClaim,
  onRelease,
}: OrderRowProps) {
  return (
    <>
      <TableRow className={cn(open && 'bg-muted/40')}>
        <TableCell className="w-8 pr-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={open ? 'Thu gọn sản phẩm' : 'Xem sản phẩm'}
            aria-expanded={open}
            onClick={() => onToggle(order.id)}
          >
            <ChevronRight
              className={cn(
                'size-4 transition-transform duration-200 motion-reduce:transition-none',
                open && 'rotate-90',
              )}
            />
          </Button>
        </TableCell>
        <TableCell className="font-medium">{order.orderNumber}</TableCell>
        <TableCell>{order.platformName ?? '—'}</TableCell>
        <TableCell>{order.accountName ?? '—'}</TableCell>
        <TableCell>{order.sellerName ?? '—'}</TableCell>
        <TableCell className="max-w-40 truncate">{order.customerName ?? '—'}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
          {formatUSD(order.totalAmount)}
        </TableCell>
        <TableCell>
          <OrderStatusBadge status={order.status} />
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1.5">
            <OrderFulfillmentBadge name={order.fulfilledByName} />
            <OrderClaimAction
              orderId={order.id}
              fulfilledById={order.fulfilledById}
              fulfilledByName={order.fulfilledByName}
              isClaimed={order.isClaimed}
              currentUserId={currentUserId}
              canClaim={canClaim}
              canRelease={canRelease}
              busy={busy}
              onClaim={onClaim}
              onRelease={onRelease}
            />
          </div>
        </TableCell>
        <TableCell className="max-w-32 truncate text-muted-foreground">
          {order.tracking ?? '—'}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {formatDate(order.orderedAt)}
        </TableCell>
        <TableCell>
          <div className="flex items-center justify-end gap-1">
            <Button asChild variant="ghost" size="icon" aria-label="Chi tiết">
              <Link href={`/dashboard/orders/${order.id}`}>
                <Eye className="size-4" />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" aria-label="Xóa" onClick={() => onDelete(order)}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {/* Dòng Detail — animation nhẹ bằng grid-template-rows (0fr ↔ 1fr), không gọi API lại. */}
      <tr className="border-0">
        <td colSpan={COL_SPAN} className="p-0">
          <div
            className={cn(
              'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
              open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
            )}
          >
            <div className="overflow-hidden">
              {rendered ? <OrderItemGrid items={order.items} /> : null}
            </div>
          </div>
        </td>
      </tr>
    </>
  );
});

export function OrderTable({
  orders,
  loading,
  currentUserId,
  canClaim,
  canRelease,
  busyId,
  onDelete,
  onClaim,
  onRelease,
}: OrderTableProps) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [rendered, setRendered] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setRendered((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <ClipboardList className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Chưa có Order nào.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Order Number</TableHead>
            <TableHead>Nền tảng</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>Seller</TableHead>
            <TableHead>Khách hàng</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Fulfillment</TableHead>
            <TableHead>Tracking</TableHead>
            <TableHead>Ngày order</TableHead>
            <TableHead className="text-right">Thao tác</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              open={open.has(o.id)}
              rendered={rendered.has(o.id)}
              currentUserId={currentUserId}
              canClaim={canClaim}
              canRelease={canRelease}
              busy={busyId === o.id}
              onToggle={toggle}
              onDelete={onDelete}
              onClaim={onClaim}
              onRelease={onRelease}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
