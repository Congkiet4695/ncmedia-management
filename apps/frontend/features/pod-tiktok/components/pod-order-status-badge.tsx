'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import type { PodOrderStatus, PodSyncStatus } from '../order-types';

const ORDER_VARIANT: Record<
  PodOrderStatus,
  'success' | 'warning' | 'destructive' | 'muted' | 'default'
> = {
  UNPAID: 'muted',
  ON_HOLD: 'warning',
  AWAITING_SHIPMENT: 'default',
  PARTIALLY_SHIPPING: 'default',
  AWAITING_COLLECTION: 'default',
  IN_TRANSIT: 'default',
  DELIVERED: 'success',
  COMPLETED: 'success',
  CANCELLED: 'destructive',
};

/**
 * Nhãn trạng thái đơn TikTok.
 *
 * Tách thành hook để cả badge lẫn dropdown bộ lọc dùng CHUNG một nguồn nhãn.
 * Giá trị lạ (TikTok bổ sung trạng thái mới) trả về nguyên văn mã trạng thái
 * thay vì để trống — UI không vỡ khi nhà cung cấp mở rộng enum.
 */
export function usePodOrderStatusLabel(): (status: PodOrderStatus) => string {
  const { t, i18n } = useTranslation('pod');
  return (status) => (i18n.exists(`pod:status.${status}`) ? t(`status.${status}`) : status);
}

export function PodOrderStatusBadge({
  status,
  cancellationInitiator,
  className,
}: {
  status: PodOrderStatus;
  /** `cancellation_initiator` của TikTok — chỉ hiển thị khi đơn `CANCELLED` (như "Canceled by Seller"). */
  cancellationInitiator?: string | null;
  className?: string;
}) {
  const label = usePodOrderStatusLabel();
  const { t, i18n } = useTranslation('pod');
  const badge = (
    <Badge variant={ORDER_VARIANT[status] ?? 'muted'} className={className}>
      {label(status)}
    </Badge>
  );
  if (status !== 'CANCELLED' || !cancellationInitiator) return badge;

  const key = cancellationInitiator.toUpperCase();
  const initiator = i18n.exists(`pod:orderCancelledBy.${key}`)
    ? t(`orderCancelledBy.${key}`)
    : t('orderCancelledBy.other', { who: cancellationInitiator });
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {badge}
      <span className="text-[11px] leading-tight text-destructive">{initiator}</span>
    </span>
  );
}

const SYNC_VARIANT: Record<
  PodSyncStatus,
  'success' | 'warning' | 'destructive' | 'muted' | 'default'
> = {
  RUNNING: 'default',
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
  SKIPPED: 'muted',
};

export function usePodSyncStatusLabel(): (status: PodSyncStatus) => string {
  const { t, i18n } = useTranslation('pod');
  return (status) => (i18n.exists(`pod:syncStatus.${status}`) ? t(`syncStatus.${status}`) : status);
}

export function PodSyncStatusBadge({ status }: { status: PodSyncStatus }) {
  const label = usePodSyncStatusLabel();
  return <Badge variant={SYNC_VARIANT[status] ?? 'muted'}>{label(status)}</Badge>;
}
