'use client';

import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { JobProgressBar } from './job-progress-bar';
import { ListingStatusBadge } from './listing-status-badge';
import type { PodListingJob } from '../types';

/**
 * Tiến độ của lượt Publish đang chạy.
 *
 * ```
 *   Publishing…   12 / 100      Success: 10   Failed: 2
 * ```
 *
 * 🔴 Đóng màn hình không dừng job: lượt chạy sống ở SERVER, thẻ này chỉ hỏi lại trạng thái.
 * Vì thế nó vẫn hiện ra khi người dùng quay lại giữa chừng — thứ duy nhất mất đi là con số
 * đang nhích, không phải công việc.
 */
export function PublishProgressCard({
  job,
  onCancel,
  onRetry,
  canRun,
}: {
  job: PodListingJob;
  onCancel?: () => void;
  onRetry?: () => void;
  canRun: boolean;
}) {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();

  const running = job.status === 'PROCESSING' || job.status === 'PENDING';
  const done = job.successItems + job.failedItems;
  const hasFailure = job.failedItems > 0;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {running && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <p className="font-medium">
                {running
                  ? t('listing.publish.progressTitle', { done, total: job.totalItems })
                  : job.name}
              </p>
              <ListingStatusBadge
                status={job.status}
                label={t(`listing.jobs.status.${job.status}`)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('listing.publish.successFailed', {
                success: job.successItems,
                failed: job.failedItems,
              })}
              {job.startedAt ? ` · ${formatDateTime(job.startedAt)}` : ''}
              {job.durationMs === null ? '' : ` · ${(job.durationMs / 1000).toFixed(1)}s`}
            </p>
          </div>

          <div className="flex gap-2">
            {canRun && running && onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                {t('listing.jobs.cancel')}
              </Button>
            )}
            {canRun && !running && hasFailure && onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                {t('listing.publish.retryFailed')}
              </Button>
            )}
          </div>
        </div>

        <JobProgressBar job={job} />

        {/* Job chạy nền — nói thẳng ra để không ai ngồi giữ tab. */}
        {running && (
          <p className="text-xs text-muted-foreground">{t('listing.publish.backgroundHint')}</p>
        )}
        {job.lastError && <p className="text-sm text-destructive">{job.lastError}</p>}
      </CardContent>
    </Card>
  );
}
