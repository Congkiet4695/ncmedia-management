'use client';

import { ImageIcon, ImageUp, Palette, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  firstUndesignedSource,
  groupOrderProducts,
  orderProductImages,
  rowDesignImages,
  rowDesignStatus,
  type LightboxRequest,
  type OrderProductRow,
} from '../../order-view-model';
import type { PodOrderItem } from '../../order-types';
import { DesignThumbs } from './design-thumbs';

interface OrderProductsCellProps {
  items: PodOrderItem[];
  onUploadDesign: (item: PodOrderItem) => void;
  /** Mở bộ xem ảnh — dùng CHUNG cho ảnh sản phẩm và ảnh design. */
  onPreviewImages: (request: LightboxRequest) => void;
}

/** Ảnh 60×60 theo yêu cầu — không lớn hơn, để chiều cao mỗi dòng đơn giữ nguyên. */
const THUMB = 'size-[60px]';

/**
 * Cột **Products** (§2) — cột lớn nhất của bảng.
 *
 * Mỗi sản phẩm một dòng: ảnh 60×60 · tiêu đề (tối đa 2 dòng) · Product ID · SKU × Quantity ·
 * Variant · Category · nút Upload Design.
 *
 * 🔴 **Design thuộc SẢN PHẨM (Product Mapping), không thuộc đơn.** Upload một lần là mọi đơn
 * cùng SKU đều có file in — nút ở đây gọi vào `/fulfillment/mappings/:id/designs/:placement`.
 *
 * 🔴 Ba trạng thái ở §5 sửa ở BA chỗ khác nhau, nên phải phân biệt rõ:
 * chưa khai ánh xạ ⇒ về màn Product Mapping; thiếu mặt trước ⇒ bấm Upload; đã sẵn sàng ⇒
 * hiện luôn ảnh thu nhỏ để soi lại. Gộp chúng thành một chữ "thiếu design" là lý do người
 * dùng bấm Upload mãi mà đơn vẫn không gửi được.
 */
export function OrderProductsCell({
  items,
  onUploadDesign,
  onPreviewImages,
}: OrderProductsCellProps) {
  const { t } = useTranslation('pod');
  const rows = groupOrderProducts(items);

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('product.empty')}</p>;
  }

  return (
    <ul className="space-y-2">
      {rows.map((row, rowIndex) => (
        <ProductRow
          key={row.key}
          row={row}
          rowIndex={rowIndex}
          allRows={rows}
          onUploadDesign={onUploadDesign}
          onPreviewImages={onPreviewImages}
        />
      ))}
    </ul>
  );
}

function ProductRow({
  row,
  rowIndex,
  allRows,
  onUploadDesign,
  onPreviewImages,
}: {
  row: OrderProductRow;
  /** Vị trí của dòng này trong đơn — để lightbox mở đúng ảnh được bấm. */
  rowIndex: number;
  /** Mọi dòng của đơn — để lướt qua ảnh các sản phẩm khác mà không phải đóng lightbox. */
  allRows: OrderProductRow[];
  onUploadDesign: (item: PodOrderItem) => void;
  onPreviewImages: (request: LightboxRequest) => void;
}) {
  const { t } = useTranslation('pod');

  const design = rowDesignStatus(row);

  /**
   * Bấm ảnh sản phẩm ⇒ mở bộ xem ảnh, GIỐNG HỆT bấm ảnh design.
   *
   * 🔴 Trước đây ảnh sản phẩm là một thẻ `<div>` chết: bấm vào không có gì xảy ra, trong khi
   * ảnh design ngay cạnh lại mở được. Không có quy tắc nào để người dùng đoán ra sự khác biệt
   * đó — họ chỉ nghĩ là giao diện hỏng.
   *
   * Ảnh của MỌI sản phẩm trong đơn được đưa vào cùng lúc, mở tại đúng ảnh vừa bấm.
   */
  const openProductImages = () => {
    const images = orderProductImages(allRows);
    if (images.length === 0) return;
    // Vị trí trong danh sách ĐÃ LỌC ảnh rỗng, không phải `rowIndex` — sản phẩm không có ảnh
    // bị loại khỏi bộ xem nên hai chỉ số lệch nhau.
    const clicked = allRows[rowIndex]?.productImageFull ?? allRows[rowIndex]?.productImage;
    const index = Math.max(
      0,
      images.findIndex((image) => image.src === clicked),
    );
    onPreviewImages({ images, index });
  };

  return (
    <li className="flex gap-2.5">
      {/* Ảnh sản phẩm — bấm để xem cỡ lớn (cùng bộ xem với ảnh design). */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          openProductImages();
        }}
        disabled={!row.productImage}
        aria-label={t('product.viewImage')}
        className={`${THUMB} relative shrink-0 overflow-hidden rounded border bg-muted/40 ${
          row.productImage ? 'cursor-zoom-in' : 'cursor-default'
        }`}
      >
        {/* 🔴 Ảnh CHÍNH của sản phẩm, KHÔNG phải `skuImage` (ảnh biến thể TikTok gửi kèm
            dòng đơn). Thiếu ảnh chính ⇒ ô trống, không rơi về ảnh biến thể: một ô trống nói
            đúng sự thật, một ảnh sai thì không. */}
        {row.productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.productImage}
            alt={row.productName ?? t('product.fallbackAlt')}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ImageIcon className="size-5 text-muted-foreground" />
          </span>
        )}
        {row.quantity > 1 && (
          <span className="absolute bottom-0 right-0 bg-foreground/80 px-1 text-[10px] font-semibold tabular-nums text-background">
            ×{row.quantity}
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        {/* Tiêu đề tối đa 2 dòng; hover xem đầy đủ (yêu cầu §Product Title). */}
        <Tooltip content={row.productName ?? undefined}>
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {row.productName ?? t('product.unknownName')}
          </p>
        </Tooltip>

        <div className="mt-0.5 space-y-px text-[11px] leading-tight text-muted-foreground">
          <MetaLine label={t('product.productId')} value={row.productId} mono />
          <MetaLine
            label={t('product.sku')}
            value={row.sellerSku ? `${row.sellerSku} × ${row.quantity}` : null}
            mono
          />
          <MetaLine label={t('product.variant')} value={row.skuName} />
          <MetaLine label={t('product.category')} value={row.productCategory} />
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {row.isPodCustomized && (
          <Badge variant="default" className="h-5 px-1.5 text-[10px]">
            <Palette className="mr-0.5 size-2.5" />
            POD
          </Badge>
        )}

        {/* Ảnh thu nhỏ Front/Back hiện ngay tại chỗ, hover để phóng to. */}
        <DesignThumbs
          front={design.front}
          back={design.back}
          onPreview={(src) => {
            const images = rowDesignImages(row);
            const index = Math.max(
              0,
              images.findIndex((image) => image.src === src),
            );
            onPreviewImages({ images, index });
          }}
        />

        {/* 🔴 Cột Product KHÔNG còn cảnh báo / nút ánh xạ ("Missing Product Mapping", "Needs
            manual mapping", "Map Product") — theo yêu cầu nghiệp vụ. Cấu hình sản phẩm cho nhà
            cung cấp nằm trong drawer Fulfill (Cấu hình sản phẩm) và màn hình Product Mapping;
            readiness ở backend vẫn chặn gửi đơn thiếu ánh xạ như cũ. */}

        <Tooltip
          content={
            design.state === 'READY'
              ? // Thiếu mặt sau là GHI CHÚ, không phải lỗi: §5 nói rõ sản phẩm chỉ cần
                // Front vẫn Ready. Backend cũng cho gửi.
                design.backMissing
                ? t('product.designMissingBackHint')
                : t('product.designReadyHint')
              : t('product.designMissingFrontHint')
          }
        >
          <Badge
            variant={design.state === 'READY' ? 'success' : 'warning'}
            className="h-6 whitespace-nowrap px-2 text-[11px]"
          >
            {design.state === 'READY'
              ? design.backMissing
                ? t('product.designReadyNoBack')
                : t('product.designReady')
              : t('product.designMissingFront')}
          </Badge>
        </Tooltip>

        <Button
          variant={design.state === 'READY' ? 'outline' : 'default'}
          size="sm"
          className="h-6 whitespace-nowrap px-2 text-[11px]"
          onClick={(event) => {
            event.stopPropagation();
            onUploadDesign(firstUndesignedSource(row));
          }}
        >
          {design.state === 'READY' ? (
            <RefreshCw className="size-3" />
          ) : (
            <ImageUp className="size-3" />
          )}
          {design.state === 'READY' ? t('product.manageDesign') : t('product.uploadDesign')}
        </Button>
      </div>
    </li>
  );
}

/** Một dòng metadata dạng `Nhãn: giá trị` — gọn hơn grid vì cột đã hẹp sẵn. */
function MetaLine({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-1 truncate">
      <span className="shrink-0 opacity-70">{label}:</span>
      <span className={mono ? 'truncate font-mono' : 'truncate'}>{value}</span>
    </div>
  );
}
