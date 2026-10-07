'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type {
  PodFlashSaleBatchStatus,
  PodFlashSalePublishOutcome,
  PodFlashSalePublishStatus,
} from '../types';

/** Màu của từng trạng thái lô — dùng chung cho ô lô và chú thích. */
const BATCH_TONE: Record<PodFlashSaleBatchStatus, string> = {
  PENDING: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  PROCESSING: 'border-amber-400 bg-amber-400/20 text-amber-700 animate-pulse dark:text-amber-300',
  SUCCEEDED: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  PARTIAL: 'border-amber-500/60 bg-amber-500/15 text-amber-700 dark:text-amber-300',
  FAILED: 'border-destructive/60 bg-destructive/15 text-destructive',
  SKIPPED: 'border-dashed border-muted-foreground/40 bg-transparent text-muted-foreground',
};

/**
 * Tiến độ đẩy Flash Sale lên TikTok.
 *
 * 🔴 Mọi con số ở đây là SỰ THẬT của backend (`GET /pod/flash-sales/:id/publish-status`).
 * Không nội suy, không đếm giả cho "mượt": một thanh tiến trình tự chạy trong khi lô 12 đang
 * kẹt là nói dối đúng người đang cần biết sự thật.
 *
 * 🔴 Một lô hỏng KHÔNG chặn các lô sau: mỗi lô có kết quả riêng (SUCCEEDED / PARTIAL / FAILED /
 * SKIPPED). "Đang chờ" chỉ là SKU chưa gửi — SKU lỗi đếm riêng, không bị tính là "còn lại".
 * Có SKU lỗi thì KHÔNG hiển thị "thành công": thẻ báo "một phần" kèm danh sách lỗi mở rộng được.
 */
export function PublishProgressCard({
  status,
  className,
}: {
  status: PodFlashSalePublishStatus;
  className?: string;
}) {
  const { t } = useTranslation('pod');
  const [showFailures, setShowFailures] = useState(false);

  const total = status.totalBatches ?? status.batches.length;
  const processed =
    status.batches.length > 0 ? status.run.processedBatches : (status.doneBatches ?? 0);
  // Chưa biết tổng số lô ⇒ để 0. Thà thanh trống còn hơn một tỉ lệ bịa.
  const percent = total > 0 ? (processed / total) * 100 : 0;
  const publishing = status.status === 'PUBLISHING';
  // Dữ liệu cũ (chưa có kết quả lô): suy ra từ lô hỏng như trước.
  const outcome: PodFlashSalePublishOutcome | null =
    status.outcome ??
    (publishing
      ? 'RUNNING'
      : status.failedBatch !== null
        ? 'FAILED'
        : status.finishedAt
          ? 'SUCCEEDED'
          : null);

  // Chưa từng publish thì không có gì để nói.
  if (!outcome) return null;

  const tone =
    outcome === 'FAILED'
      ? 'border-destructive/40 bg-destructive/5'
      : outcome === 'PARTIAL'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'bg-muted/40';

  return (
    <div className={cn('rounded-lg border p-4', tone, className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {outcome === 'RUNNING' ? (
            <Loader2 className="size-4 animate-spin text-primary" />
          ) : outcome === 'FAILED' ? (
            <XCircle className="size-4 text-destructive" />
          ) : outcome === 'PARTIAL' ? (
            <AlertTriangle className="size-4 text-amber-600" />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-600" />
          )}
          {t(`flashSale.publish.outcome.${outcome}`)}
        </div>

        {/* 🔴 "X / N lô" — mỗi lô là MỘT request tới TikTok (tối đa 300 SKU), và tất cả đều vào
            CÙNG một hoạt động khuyến mãi. X là số lô ĐÃ CÓ KẾT QUẢ (kể cả lô lỗi). */}
        {total > 0 && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {t('flashSale.publish.batchProgress', { done: processed, total })}
          </span>
        )}
      </div>

      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'transition-all',
            outcome === 'FAILED'
              ? 'bg-destructive'
              : outcome === 'PARTIAL'
                ? 'bg-amber-500'
                : 'bg-emerald-500',
          )}
          style={{ width: `${percent}%` }}
        />
        {publishing && <div className="flex-1 animate-pulse bg-amber-400/60" />}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Counter
          label={t('flashSale.publish.counter.succeeded')}
          value={status.publishedItems}
          className="text-emerald-700 dark:text-emerald-300"
        />
        <Counter
          label={t('flashSale.publish.counter.failed')}
          value={status.failedItems}
          className={status.failedItems > 0 ? 'text-destructive' : undefined}
        />
        <Counter label={t('flashSale.publish.counter.pending')} value={status.pendingItems} />
        {status.run.skipped > 0 && (
          <Counter
            label={t('flashSale.publish.counter.skipped')}
            value={status.run.skipped}
            className="text-muted-foreground"
          />
        )}
      </div>

      {status.batches.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1" aria-label={t('flashSale.publish.batchesLabel')}>
          {status.batches.map((batch) => (
            <span
              key={batch.batch}
              title={[
                t(`flashSale.publish.batchStatus.${batch.status}`),
                t('flashSale.publish.batchCounts', {
                  succeeded: batch.succeeded,
                  failed: batch.failed,
                  total: batch.skus,
                }),
                batch.errorCode ? `[${batch.errorCode}] ${batch.errorMessage ?? ''}` : '',
              ]
                .filter(Boolean)
                .join(' — ')}
              className={cn(
                'inline-flex h-6 min-w-6 items-center justify-center rounded border px-1 text-[11px] font-medium tabular-nums',
                BATCH_TONE[batch.status],
              )}
            >
              {batch.batch}
            </span>
          ))}
        </div>
      )}

      {status.providerFlashSaleId && (
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {t('flashSale.publish.activityId', { id: status.providerFlashSaleId })}
        </p>
      )}

      {outcome !== 'RUNNING' && outcome !== 'SUCCEEDED' && status.errorMessage && (
        <p
          className={cn(
            'mt-2 text-xs',
            outcome === 'FAILED' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300',
          )}
        >
          {status.errorMessage}
        </p>
      )}

      {status.failures.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowFailures((value) => !value)}
            aria-expanded={showFailures}
            className="inline-flex items-center gap-1 text-xs font-medium text-destructive hover:underline"
          >
            {showFailures ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {t('flashSale.publish.failures.toggle', { count: status.failedItems })}
          </button>

          {showFailures && (
            <div className="mt-2 max-h-80 overflow-auto rounded border bg-background">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">
                      {t('flashSale.publish.failures.batch')}
                    </th>
                    <th className="px-2 py-1.5 font-medium">
                      {t('flashSale.publish.failures.product')}
                    </th>
                    <th className="px-2 py-1.5 font-medium">
                      {t('flashSale.publish.failures.sku')}
                    </th>
                    <th className="px-2 py-1.5 font-medium">
                      {t('flashSale.publish.failures.code')}
                    </th>
                    <th className="px-2 py-1.5 font-medium">
                      {t('flashSale.publish.failures.message')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {status.failures.map((failure) => (
                    <tr key={failure.itemId} className="border-t align-top">
                      <td className="px-2 py-1.5 tabular-nums">{failure.batch ?? '—'}</td>
                      <td className="max-w-[220px] px-2 py-1.5">
                        <p className="truncate" title={failure.productTitle ?? undefined}>
                          {failure.productTitle ?? '—'}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {failure.providerProductId ?? '—'}
                        </p>
                      </td>
                      <td className="px-2 py-1.5">
                        <p>{failure.variantName ?? failure.sellerSku ?? '—'}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {failure.providerVariantId ?? '—'}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono">
                        {failure.errorCode ?? '—'}
                      </td>
                      <td className="max-w-[360px] px-2 py-1.5">
                        <p className="line-clamp-3" title={failure.error ?? undefined}>
                          {failure.error ?? '—'}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {status.failedItems > status.failures.length && (
                <p className="border-t px-2 py-1.5 text-[11px] text-muted-foreground">
                  {t('flashSale.publish.failures.more', {
                    shown: status.failures.length,
                    total: status.failedItems,
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Counter({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  const { formatNumber } = useLocaleFormat();
  return (
    <div className="rounded border bg-background/60 px-2 py-1.5">
      <p className="text-muted-foreground">{label}</p>
      <p className={cn('text-base font-semibold tabular-nums', className)}>{formatNumber(value)}</p>
    </div>
  );
}
