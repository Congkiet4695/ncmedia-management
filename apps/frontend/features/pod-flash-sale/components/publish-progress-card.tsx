'use client';

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { PodFlashSalePublishStatus } from '../types';

/**
 * Tiến độ đẩy Flash Sale lên TikTok.
 *
 * 🔴 Mọi con số ở đây là SỰ THẬT của backend (`GET /pod/flash-sales/:id/publish-status`).
 * Không nội suy, không đếm giả cho "mượt": một thanh tiến trình tự chạy trong khi lô 12 đang
 * kẹt là nói dối đúng người đang cần biết sự thật.
 *
 * 🔴 Thẻ này tồn tại vì Publish KHÔNG còn là một request đồng bộ. Với 10.000 SKU, backend
 * tạo hoạt động khuyến mãi rồi trả về ngay; 34 lượt gọi TikTok chạy nền. Không có chỗ hiển
 * thị tiến độ thì "đang chạy" và "đã treo" nhìn giống hệt nhau.
 *
 * Thanh hai màu theo đúng khuôn `JobProgressBar` của Bulk Listing: phần đã xong, và phần
 * đang chạy (nhấp nháy) hoặc phần hỏng (đỏ).
 */
export function PublishProgressCard({
  status,
  className,
}: {
  status: PodFlashSalePublishStatus;
  className?: string;
}) {
  const { t } = useTranslation('pod');

  const total = status.totalBatches ?? 0;
  const done = status.doneBatches ?? 0;
  // Chưa biết tổng số lô ⇒ để 0. Thà thanh trống còn hơn một tỉ lệ bịa.
  const percent = total > 0 ? (done / total) * 100 : 0;
  const failed = status.failedBatch !== null;
  const running = status.live;

  // Chưa từng publish thì không có gì để nói.
  if (!running && !failed && !status.finishedAt) return null;

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        failed ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/40',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {running ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : failed ? (
            <AlertTriangle className="size-4 text-destructive" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-600" />
          )}
          {running
            ? t('flashSale.publish.running')
            : failed
              ? t('flashSale.publish.failed')
              : t('flashSale.publish.completed')}
        </div>

        {/* 🔴 "12 / 34 lô" — mỗi lô là MỘT request tới TikTok (tối đa 300 SKU), và tất cả
            đều vào CÙNG một hoạt động khuyến mãi. Con số này là thứ giải thích cho người
            vận hành vì sao một đợt lớn cần vài phút. */}
        {total > 0 && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {t('flashSale.publish.batchProgress', { done, total })}
          </span>
        )}
      </div>

      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('transition-all', failed ? 'bg-destructive' : 'bg-emerald-500')}
          style={{ width: `${percent}%` }}
        />
        {running && <div className="flex-1 animate-pulse bg-amber-400/60" />}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{t('flashSale.publish.itemsDone', { count: status.publishedItems })}</span>
        {status.pendingItems > 0 && (
          <span>{t('flashSale.publish.itemsPending', { count: status.pendingItems })}</span>
        )}
        {status.providerFlashSaleId && (
          <span className="font-mono">
            {t('flashSale.publish.activityId', { id: status.providerFlashSaleId })}
          </span>
        )}
      </div>

      {failed && (
        <p className="mt-2 text-xs text-destructive">
          {t('flashSale.publish.failedAtBatch', {
            batch: status.failedBatch,
            total,
            message: status.errorMessage ?? '',
          })}
        </p>
      )}
    </div>
  );
}
