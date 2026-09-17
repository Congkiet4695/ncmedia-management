'use client';

import Link from 'next/link';
import { ImageOff, Loader2, Package, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import { buildProductGallery, countHiddenImages } from '../product-images';
import type { ProductGalleryImage } from '../product-images';
import type { PodProductListItem } from '../types';

interface ProductTableProps {
  products: PodProductListItem[];
  loading?: boolean;
  /** ID các sản phẩm đang được tick. Trang cha sở hữu state này (xem `page.tsx`). */
  selectedIds?: string[];
  /** Bỏ trống ⇒ **ẩn cột chọn**. Không có hành động hàng loạt thì đừng mời người dùng tick. */
  onSelectionChange?: (ids: string[]) => void;
  /**
   * Mở bộ xem ảnh tại đúng tấm vừa bấm.
   *
   * 🔴 Bảng KHÔNG tự dựng lightbox. Một bộ xem dùng CHUNG ở cấp trang là bắt buộc: 20 dòng ×
   * 4 thumbnail sẽ thành 80 modal nằm sẵn trong DOM, và mở/đóng cái nào cũng render lại cả
   * bảng. Trang giữ state, bảng chỉ báo "người dùng vừa bấm ảnh thứ i của sản phẩm này".
   */
  onOpenImages?: (images: ProductGalleryImage[], index: number, alt: string) => void;
  /**
   * Mở màn hình sửa sản phẩm.
   *
   * 🔴 Bỏ trống ⇒ **ẩn hẳn nút Sửa**. Trang cha quyết định dựa trên quyền `pod.product.update`
   * — và backend kiểm lại quyền đó ở mỗi request, nên đây chỉ là chuyện đừng mời người dùng
   * bấm một nút chắc chắn bị từ chối.
   */
  onEdit?: (productId: string) => void;
}

/** Số ảnh phụ hiển thị cạnh ảnh chính. Vượt quá ⇒ gộp vào chỉ báo `+N`. */
const EXTRA_THUMBNAILS = 3;

/**
 * Bảng danh sách sản phẩm đã đồng bộ.
 *
 * Bố cục theo nguyên tắc: **một dòng = một sản phẩm**, metadata nhận diện (ID, SKU, shop,
 * kết nối, danh mục) gom vào MỘT cột "Thông tin sản phẩm"; các cột còn lại là những thứ
 * người vận hành quét dọc để so sánh giữa các dòng (giá, chất lượng listing, trạng thái,
 * ngày thêm).
 *
 * 🔴 Vì sao không tách ID/SKU/Shop/Kết nối thành cột riêng: bảng sẽ rộng ~1800px và phải
 * cuộn ngang để đọc trạng thái — đúng cột quan trọng nhất lại là cột khuất.
 */
export function ProductTable({
  products,
  loading,
  selectedIds,
  onSelectionChange,
  onOpenImages,
  onEdit,
}: ProductTableProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime, formatNumber } = useLocaleFormat();

  const selectable = Boolean(onSelectionChange);
  const selected = new Set(selectedIds ?? []);
  const pageIds = products.map((product) => product.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someSelected = pageIds.some((id) => selected.has(id));

  const toggleOne = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange?.([...next]);
  };

  // Chỉ thao tác trên các dòng của TRANG HIỆN TẠI — lựa chọn ở trang khác giữ nguyên.
  const toggleAll = (checked: boolean) => {
    const next = new Set(selected);
    for (const id of pageIds) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    onSelectionChange?.([...next]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Package className="size-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{t('products.empty')}</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="w-[1%]">
              <Checkbox
                checked={allSelected}
                indeterminate={someSelected && !allSelected}
                onChange={(event) => toggleAll(event.target.checked)}
                aria-label={t('products.columns.selectAll')}
              />
            </TableHead>
          )}
          <TableHead className="w-[196px]">{t('products.columns.images')}</TableHead>
          <TableHead className="min-w-[320px]">{t('products.columns.product')}</TableHead>
          <TableHead className="w-[140px] text-right">{t('products.columns.price')}</TableHead>
          <TableHead className="w-[130px]">{t('products.columns.listingQuality')}</TableHead>
          <TableHead className="w-[140px]">{t('products.columns.status')}</TableHead>
          <TableHead className="w-[150px]">{t('products.columns.createdAt')}</TableHead>
          <TableHead className="w-[1%]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id} className={cn(selected.has(product.id) && 'bg-muted/40')}>
            {selectable && (
              <TableCell className="align-top">
                <Checkbox
                  checked={selected.has(product.id)}
                  onChange={(event) => toggleOne(product.id, event.target.checked)}
                  aria-label={product.title ?? product.tiktokProductId}
                />
              </TableCell>
            )}

            <TableCell className="align-top">
              <ImageStrip product={product} onOpen={onOpenImages} />
            </TableCell>

            <TableCell className="align-top">
              <ProductInfo product={product} />
            </TableCell>

            <TableCell className="align-top text-right">
              <p className="tabular-nums font-medium">{formatPriceRange(product)}</p>
              {/* Số SKU + tồn kho từng là hai cột riêng. Chúng đi kèm giá về mặt ý nghĩa
                  (giá nào, của bao nhiêu SKU, còn bao nhiêu hàng) nên gộp vào đây thay vì
                  chiếm thêm hai cột — dữ liệu không mất đi chỗ nào. */}
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {t('products.skuInventory', {
                  skus: formatNumber(product.skuCount),
                  inventory: formatNumber(product.totalInventory),
                })}
              </p>
            </TableCell>

            <TableCell className="align-top">
              <ListingQuality tier={product.listingQualityTier} />
            </TableCell>

            <TableCell className="align-top">
              <ProductStatusBadge status={product.status} />
              {product.auditStatus && (
                <p className="mt-1 text-xs text-muted-foreground">{product.auditStatus}</p>
              )}
            </TableCell>

            <TableCell className="align-top text-sm">
              <p className="whitespace-nowrap">{formatDateTime(product.createdAt)}</p>
              {/* "Đồng bộ lần cuối" từng là một cột riêng — giữ lại dưới dạng dòng phụ vì nó
                  trả lời cùng một câu hỏi (dữ liệu này cũ tới mức nào). */}
              <p className="mt-0.5 whitespace-nowrap text-xs text-muted-foreground">
                {t('products.lastSyncedShort', {
                  value: product.lastSyncedAt ? formatDateTime(product.lastSyncedAt) : '—',
                })}
              </p>
            </TableCell>

            <TableCell className="align-top">
              <div className="flex flex-col gap-1.5">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/dashboard/pod/products/${product.id}`}>
                    {t('common:action.viewDetail')}
                  </Link>
                </Button>
                {onEdit && (
                  <Button variant="outline" size="sm" onClick={() => onEdit(product.id)}>
                    <Pencil className="size-3.5" />
                    {t('common:action.edit')}
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Cột **Thông tin sản phẩm** — tên + mọi metadata nhận diện.
 *
 * Dòng nào không có dữ liệu thì BIẾN MẤT hẳn, không để nhãn trống: một sản phẩm thiếu
 * thương hiệu không được đẩy cả bảng cao thêm một dòng chỉ để hiện dấu gạch.
 */
function ProductInfo({ product }: { product: PodProductListItem }) {
  const { t } = useTranslation('pod');
  const title = product.title?.trim();

  return (
    <div className="min-w-0 space-y-1.5">
      {/* Tên: tối đa 2 dòng, bản đầy đủ nằm ở tooltip — không bao giờ cắt mà không có
          cách đọc lại. Tooltip render qua portal nên không bị cắt bởi vùng cuộn ngang. */}
      <Tooltip content={title}>
        <p className="line-clamp-2 break-words font-medium leading-snug">{title || '—'}</p>
      </Tooltip>

      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p className="break-all">
          <span className="text-muted-foreground/70">{t('products.meta.id')}: </span>
          <span className="font-mono">{product.tiktokProductId}</span>
        </p>
        {product.sellerSku && (
          <p className="break-all">
            <span className="text-muted-foreground/70">{t('products.meta.sku')}: </span>
            <span className="font-mono">{product.sellerSku}</span>
            {product.skuCount > 1 && (
              <span className="ml-1">{t('products.meta.moreSkus', { count: product.skuCount - 1 })}</span>
            )}
          </p>
        )}
      </div>

      {(product.shopName || product.accountName) && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          {product.shopName && (
            <>
              <span className="text-muted-foreground/70">{t('products.meta.shop')}:</span>
              <Badge variant="muted" className="max-w-[180px] truncate">
                {product.shopName}
              </Badge>
              {/* Mã shop ở Seller Center — thứ người vận hành đối soát khi mở TikTok. */}
              {product.shopCode && (
                <Badge variant="default" className="font-mono">
                  {product.shopCode}
                </Badge>
              )}
            </>
          )}
          {product.accountName && (
            <>
              <span className="text-muted-foreground/70">{t('products.meta.profile')}:</span>
              <Badge variant="muted" className="max-w-[160px] truncate">
                {product.accountName}
              </Badge>
            </>
          )}
        </div>
      )}

      {(product.categoryName || product.brandName) && (
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {product.categoryName && (
            <Tooltip content={product.categoryName}>
              <span className="max-w-[220px] truncate">
                <span className="text-muted-foreground/70">{t('products.meta.category')}: </span>
                {product.categoryName}
              </span>
            </Tooltip>
          )}
          {product.brandName && (
            <span className="max-w-[160px] truncate">
              <span className="text-muted-foreground/70">{t('products.meta.brand')}: </span>
              {product.brandName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Dải ảnh: một ảnh chính + vài ảnh phụ + chỉ báo `+N`.
 *
 * 🔴 Thumbnail render bản NHỎ (`thumb`), bấm vào mở bản GỐC (`src`). Hai URL khác nhau và
 * đều có sẵn trong response — xem `buildProductGallery`.
 *
 * 🔴 `+N` dựng từ `imageCount` (backend đếm ở DB) chứ không phải độ dài mảng đã nhận: danh
 * sách ảnh đã bị CẮT ở server, tự đếm mảng đã nhận sẽ luôn ra "đủ rồi" và con số biến mất.
 */
function ImageStrip({
  product,
  onOpen,
}: {
  product: PodProductListItem;
  onOpen?: (images: ProductGalleryImage[], index: number, alt: string) => void;
}) {
  const { t } = useTranslation('pod');
  const alt = product.title ?? product.tiktokProductId;

  // MỘT mảng dùng cho cả render lẫn mở lightbox ⇒ chỉ số bấm vào luôn khớp ảnh mở ra.
  const gallery = buildProductGallery(product.mainImages);
  const extras = gallery.slice(1, 1 + EXTRA_THUMBNAILS);
  const shown = Math.min(gallery.length, 1 + EXTRA_THUMBNAILS);
  const hidden = countHiddenImages({
    totalOnServer: product.imageCount,
    received: product.mainImages.length,
    usable: gallery.length,
    shown,
  });

  // Không còn ảnh nào dùng được ⇒ ô trống, KHÔNG phải một thẻ `img` chắc chắn hỏng.
  if (gallery.length === 0) {
    return <Thumbnail className="size-14" iconClassName="size-5" />;
  }

  const open = (index: number) => onOpen?.(gallery, index, alt);

  return (
    <div className="flex items-start gap-1.5">
      <Thumbnail
        image={gallery[0]}
        alt={alt}
        className="size-14"
        iconClassName="size-5"
        label={t('products.images.viewImage', { index: 1, total: gallery.length, name: alt })}
        onOpen={onOpen && (() => open(0))}
      />
      {(extras.length > 0 || hidden > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {extras.map((image, index) => (
            <Thumbnail
              key={image.src}
              image={image}
              alt={alt}
              className="size-7"
              iconClassName="size-3"
              label={t('products.images.viewImage', {
                index: index + 2,
                total: gallery.length,
                name: alt,
              })}
              onOpen={onOpen && (() => open(index + 1))}
            />
          ))}
          {hidden > 0 && (
            // Chỉ báo, KHÔNG phải nút: những ảnh này chưa được server gửi về nên không có URL
            // nào để mở. Cho bấm sẽ mở lại đúng bộ ảnh cũ — hứa một đằng làm một nẻo.
            <span
              title={t('products.images.moreHint', { count: hidden })}
              className="flex size-7 shrink-0 items-center justify-center rounded border bg-muted text-[10px] font-medium text-muted-foreground"
            >
              +{hidden}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Một ô ảnh.
 *
 * Có `onOpen` ⇒ render thành `<button>` thật, KHÔNG phải `<div onClick>`: nút gốc đã có sẵn
 * focus bằng Tab, kích hoạt bằng Enter/Space và được trình đọc màn hình công bố đúng — ba
 * thứ mà một thẻ `div` phải tự dựng lại và thường dựng thiếu.
 */
function Thumbnail({
  image,
  alt,
  className,
  iconClassName,
  label,
  onOpen,
}: {
  image?: ProductGalleryImage;
  alt?: string;
  className: string;
  iconClassName: string;
  label?: string;
  onOpen?: () => void;
}) {
  if (!image) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md border bg-muted',
          className,
        )}
      >
        <ImageOff className={cn('text-muted-foreground', iconClassName)} />
      </div>
    );
  }

  const picture = (
    // Ảnh do TikTok CDN phục vụ, domain thay đổi theo thị trường ⇒ dùng <img> thay vì
    // next/image để không phải khai báo remotePatterns cho từng CDN.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.thumb}
      alt={alt ?? ''}
      // `lazy` giữ nguyên: bảng 20 dòng × 4 ảnh vẫn chỉ tải phần đang nhìn thấy. Bản GỐC
      // không bao giờ được tải ở đây — nó chỉ được yêu cầu khi lightbox thực sự mở.
      loading="lazy"
      // `object-cover` + khung vuông: ảnh sản phẩm TikTok có đủ tỉ lệ, `fill` sẽ làm méo.
      className={cn('size-full rounded-md object-cover')}
      onError={(event) => {
        // Link ảnh của TikTok có hạn dùng. Ẩn thẻ hỏng đi để không hiện icon "ảnh vỡ"
        // của trình duyệt giữa một bảng dữ liệu.
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
  );

  if (!onOpen) {
    return <div className={cn('shrink-0 overflow-hidden rounded-md border bg-muted', className)}>{picture}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={cn(
        'shrink-0 cursor-pointer overflow-hidden rounded-md border bg-muted transition-shadow',
        'hover:ring-2 hover:ring-primary/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        className,
      )}
    >
      {picture}
    </button>
  );
}

/** Số vạch của thanh chất lượng — đúng bằng số hạng TikTok định nghĩa (POOR/FAIR/GOOD). */
const QUALITY_STEPS = ['POOR', 'FAIR', 'GOOD'] as const;

const QUALITY_BAR_COLOR: Record<string, string> = {
  POOR: 'bg-destructive',
  FAIR: 'bg-amber-500',
  GOOD: 'bg-emerald-500',
};

const QUALITY_TEXT_COLOR: Record<string, string> = {
  POOR: 'text-destructive',
  FAIR: 'text-amber-600 dark:text-amber-400',
  GOOD: 'text-emerald-600 dark:text-emerald-400',
};

/**
 * Chất lượng listing — hiển thị NGUYÊN giá trị backend trả về kèm thanh mức độ.
 *
 * 🔴 Không tự chấm điểm ở frontend: đây là số liệu của TikTok (chỉ có ở thị trường US).
 * Giá trị lạ vẫn hiện nguyên văn, chỉ không tô màu và không có thanh — thà thấy chuỗi lạ
 * còn hơn thấy một thanh đầy vạch do frontend đoán ra.
 */
export function ListingQuality({ tier }: { tier: string | null }) {
  const { t } = useTranslation('pod');

  if (!tier) {
    return (
      <Tooltip content={t('products.listingQuality.unavailableHint')}>
        <span className="text-sm text-muted-foreground">—</span>
      </Tooltip>
    );
  }

  const normalized = tier.toUpperCase();
  const step = QUALITY_STEPS.indexOf(normalized as (typeof QUALITY_STEPS)[number]);

  return (
    <div className="space-y-1">
      <p className={cn('text-xs font-semibold tracking-wide', QUALITY_TEXT_COLOR[normalized])}>
        {normalized}
      </p>
      {step >= 0 && (
        <div className="flex gap-0.5" aria-hidden>
          {QUALITY_STEPS.map((_, index) => (
            <span
              key={index}
              className={cn(
                'h-1.5 w-4 rounded-sm',
                index <= step ? QUALITY_BAR_COLOR[normalized] : 'bg-muted',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Nhãn trạng thái.
 *
 * 🔴 Không map cứng danh sách trạng thái: TikTok thêm giá trị mới thường xuyên. Chỉ tô màu
 * vài giá trị đã biết, còn lại hiển thị NGUYÊN VĂN — thà thấy chuỗi lạ còn hơn thấy sai.
 */
export function ProductStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-muted-foreground">—</span>;

  const variant =
    status === 'ACTIVATE'
      ? 'success'
      : status === 'DRAFT'
        ? 'muted'
        : status === 'DEACTIVATED' || status === 'FREEZE'
          ? 'destructive'
          : 'default';

  return <Badge variant={variant}>{status}</Badge>;
}

/** "19.99 – 24.99 USD" (một giá thì chỉ hiện một số). */
function formatPriceRange(product: PodProductListItem): string {
  if (!product.minPrice) return '—';
  const suffix = product.currency ? ` ${product.currency}` : '';
  if (!product.maxPrice || product.minPrice === product.maxPrice) {
    return `${product.minPrice}${suffix}`;
  }
  return `${product.minPrice} – ${product.maxPrice}${suffix}`;
}
