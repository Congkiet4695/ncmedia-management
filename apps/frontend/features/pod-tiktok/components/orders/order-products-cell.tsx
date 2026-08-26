'use client';

import { ImageIcon, ImageUp, Link2, Link2Off, Palette, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
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
  /** Mở dialog khai Product Mapping cho một dòng sản phẩm chưa ánh xạ. */
  onMapProduct: (row: OrderProductRow) => void;
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
  onMapProduct,
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
          onMapProduct={onMapProduct}
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
  onMapProduct,
  onPreviewImages,
}: {
  row: OrderProductRow;
  /** Vị trí của dòng này trong đơn — để lightbox mở đúng ảnh được bấm. */
  rowIndex: number;
  /** Mọi dòng của đơn — để lướt qua ảnh các sản phẩm khác mà không phải đóng lightbox. */
  allRows: OrderProductRow[];
  onUploadDesign: (item: PodOrderItem) => void;
  onMapProduct: (row: OrderProductRow) => void;
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
    const clicked = allRows[rowIndex]?.skuImage;
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
        disabled={!row.skuImage}
        aria-label={t('product.viewImage')}
        className={`${THUMB} relative shrink-0 overflow-hidden rounded border bg-muted/40 ${
          row.skuImage ? 'cursor-zoom-in' : 'cursor-default'
        }`}
      >
        {row.skuImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.skuImage}
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

        {/* 🔴 TRẠNG THÁI ÁNH XẠ và TRẠNG THÁI DESIGN hiện SONG SONG, không loại trừ nhau.
            Design và Product Mapping là hai nghiệp vụ độc lập:
              · Design  trả lời "in cái gì"  → chỉ cần Product ID + Seller SKU
              · Mapping trả lời "in ở đâu"   → chỉ cần khi Fulfill
            Bản trước chỉ hiện MỘT trong hai: chưa ánh xạ là ẩn luôn nút Upload Design, buộc
            người dùng phải ánh xạ trước mới upload được — một ràng buộc không có thật. */}
        <MappingAction row={row} onMapProduct={onMapProduct} />

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

/**
 * Trạng thái ánh xạ + hành động tương ứng.
 *
 * 🔴 Ba trạng thái, ba hành động khác nhau — gộp lại thành một chữ "thiếu ánh xạ" là lý do
 * người dùng bấm mãi một nút không giải quyết được vấn đề của họ:
 *
 * | Trạng thái     | Nghĩa                                     | Việc phải làm                |
 * |----------------|-------------------------------------------|------------------------------|
 * | `NEED_MANUAL`  | máy tìm được nhiều ứng viên, không dám chọn | bấm Map Product, đã lọc sẵn |
 * | `MISSING`      | rà rồi không thấy gì                      | bấm Map Product, chọn từ đầu |
 * | `NO_PROVIDER`  | kết nối TikTok chưa gán nhà cung cấp      | sửa ở màn hình cấu hình      |
 *
 * `NO_PROVIDER` KHÔNG có nút: bấm vào cũng không khai được vì chưa biết khai cho nhà cung
 * cấp nào. Hiện một nút chắc chắn thất bại còn tệ hơn không hiện.
 */
function MappingAction({
  row,
  onMapProduct,
}: {
  row: OrderProductRow;
  onMapProduct: (row: OrderProductRow) => void;
}) {
  const { t } = useTranslation('pod');
  const { hasPermission } = useAuth();
  // Khai ánh xạ là một lời GHI (`POST /fulfillment/mappings`, quyền `fulfillment.mapping`).
  // Seller CÓ quyền này — đây là việc của Designer (§8) — nhưng vai trò tuỳ biến thì chưa
  // chắc, và nút chắc chắn nhận 403 thì không nên hiện.
  const canMap = hasPermission('fulfillment.mapping');

  if (row.mappingStatus === 'NO_PROVIDER') {
    return (
      <Tooltip content={t('product.mappingNoProviderHint')}>
        <Badge variant="muted" className="h-6 whitespace-nowrap px-2 text-[11px]">
          <Link2Off className="mr-1 size-3" />
          {t('product.mappingNoProvider')}
        </Badge>
      </Tooltip>
    );
  }

  const needManual = row.mappingStatus === 'NEED_MANUAL';

  return (
    <>
      <Tooltip
        content={
          needManual
            ? t('product.mappingNeedManualHint', { count: row.mappingCandidates.length })
            : t('product.designNoMappingHint')
        }
      >
        <Badge
          variant={needManual ? 'warning' : 'destructive'}
          className="h-6 whitespace-nowrap px-2 text-[11px]"
        >
          <Link2Off className="mr-1 size-3" />
          {needManual ? t('product.mappingNeedManual') : t('product.designNoMapping')}
        </Badge>
      </Tooltip>

      {canMap && (
        <Button
          variant="default"
          size="sm"
          className="h-6 whitespace-nowrap px-2 text-[11px]"
          onClick={(event) => {
            event.stopPropagation();
            onMapProduct(row);
          }}
        >
          <Link2 className="size-3" />
          {t('product.mapProduct')}
        </Button>
      )}
    </>
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
