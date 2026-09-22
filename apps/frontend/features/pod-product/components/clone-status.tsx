'use client';

import { AlertTriangle, CheckCircle2, Clock, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PodProductCloneBatch, PodProductCloneStatus, PodProductCloneTargetStatus } from '../types';

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'muted' | 'default';

/**
 * Badge trạng thái của lượt nhân bản / từng shop đích — **icon + chữ**, màu chỉ là phụ.
 *
 * Một bảng cho cả hai vòng đời: tổng (PENDING/PROCESSING/SUCCESS/PARTIAL/FAILED) và từng shop
 * (thêm RETRYING/SKIPPED/CANCELLED). Người đọc mù màu vẫn phân biệt được bằng ký hiệu.
 */
const STATUS_STYLE: Record<
  PodProductCloneStatus | PodProductCloneTargetStatus,
  { variant: BadgeVariant; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  PENDING: { variant: 'muted', Icon: Clock },
  PROCESSING: { variant: 'warning', Icon: Loader2, spin: true },
  RETRYING: { variant: 'warning', Icon: Loader2, spin: true },
  SUCCESS: { variant: 'success', Icon: CheckCircle2 },
  PARTIAL: { variant: 'warning', Icon: AlertTriangle },
  FAILED: { variant: 'destructive', Icon: XCircle },
  SKIPPED: { variant: 'muted', Icon: MinusCircle },
  CANCELLED: { variant: 'muted', Icon: XCircle },
};

export function CloneStatusBadge({ status }: { status: PodProductCloneStatus | PodProductCloneTargetStatus }) {
  const { t } = useTranslation('pod');
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.PENDING;
  return (
    <Badge variant={style.variant} className="gap-1">
      <style.Icon className={cn('size-3', style.spin && 'animate-spin')} aria-hidden />
      {t(`cloneProducts.status.${status}`)}
    </Badge>
  );
}

/**
 * Thanh tiến độ `3/5 completed` + đếm theo loại. Tiến độ tính từ ITEM (backend `progress`),
 * không suy từ trạng thái tổng.
 */
export function CloneProgress({ batch, compact }: { batch: PodProductCloneBatch; compact?: boolean }) {
  const { t } = useTranslation('pod');
  const { progress, counts } = batch;
  const percent = progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);

  return (
    <div className={cn('space-y-1', compact ? 'min-w-[160px]' : 'min-w-[220px]')}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums">
          {t('cloneProducts.progress.completed', { done: progress.completed, total: progress.total })}
        </span>
        <span className="tabular-nums text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="flex h-full">
          <div className="h-full bg-emerald-500" style={{ width: `${(counts.success / Math.max(progress.total, 1)) * 100}%` }} />
          <div className="h-full bg-destructive" style={{ width: `${(counts.failed / Math.max(progress.total, 1)) * 100}%` }} />
          <div className="h-full bg-muted-foreground/40" style={{ width: `${((counts.skipped + counts.cancelled) / Math.max(progress.total, 1)) * 100}%` }} />
        </div>
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {t('cloneProducts.progress.summary', {
          success: counts.success,
          processing: counts.processing,
          failed: counts.failed,
          pending: counts.pending,
        })}
        {counts.skipped > 0 && ` · ${t('cloneProducts.progress.skipped', { count: counts.skipped })}`}
      </p>
    </div>
  );
}
