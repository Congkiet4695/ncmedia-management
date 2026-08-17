'use client';

import Link from 'next/link';
import { ImageOff, Loader2, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import type { PodProductListItem } from '../types';

interface ProductTableProps {
  products: PodProductListItem[];
  loading?: boolean;
}

/**
 * Bảng danh sách sản phẩm đã đồng bộ.
 *
 * Dùng bảng (không phải card như màn hình Đơn hàng) vì mỗi sản phẩm là MỘT dòng dữ liệu
 * đồng nhất — người vận hành cần quét nhanh theo cột giá / tồn kho / trạng thái.
 */
export function ProductTable({ products, loading }: ProductTableProps) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();

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
          <TableHead>{t('products.columns.product')}</TableHead>
          <TableHead>{t('products.columns.status')}</TableHead>
          <TableHead>{t('products.columns.category')}</TableHead>
          <TableHead className="text-right">{t('products.columns.skus')}</TableHead>
          <TableHead className="text-right">{t('products.columns.price')}</TableHead>
          <TableHead className="text-right">{t('products.columns.inventory')}</TableHead>
          <TableHead>{t('products.columns.shop')}</TableHead>
          <TableHead>{t('products.columns.lastSynced')}</TableHead>
          <TableHead className="w-[1%]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <Thumbnail url={product.thumbnailUrl} alt={product.title ?? ''} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{product.title ?? '—'}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {product.tiktokProductId}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <ProductStatusBadge status={product.status} />
              {product.auditStatus && (
                <p className="mt-1 text-xs text-muted-foreground">{product.auditStatus}</p>
              )}
            </TableCell>
            <TableCell className="max-w-[220px]">
              <p className="truncate text-sm">{product.categoryName ?? '—'}</p>
              {product.brandName && (
                <p className="truncate text-xs text-muted-foreground">{product.brandName}</p>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{product.skuCount}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPriceRange(product)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{product.totalInventory}</TableCell>
            <TableCell>
              <p className="truncate text-sm">{product.shopName ?? '—'}</p>
              <p className="truncate text-xs text-muted-foreground">{product.accountName ?? ''}</p>
            </TableCell>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
              {product.lastSyncedAt ? formatDateTime(product.lastSyncedAt) : '—'}
            </TableCell>
            <TableCell>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/pod/products/${product.id}`}>
                  {t('common:action.viewDetail')}
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted">
        <ImageOff className="size-5 text-muted-foreground" />
      </div>
    );
  }
  return (
    // Ảnh do TikTok CDN phục vụ, domain thay đổi theo thị trường ⇒ dùng <img> thay vì
    // next/image để không phải khai báo remotePatterns cho từng CDN.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      className="size-12 shrink-0 rounded-md border object-cover"
    />
  );
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
