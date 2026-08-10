'use client';

import { use, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Loader2, Package, Palette, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ImageLightbox } from '@/features/pod-tiktok/components/image-lightbox';
import { OrderProductList } from '@/features/pod-tiktok/components/order-product-list';
import { PodOrderStatusBadge } from '@/features/pod-tiktok/components/pod-order-status-badge';
import { UploadDesignDialog } from '@/features/pod-tiktok/components/upload-design-dialog';
import type { PodOrderItem } from '@/features/pod-tiktok/order-types';
import { usePodOrder } from '@/features/pod-tiktok/hooks/use-pod-orders';

export default function PodOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.tiktok.order.read" message={t('orders.noPermission')}>
      <DetailView id={id} />
    </RequirePermission>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{children}</span>
    </div>
  );
}

function formatMoney(value: number | null, currency: string | null): string {
  if (value === null) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

function DetailView({ id }: { id: string }) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const { data: order, isLoading, isError, error } = usePodOrder(id);
  const [designItem, setDesignItem] = useState<PodOrderItem | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/pod/orders">
            <ArrowLeft className="size-4" />
            {t('common:action.back', { ns: 'common' })}
          </Link>
        </Button>
        <p className="py-10 text-center text-sm text-destructive">
          {translateApiError(error)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon" aria-label={t('common:action.back', { ns: 'common' })}>
            <Link href="/dashboard/pod/orders">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="font-mono text-xl font-bold tracking-tight">{order.tiktokOrderId}</h1>
            <p className="text-sm text-muted-foreground">
              {order.shop.name} · {order.shop.region} ·{' '}
              {t('orderDetail.itemCount', { count: order.items.length })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {order.hasPodItem && (
            <Badge variant="default">
              <Palette className="mr-1 size-3" />
              POD
            </Badge>
          )}
          <PodOrderStatusBadge status={order.status} />
        </div>
      </div>

      {/* Cảnh báo nghiệp vụ quan trọng cho xưởng in */}
      {order.status === 'ON_HOLD' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <p>
            {t('orderDetail.onHoldWarningPrefix')} <strong>On Hold</strong>{' '}
            {t('orderDetail.onHoldWarningSuffix')}{' '}
            <strong>{t('orderDetail.onHoldWarningStrong')}</strong>
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('orderDetail.orderInfo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label={t('orderDetail.connection')}>{order.accountName}</InfoRow>
            <InfoRow label={t('orderDetail.shop')}>{order.shop.name}</InfoRow>
            <InfoRow label={t('orderDetail.orderType')}>{order.orderType ?? 'NORMAL'}</InfoRow>
            <InfoRow label={t('orderDetail.buyer')}>{order.buyerNickname ?? order.buyerEmail ?? '—'}</InfoRow>
            <InfoRow label={t('orderDetail.buyerMessage')}>{order.buyerMessage ?? '—'}</InfoRow>
            <InfoRow label={t('orderDetail.sellerNote')}>{order.sellerNote ?? '—'}</InfoRow>
            <InfoRow label={t('orderDetail.orderedAt')}>{formatDateTime(order.orderedAt)}</InfoRow>
            <InfoRow label={t('orderDetail.paidAt')}>{formatDateTime(order.paidTime)}</InfoRow>
            <InfoRow label={t('orderDetail.tiktokUpdatedAt')}>{formatDateTime(order.tiktokUpdatedAt)}</InfoRow>
            <InfoRow label={t('orderDetail.rtsSla')}>{formatDateTime(order.rtsSlaTime)}</InfoRow>
            {order.cancelReason && (
              <InfoRow label={t('orderDetail.cancelReason')}>
                <span className="text-destructive">
                  {order.cancelReason}
                  {order.cancellationInitiator ? ` (${order.cancellationInitiator})` : ''}
                </span>
              </InfoRow>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('orderDetail.paymentShipping')}</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label={t('orderDetail.grandTotal')}>
              {formatMoney(order.totalAmount, order.currency)}
            </InfoRow>
            <InfoRow label={t('orderDetail.subTotal')}>
              {formatMoney(order.subTotal, order.currency)}
            </InfoRow>
            <InfoRow label={t('orderDetail.shippingFee')}>
              {formatMoney(order.shippingFee, order.currency)}
            </InfoRow>
            <InfoRow label={t('orderDetail.tax')}>{formatMoney(order.tax, order.currency)}</InfoRow>
            <InfoRow label={t('orderDetail.sellerDiscount')}>
              {formatMoney(order.sellerDiscount, order.currency)}
            </InfoRow>
            <InfoRow label={t('orderDetail.platformDiscount')}>
              {formatMoney(order.platformDiscount, order.currency)}
            </InfoRow>
            <InfoRow label={t('orderDetail.fulfillmentType')}>{order.fulfillmentType ?? '—'}</InfoRow>
            <InfoRow label={t('orderDetail.shippingType')}>
              {order.shippingType === 'TIKTOK'
                ? 'TIKTOK (4PL)'
                : order.shippingType === 'SELLER'
                  ? 'SELLER (3PL)'
                  : (order.shippingType ?? '—')}
            </InfoRow>
            <InfoRow label={t('orderDetail.shippingProvider')}>{order.shippingProvider ?? '—'}</InfoRow>
            <InfoRow label={t('orderDetail.trackingNumber')}>
              {order.trackingNumber ? (
                <span className="font-mono text-xs">{order.trackingNumber}</span>
              ) : (
                '—'
              )}
            </InfoRow>
            <InfoRow label={t('orderDetail.recipientRegion')}>
              {[order.recipientRegionCode, order.recipientPostalCode].filter(Boolean).join(' · ') ||
                '—'}
            </InfoRow>
            <p className="pt-3 text-xs text-muted-foreground">
              <ShieldCheck className="mr-1 inline size-3.5" />
              {order.recipientMasked
                ? t('orderDetail.recipientMasked')
                : t('orderDetail.recipientEncrypted')}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {t('orderDetail.products', { count: order.items.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {order.items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Package className="size-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t('orderDetail.noProducts')}</p>
            </div>
          ) : (
            <OrderProductList
              items={order.items}
              onUploadDesign={setDesignItem}
              onPreviewDesign={setLightbox}
            />
          )}
        </CardContent>
      </Card>

      <UploadDesignDialog
        open={Boolean(designItem)}
        item={designItem}
        onClose={() => setDesignItem(null)}
      />

      <ImageLightbox open={Boolean(lightbox)} src={lightbox} onClose={() => setLightbox(null)} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('orderDetail.syncSection')}</CardTitle>
        </CardHeader>
        <CardContent>
          <InfoRow label={t('orderDetail.lastSyncedAt')}>{formatDateTime(order.lastSyncedAt)}</InfoRow>
          <InfoRow label={t('orderDetail.syncVersion')}>{order.syncVersion}</InfoRow>
          <InfoRow label={t('orderDetail.packageCount')}>{order.packages.length}</InfoRow>
        </CardContent>
      </Card>
    </div>
  );
}
