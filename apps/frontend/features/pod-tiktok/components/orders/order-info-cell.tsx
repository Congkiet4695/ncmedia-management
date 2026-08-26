'use client';

import Link from 'next/link';
import { Store } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { formatOrderDateTime } from '../../order-view-model';
import { CopyButton } from './copy-button';
import type { PodOrderListItem } from '../../order-types';

interface OrderInfoCellProps {
  order: PodOrderListItem;
  /**
   * Id kết nối TikTok tương ứng với `order.shopName`.
   *
   * 🔴 Endpoint danh sách KHÔNG trả `accountId`, nên trang cha tra ngược từ danh sách kết nối
   * vốn đã tải sẵn cho bộ lọc. Không tra được ⇒ tên shop hiển thị dạng chữ thường, không phải
   * một link gãy.
   */
  accountId?: string;
}

/**
 * Cột **Info** (§1): Account Name · Order ID · Order Date · Seller Email.
 *
 * Thứ tự và cỡ chữ theo đúng mức độ quan trọng với người vận hành: tên shop để biết đơn thuộc
 * gian hàng nào, mã đơn để đối chiếu với Seller Center, ngày giờ, rồi email seller (nhỏ nhất —
 * chỉ cần khi phải hỏi lại ai đó).
 */
export function OrderInfoCell({ order, accountId }: OrderInfoCellProps) {
  const { t } = useTranslation('pod');
  const shopName = order.shopName ?? t('orders.unknownShop');

  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex items-center gap-1.5">
        <Store className="size-3.5 shrink-0 text-muted-foreground" />
        {accountId ? (
          <Tooltip content={t('orders.openAccount')}>
            <Link
              href={`/dashboard/pod/tiktok-accounts/${accountId}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-sm font-semibold hover:underline"
            >
              {shopName}
            </Link>
          </Tooltip>
        ) : (
          <span className="truncate text-sm font-semibold">{shopName}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <span className="truncate font-mono text-xs text-muted-foreground">
          {order.tiktokOrderId}
        </span>
        <CopyButton value={order.tiktokOrderId} label={t('orders.copyOrderId')} />
      </div>

      <p className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatOrderDateTime(order.createdTime)}
      </p>

      {/* Nhỏ hơn một bậc theo yêu cầu §1 — thông tin tra cứu, không phải thông tin thao tác. */}
      {order.sellerEmail && (
        <Tooltip content={order.sellerFullName ?? undefined}>
          <p className="truncate text-[11px] text-muted-foreground/80">{order.sellerEmail}</p>
        </Tooltip>
      )}
    </div>
  );
}
