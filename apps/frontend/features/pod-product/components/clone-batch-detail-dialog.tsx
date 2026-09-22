'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, ImageOff, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { shopOptionLabel } from '@/features/pod-tiktok/shop-label';
import { useProductClone, useRetryProductClone } from '../hooks/use-product-clones';
import type { PodProductCloneTarget } from '../types';
import { CloneProgress, CloneStatusBadge } from './clone-status';

/**
 * Chi tiết MỘT lượt nhân bản: sản phẩm nguồn, shop nguồn, thời điểm, và **từng shop đích**
 * (trạng thái · TikTok Draft ID · Product ID · lỗi · thời gian).
 *
 * 🔴 Retry CHỈ hiện cho shop FAILED — shop SUCCESS / SKIPPED không có nút, và backend cũng từ
 * chối (400) nếu gọi tay. Chạy lại một shop đã thành công là tạo sản phẩm trùng trên TikTok.
 *
 * Tự làm mới 2 giây/lần khi lượt còn chạy (hook `useProductClone`) — job sống ở server, đóng
 * dialog không dừng gì.
 */
export function CloneBatchDetailDialog({ batchId, onClose }: { batchId: string | null; onClose: () => void }) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const batch = useProductClone(batchId ?? undefined);
  const retry = useRetryProductClone();

  if (!batchId) return null;
  const data = batch.data;

  const runRetry = (itemId?: string) =>
    void retry
      .mutateAsync({ id: batchId, itemId })
      .then(() => toast.success(t('cloneProducts.retry.started')))
      .catch((error: unknown) => toast.error(t('cloneProducts.retry.failed'), { description: translateApiError(error) }));

  return (
    <Modal
      open
      onClose={onClose}
      title={t('cloneProducts.detail.title')}
      className="max-w-5xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{t('cloneProducts.retry.hint')}</p>
          <div className="flex gap-2">
            {data && data.counts.failed > 0 && !data.running && (
              <Button variant="outline" disabled={retry.isPending} onClick={() => runRetry()}>
                {retry.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                {t('cloneProducts.retry.allFailed', { count: data.counts.failed })}
              </Button>
            )}
            <Button onClick={onClose}>{t('common:action.close')}</Button>
          </div>
        </div>
      }
    >
      {batch.error ? (
        <p className="py-10 text-center text-sm text-destructive">{translateApiError(batch.error)}</p>
      ) : !data ? (
        <div className="flex justify-center py-14">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* ---------- Tổng quan ---------- */}
          <section className="flex flex-wrap items-start gap-4 rounded-md border bg-muted/40 p-3">
            {data.product?.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.product.thumbnailUrl} alt="" className="size-16 shrink-0 rounded-md border object-cover" />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-md border bg-muted">
                <ImageOff className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="line-clamp-2 font-medium leading-snug">
                  {data.product?.title?.trim() || data.product?.tiktokProductId || data.name}
                </p>
                <CloneStatusBadge status={data.status} />
              </div>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                <Field label={t('cloneProducts.columns.sourceId')} mono value={data.product?.tiktokProductId ?? '—'} />
                <Field label={t('cloneProducts.columns.sourceShop')} value={data.sourceShop ? shopOptionLabel(data.sourceShop) : '—'} />
                <Field label={t('cloneProducts.columns.createdBy')} value={data.createdBy?.name ?? '—'} />
                <Field label={t('cloneProducts.columns.createdAt')} value={formatDateTime(data.createdAt)} />
                <Field label={t('cloneProducts.detail.startedAt')} value={data.startedAt ? formatDateTime(data.startedAt) : '—'} />
                <Field label={t('cloneProducts.detail.finishedAt')} value={data.finishedAt ? formatDateTime(data.finishedAt) : '—'} />
              </dl>
            </div>
            <CloneProgress batch={data} />
          </section>

          {data.lastError && <p className="text-sm text-destructive">{data.lastError}</p>}

          {/* ---------- Từng shop đích ---------- */}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('cloneProducts.columns.targetShop')}</TableHead>
                  <TableHead>{t('cloneProducts.columns.status')}</TableHead>
                  <TableHead>{t('cloneProducts.columns.draftId')}</TableHead>
                  <TableHead>{t('cloneProducts.columns.productId')}</TableHead>
                  <TableHead>{t('cloneProducts.columns.error')}</TableHead>
                  <TableHead>{t('cloneProducts.columns.updatedAt')}</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.targets.map((target) => (
                  <TargetRow
                    key={target.id}
                    target={target}
                    retrying={retry.isPending}
                    onRetry={data.running ? undefined : () => runRetry(target.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 gap-1">
      <dt className="shrink-0 text-muted-foreground/70">{label}:</dt>
      <dd className={mono ? 'truncate font-mono' : 'truncate'}>{value}</dd>
    </div>
  );
}

/** Một shop đích. Lỗi rút gọn trong bảng, "Xem lỗi" mở đầy đủ (mã TikTok, request id). */
function TargetRow({ target, retrying, onRetry }: { target: PodProductCloneTarget; retrying: boolean; onRetry?: () => void }) {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();
  const [expanded, setExpanded] = useState(false);
  const error = target.error?.trim();
  const canRetry = target.status === 'FAILED' && onRetry;
  // Draft ID và Product ID trên TikTok là cùng một id (Create Product AS_DRAFT rồi Edit LISTING) —
  // hiện tách cột theo yêu cầu, nhưng không bịa giá trị: thiếu thì "—".
  const draftId = target.tiktokDraftId ?? target.remoteProductId;
  const productId = target.tiktokProductId;

  return (
    <>
      <TableRow>
        <TableCell className="max-w-[220px]">
          <span className="line-clamp-2 font-medium">{shopOptionLabel(target.shop)}</span>
          {target.shop.region && <span className="text-xs text-muted-foreground">{target.shop.region}</span>}
        </TableCell>
        <TableCell>
          <CloneStatusBadge status={target.status} />
          {target.status === 'RETRYING' && target.retryCount > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">({target.retryCount})</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">{draftId ?? '—'}</TableCell>
        <TableCell className="font-mono text-xs">{productId ?? '—'}</TableCell>
        <TableCell className="max-w-[280px]">
          {error ? (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex items-start gap-1 text-left text-xs text-destructive hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown className="mt-0.5 size-3.5 shrink-0" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0" />}
              <span className={expanded ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}>
                {target.errorCode && <span className="mr-1 font-mono">[{target.errorCode}]</span>}
                {error}
              </span>
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(target.finishedAt ?? target.updatedAt)}
        </TableCell>
        <TableCell>
          {canRetry && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" title={t('cloneProducts.retry.one')} disabled={retrying} onClick={onRetry}>
                <RotateCcw className="size-4" />
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={7} className="text-xs">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              <Field label={t('cloneProducts.detail.startedAt')} value={target.startedAt ? formatDateTime(target.startedAt) : '—'} />
              <Field label={t('cloneProducts.detail.finishedAt')} value={target.finishedAt ? formatDateTime(target.finishedAt) : '—'} />
              <Field label={t('cloneProducts.detail.retryCount')} value={String(target.retryCount)} />
              {target.nextAttemptAt && <Field label={t('cloneProducts.detail.nextAttemptAt')} value={formatDateTime(target.nextAttemptAt)} />}
              {target.errorDetail &&
                Object.entries(target.errorDetail)
                  .filter(([, value]) => value !== null && value !== undefined && value !== '')
                  .map(([key, value]) => (
                    <Field key={key} label={key} mono value={typeof value === 'string' ? value : JSON.stringify(value)} />
                  ))}
            </dl>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
