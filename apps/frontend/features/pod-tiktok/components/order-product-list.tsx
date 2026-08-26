'use client';

import { useState } from 'react';
import { ChevronDown, ImageIcon, ImageUp, Package, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import { POD_ACTIVE_PLACEMENTS, type PodOrderItem } from '../order-types';

interface OrderProductListProps {
  items: PodOrderItem[];
  onUploadDesign: (item: PodOrderItem) => void;
  onPreviewDesign: (src: string) => void;
}

/** Số sản phẩm hiển thị trước khi thu gọn — giữ chiều cao mỗi đơn ở mức hợp lý. */
const COLLAPSED_LIMIT = 3;

const PLACEMENT_SHORT: Record<string, string> = {
  FRONT: 'F',
  BACK: 'B',
  LEFT: 'L',
  RIGHT: 'R',
  SLEEVE: 'S',
};

/**
 * Danh sách sản phẩm bên trong một đơn.
 *
 * Mỗi sản phẩm là MỘT dòng riêng (không gộp) — đúng mô hình POD: TikTok trả
 * 1 line item = 1 đơn vị sản phẩm, và mỗi đơn vị có thể có design khác nhau.
 * Đơn nhiều sản phẩm được thu gọn còn 3 dòng + nút mở rộng để không kéo dài trang.
 */
export function OrderProductList({
  items,
  onUploadDesign,
  onPreviewDesign,
}: OrderProductListProps) {
  const { t } = useTranslation('pod');
  const { formatCurrency } = useLocaleFormat();
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <Package className="size-4" />
        {t('product.empty')}
      </div>
    );
  }

  const visible = expanded ? items : items.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = items.length - visible.length;

  return (
    <div className="space-y-2">
      {visible.map((item, index) => (
        <div
          key={item.id}
          className="flex flex-col gap-3 rounded-md border p-2 sm:flex-row sm:items-center"
        >
          {/* Ảnh sản phẩm */}
          <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
            {item.skuImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.skuImage}
                alt={item.productName ?? t('product.fallbackAlt')}
                className="size-full object-cover"
                loading="lazy"
              />
            ) : (
              <ImageIcon className="size-5 text-muted-foreground" />
            )}
          </div>

          {/* Thông tin sản phẩm */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="line-clamp-2 text-sm font-medium">
                {item.productName ?? t('product.unknownName')}
              </span>
              {item.isPodCustomized && (
                <Badge variant="default" title={`pod_info_id: ${item.podInfoId ?? '—'}`}>
                  <Palette className="mr-1 size-3" />
                  POD
                </Badge>
              )}
              {items.length > 1 && (
                <span className="text-xs text-muted-foreground">#{index + 1}</span>
              )}
            </div>

            <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-3 lg:grid-cols-5">
              <Meta label={t('product.productId')} value={item.productId} mono />
              <Meta label={t('product.sku')} value={item.sellerSku ?? item.skuId} mono />
              <Meta label={t('product.variant')} value={item.skuName} />
              <Meta label={t('product.category')} value={item.productCategory} />
              <Meta label={t('product.qty')} value={String(item.quantity)} />
            </dl>
          </div>

          {/* Design + hành động */}
          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end lg:flex-row lg:items-center">
            <div className="flex items-center gap-1">
              {POD_ACTIVE_PLACEMENTS.map((placement) => {
                const design = item.designs.find((d) => d.placement === placement);
                return design ? (
                  <button
                    key={placement}
                    type="button"
                    onClick={() => onPreviewDesign(design.fileUrl)}
                    title={t('product.designZoom', { placement })}
                    className="relative size-11 cursor-zoom-in overflow-hidden rounded border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={design.fileUrl}
                      alt={t('product.designAlt', { placement })}
                      className="size-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute bottom-0 right-0 bg-black/70 px-1 text-[10px] font-semibold text-white">
                      {PLACEMENT_SHORT[placement]}
                    </span>
                  </button>
                ) : (
                  <div
                    key={placement}
                    title={t('product.designMissing', { placement })}
                    className={cn(
                      'flex size-11 items-center justify-center rounded border border-dashed',
                      'text-[10px] font-semibold text-muted-foreground',
                    )}
                  >
                    {PLACEMENT_SHORT[placement]}
                  </div>
                );
              })}
            </div>

            <div className="text-right">
              <p className="whitespace-nowrap text-sm font-medium tabular-nums">
                {formatCurrency(item.salePrice, item.currency)}
              </p>
              {/* Chưa khai ánh xạ ⇒ chưa có nơi lưu design (§7): nói đúng nguyên nhân. */}
              <Button
                variant={item.mappingId === null ? 'secondary' : 'outline'}
                size="sm"
                className="mt-1"
                title={item.mappingId === null ? t('product.designNoMappingHint') : undefined}
                onClick={() => onUploadDesign(item)}
              >
                <ImageUp className="size-4" />
                {item.mappingId === null
                  ? t('product.designNoMapping')
                  : t('product.uploadDesign')}
              </Button>
            </div>
          </div>
        </div>
      ))}

      {hiddenCount > 0 && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpanded(true)}>
          <ChevronDown className="size-4" />
          {t('product.showMore', { count: hiddenCount })}
        </Button>
      )}
      {expanded && items.length > COLLAPSED_LIMIT && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setExpanded(false)}>
          {t('product.collapse')}
        </Button>
      )}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide opacity-70">{label}</dt>
      <dd className={cn('truncate', mono && 'font-mono')} title={value ?? undefined}>
        {value ?? '—'}
      </dd>
    </div>
  );
}
