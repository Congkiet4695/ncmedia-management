'use client';

import { Gift, ImageOff, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { PodOrderItem } from '@/features/pod-tiktok/order-types';

interface PromotionGiftItemProps {
  /** Dòng hàng TikTok có `isGift = true` và CHƯA có Product Mapping. */
  item: PodOrderItem;
}

/**
 * Dòng **quà tặng khuyến mãi** trong khối Cấu hình sản phẩm — CHỈ ĐỌC.
 *
 * 🔴 Không có ô chọn sản phẩm / biến thể / artwork và không có lỗi "Not mapped": quà không cần
 * Product Configuration. Nhưng quà KHÔNG bị ẩn — nó vẫn thuộc đơn TikTok, và người vận hành
 * phải thấy rằng quà không đi sang nhà cung cấp (xem `isUnconfiguredPromotionGift`).
 */
export function PromotionGiftItem({ item }: PromotionGiftItemProps) {
  const { t } = useTranslation(['fulfillment']);

  return (
    <div className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3">
      <div className="flex gap-3">
        {item.productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.productImage}
            alt=""
            className="size-14 shrink-0 rounded border object-cover"
          />
        ) : (
          <div className="flex size-14 shrink-0 items-center justify-center rounded border bg-muted">
            <ImageOff className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-0.5 text-xs">
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {item.productName ?? item.sellerSku ?? t('fulfill.config.unnamedProduct')}
          </p>
          <p className="text-muted-foreground">
            <span className="font-mono">{item.productId ?? '—'}</span>
            {' · '}
            <span className="font-mono">{item.sellerSku ?? '—'}</span>
            {item.skuName && <span> · {item.skuName}</span>}
            <span> · × {item.quantity}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">{t('fulfill.promotionGift.source')}</p>
        </div>
        <Badge variant="info" className="h-5 shrink-0 gap-1">
          <Gift className="size-3" />
          {t('fulfill.promotionGift.label')}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{t('fulfill.promotionGift.noConfig')}</p>
      <p className="flex gap-1.5 rounded-md bg-warning/10 p-2 text-[11px] text-warning">
        <Info className="mt-px size-3.5 shrink-0" />
        {t('fulfill.promotionGift.notSent')}
      </p>
    </div>
  );
}
