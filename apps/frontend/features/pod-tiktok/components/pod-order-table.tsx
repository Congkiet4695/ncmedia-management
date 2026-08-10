'use client';

import Link from 'next/link';
import { BadgeCheck, Eye, Loader2, Package, Palette, Store, Truck, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { FulfillmentPanel } from '@/features/fulfillment/components/fulfillment-panel';
import { OrderProductList } from './order-product-list';
import { PodOrderStatusBadge } from './pod-order-status-badge';
import type { PodOrderItem, PodOrderListItem } from '../order-types';

interface PodOrderTableProps {
  orders: PodOrderListItem[];
  loading?: boolean;
  /** Quyền gửi đơn sang xưởng in (`fulfillment.create`). */
  canFulfill?: boolean;
  /** Quyền huỷ đơn tại xưởng in (`fulfillment.cancel`). */
  canCancelFulfillment?: boolean;
  /** Có quyền xem fulfillment (`fulfillment.read`) — không có thì ẩn hẳn khối này. */
  canViewFulfillment?: boolean;
  onUploadDesign: (item: PodOrderItem) => void;
  onPreviewDesign: (src: string) => void;
}

/**
 * Danh sách đơn POD dạng thẻ (card).
 *
 * Mỗi thẻ = phần đầu (thông tin đơn) + danh sách sản phẩm bên trong.
 * Dùng card thay cho bảng vì mỗi đơn chứa nhiều sản phẩm kèm ảnh/design —
 * bảng phẳng sẽ không đọc được và không responsive trên màn hình hẹp.
 */
export function PodOrderTable({
  orders,
  loading,
  canFulfill = false,
  canCancelFulfillment = false,
  canViewFulfillment = false,
  onUploadDesign,
  onPreviewDesign,
}: PodOrderTableProps) {
  const { t } = useTranslation('pod');
  // Ngày giờ tới phút + tiền theo đúng currency TikTok trả về cho từng thị trường.
  const { formatCurrency, formatDateTime } = useLocaleFormat();

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
        <Package className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('orders.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <article key={order.id} className="rounded-lg border">
          {/* Header đơn */}
          <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 p-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{order.tiktokOrderId}</span>
                <PodOrderStatusBadge status={order.status} />
                {order.hasPodItem && (
                  <Badge variant="default">
                    <Palette className="mr-1 size-3" />
                    POD
                  </Badge>
                )}
                {order.orderType && <Badge variant="muted">{order.orderType}</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Store className="size-3.5" />
                  {order.shopName ?? '—'}
                </span>
                <span className="inline-flex max-w-[220px] items-center gap-1 truncate">
                  <User className="size-3.5 shrink-0" />
                  {order.buyer ?? '—'}
                </span>
                {/* Seller phụ trách suy ra từ Account sở hữu đơn — đổi người phụ trách
                    là mọi đơn (cũ lẫn mới) hiển thị đúng ngay, không cần backfill. */}
                <span
                  className="inline-flex max-w-[220px] items-center gap-1 truncate"
                  title={order.sellerEmail ?? undefined}
                >
                  <BadgeCheck className="size-3.5 shrink-0" />
                  {order.sellerFullName ?? order.sellerEmail ?? t('account.unassigned')}
                </span>
                {order.trackingNumber && (
                  <span className="inline-flex items-center gap-1">
                    <Truck className="size-3.5" />
                    <span className="font-mono">{order.trackingNumber}</span>
                  </span>
                )}
                <span>{t('orders.itemCount', { count: order.itemCount })}</span>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-right text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <dt className="opacity-70">{t('orders.totalAmount')}</dt>
                  <dd className="text-sm font-semibold tabular-nums text-foreground">
                    {formatCurrency(order.totalAmount, order.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="opacity-70">{t('orders.created')}</dt>
                  <dd className="whitespace-nowrap">{formatDateTime(order.createdTime)}</dd>
                </div>
                <div>
                  <dt className="opacity-70">{t('orders.updated')}</dt>
                  <dd className="whitespace-nowrap">{formatDateTime(order.updatedTime)}</dd>
                </div>
                <div>
                  <dt className="opacity-70">{t('orders.lastSync')}</dt>
                  <dd className="whitespace-nowrap">{formatDateTime(order.lastSync)}</dd>
                </div>
              </dl>

              <Button asChild variant="outline" size="icon" aria-label={t('orders.viewDetail')}>
                <Link href={`/dashboard/pod/orders/${order.id}`}>
                  <Eye className="size-4" />
                </Link>
              </Button>
            </div>
          </header>

          {/* Sản phẩm trong đơn */}
          <div className="space-y-3 p-3">
            <OrderProductList
              items={order.items}
              onUploadDesign={onUploadDesign}
              onPreviewDesign={onPreviewDesign}
            />

            {/* Khối xưởng in — chỉ tải khi người dùng có quyền xem. */}
            {canViewFulfillment && (
              <FulfillmentPanel
                podOrderId={order.id}
                canFulfill={canFulfill}
                canCancel={canCancelFulfillment}
              />
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
