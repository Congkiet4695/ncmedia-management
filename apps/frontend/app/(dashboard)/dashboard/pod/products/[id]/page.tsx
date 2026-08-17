'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, ImageOff, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ProductStatusBadge } from '@/features/pod-product/components/product-table';
import { usePodProduct, useResyncPodProduct } from '@/features/pod-product/hooks/use-pod-products';
import type { PodProductDetail } from '@/features/pod-product/types';

export default function PodProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation('pod');

  return (
    <RequirePermission permission="pod.product.read" message={t('products.noPermission')}>
      <ProductDetailView id={id} />
    </RequirePermission>
  );
}

/**
 * Chi tiết sản phẩm đã đồng bộ.
 *
 * Toàn bộ dữ liệu là bản sao đọc từ TikTok ⇒ màn hình CHỈ XEM. Hành động duy nhất là
 * "Đồng bộ lại" để kéo bản mới nhất về.
 */
function ProductDetailView({ id }: { id: string }) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const { hasPermission } = useAuth();

  const productQuery = usePodProduct(id);
  const resyncMutation = useResyncPodProduct();

  const handleResync = async () => {
    try {
      await resyncMutation.mutateAsync(id);
      toast.success(t('products.resync.success'));
    } catch (error) {
      toast.error(t('products.resync.failed'), { description: translateApiError(error) });
    }
  };

  if (productQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (productQuery.isError || !productQuery.data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="py-10 text-center text-sm text-destructive">
          {translateApiError(productQuery.error)}
        </p>
      </div>
    );
  }

  const product = productQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <BackLink />
          <h1 className="text-2xl font-bold tracking-tight">{product.title ?? '—'}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <ProductStatusBadge status={product.status} />
            {product.auditStatus && <Badge variant="muted">{product.auditStatus}</Badge>}
            <span className="font-mono text-xs text-muted-foreground">
              {product.tiktokProductId}
            </span>
          </div>
        </div>

        {hasPermission('pod.product.sync') && (
          <Button onClick={() => void handleResync()} disabled={resyncMutation.isPending}>
            {resyncMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {t('products.resync.action')}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-semibold">{t('products.detail.variants')}</h2>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('products.detail.variant')}</TableHead>
                  <TableHead>{t('products.detail.sellerSku')}</TableHead>
                  <TableHead className="text-right">{t('products.columns.price')}</TableHead>
                  <TableHead className="text-right">{t('products.columns.inventory')}</TableHead>
                  <TableHead>{t('products.columns.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {product.variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell>
                      <p className="font-medium">{variant.variantName ?? '—'}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {variant.tiktokSkuId}
                      </p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{variant.sellerSku ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {variant.salePrice
                        ? `${variant.salePrice}${variant.currency ? ` ${variant.currency}` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {variant.inventoryTotal}
                    </TableCell>
                    <TableCell>
                      <ProductStatusBadge status={variant.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold">{t('products.detail.info')}</h2>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <InfoRow label={t('products.columns.shop')} value={product.shopName} />
              <InfoRow label={t('products.detail.account')} value={product.accountName} />
              <InfoRow label={t('products.columns.category')} value={product.categoryPath} />
              <InfoRow label={t('products.detail.brand')} value={product.brandName} />
              <InfoRow
                label={t('products.detail.weight')}
                value={
                  product.packageWeight
                    ? `${product.packageWeight}${product.weightUnit ? ` ${product.weightUnit}` : ''}`
                    : null
                }
              />
              <InfoRow label={t('products.detail.dimensions')} value={product.packageDimensions} />
              <InfoRow
                label={t('products.detail.salesRegions')}
                value={product.salesRegions.join(', ') || null}
              />
              <InfoRow
                label={t('products.detail.updatedOnTiktok')}
                value={product.tiktokUpdatedAt ? formatDateTime(product.tiktokUpdatedAt) : null}
              />
              <InfoRow
                label={t('products.columns.lastSynced')}
                value={product.lastSyncedAt ? formatDateTime(product.lastSyncedAt) : null}
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <MediaCard product={product} />

      {product.attributes.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold">{t('products.detail.attributes')}</h2>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {product.attributes.map((attribute) => (
                <InfoRow
                  key={attribute.id}
                  label={attribute.name ?? attribute.tiktokAttributeId}
                  value={attribute.values.join(', ') || null}
                />
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {product.description && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold">{t('products.detail.description')}</h2>
          </CardHeader>
          <CardContent>
            {/*
              Mô tả là HTML do seller nhập trên TikTok. KHÔNG render bằng dangerouslySetInnerHTML:
              đây là nội dung từ nguồn ngoài, dựng HTML thô là mở cửa cho XSS. Hiển thị dạng
              văn bản thuần vẫn đủ để người vận hành đối chiếu nội dung.
            */}
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {product.description}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MediaCard({ product }: { product: PodProductDetail }) {
  const { t } = useTranslation('pod');
  const mainImages = product.images.filter((image) => !image.variantId);

  if (mainImages.length === 0 && product.videos.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">{t('products.detail.media')}</h2>
      </CardHeader>
      <CardContent className="space-y-4">
        {mainImages.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {mainImages.map((image) =>
              image.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={image.id}
                  src={image.thumbUrl ?? image.url}
                  alt={product.title ?? ''}
                  loading="lazy"
                  className="size-24 rounded-md border object-cover"
                />
              ) : (
                <div
                  key={image.id}
                  className="flex size-24 items-center justify-center rounded-md border bg-muted"
                >
                  <ImageOff className="size-5 text-muted-foreground" />
                </div>
              ),
            )}
          </div>
        )}

        {product.videos.map((video) =>
          video.url ? (
            <a
              key={video.id}
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm text-primary underline"
            >
              {t('products.detail.openVideo')}
            </a>
          ) : null,
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto max-w-[65%] break-words text-right font-medium">{value ?? '—'}</dd>
    </div>
  );
}

function BackLink() {
  const { t } = useTranslation('pod');
  return (
    <Link
      href="/dashboard/pod/products"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t('products.detail.back')}
    </Link>
  );
}
