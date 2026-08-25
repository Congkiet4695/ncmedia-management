'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PodListingJobStatus } from '../types';

/** Chỉ bốn con số làm nên thanh tiến độ — nhận cả job đầy đủ lẫn bản rút gọn của session. */
export interface JobProgress {
  status: PodListingJobStatus;
  totalItems: number;
  successItems: number;
  failedItems: number;
}

/**
 * Thanh tiến độ của một Listing Job.
 *
 * Ba màu trên cùng một thanh: **xong** (xanh), **hỏng** (đỏ), **đang chạy** (vàng, có sọc
 * động). Một thanh "đã chạy 60%" không nói được điều quan trọng nhất — 60% đó có bao nhiêu
 * phần thất bại.
 */
export function JobProgressBar({ job, className }: { job: JobProgress; className?: string }) {
  const { t } = useTranslation('pod');
  const total = Math.max(1, job.totalItems);
  const success = (job.successItems / total) * 100;
  const failed = (job.failedItems / total) * 100;
  const running = job.status === 'PROCESSING' || job.status === 'PENDING';
  const done = job.successItems + job.failedItems;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="bg-emerald-500 transition-all" style={{ width: `${success}%` }} />
        <div className="bg-destructive transition-all" style={{ width: `${failed}%` }} />
        {running && <div className="flex-1 animate-pulse bg-amber-400/60" />}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('listing.jobs.progressLabel', { done, total: job.totalItems })}
      </p>
    </div>
  );
}
