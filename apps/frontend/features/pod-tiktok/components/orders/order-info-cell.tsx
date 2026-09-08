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
   * Id kết nối TikTok của đơn.
   *
   * 🔴 Endpoint danh sách KHÔNG trả `accountId`, nên trang cha tra ngược từ danh sách kết nối
   * vốn đã tải sẵn cho bộ lọc. Không tra được ⇒ tên shop hiển thị dạng chữ thường, không phải
   * một link gãy.
   */
  accountId?: string;
}

/**
 * Cột **Info**: Connection Name · Shop Name · Order ID · Order Date · Seller Email.
 *
 * Thứ tự và cỡ chữ theo đúng mức độ quan trọng với người vận hành: tên kết nối để biết đơn
 * về từ đâu, tên gian hàng để đối chiếu Seller Center, mã đơn, ngày giờ, rồi email seller
 * (nhỏ nhất — chỉ cần khi phải hỏi lại ai đó).
 */
export function OrderInfoCell({ order, accountId }: OrderInfoCellProps) {
  const { t } = useTranslation('pod');
  const connectionName = order.connectionName || t('orders.unknownShop');
  const shopName = order.shopName ?? t('orders.unknownShop');

  return (
    <div className="min-w-0 space-y-0.5">
      {/* 🔴 Danh sách đơn hiển thị CẢ HAI tên, và đây là màn hình duy nhất làm vậy.
          Connection Name là thứ người vận hành đặt và nhớ; Shop Name là thứ đối chiếu được
          với Seller Center. Ở đây đơn đến từ nhiều kết nối trỏ tới nhiều gian hàng, thiếu
          một trong hai là phải mở sang màn hình khác mới biết đơn thuộc về đâu. */}
      <div className="flex items-center gap-1.5">
        <Store className="size-3.5 shrink-0 text-muted-foreground" />
        {accountId ? (
          <Tooltip content={t('orders.openAccount')}>
            <Link
              href={`/dashboard/pod/tiktok-accounts/${accountId}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate text-sm font-semibold hover:underline"
            >
              {connectionName}
            </Link>
          </Tooltip>
        ) : (
          <span className="truncate text-sm font-semibold">{connectionName}</span>
        )}
      </div>

      {/* Tên gian hàng đứng dưới, nhỏ hơn một bậc — thông tin đối chiếu, không phải thông
          tin thao tác. Bỏ hẳn khi trùng Connection Name để khỏi lặp lại chính nó. */}
      {shopName !== connectionName && (
        <Tooltip content={shopName}>
          <p className="truncate pl-5 text-xs text-muted-foreground">{shopName}</p>
        </Tooltip>
      )}

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
