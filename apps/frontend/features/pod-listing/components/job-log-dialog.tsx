'use client';

import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import {
  useListingJob,
  useListingJobItems,
  useListingJobLogs,
  useRetryListingJob,
} from '../hooks/use-pod-listing';
import { JobProgressBar } from './job-progress-bar';
import { ListingStatusBadge } from './listing-status-badge';
import type { PodListingJobItem } from '../types';

type Tab = 'ITEMS' | 'LOG' | 'RESPONSE';

/**
 * Chi tiết một lượt chạy: **từng sản phẩm**, **log theo bước**, **response TikTok**.
 *
 * 🔴 Ba thứ này phải ở cùng một chỗ. Khi 12/500 sản phẩm hỏng, câu hỏi luôn đi theo chuỗi:
 * cái nào hỏng → hỏng ở bước nào → TikTok trả về gì. Tách ra ba màn hình là bắt người ta
 * ghi id ra giấy rồi đi tìm.
 *
 * Chọn một sản phẩm ở tab Items thì tab Log và Response bám theo đúng sản phẩm đó.
 */
export function JobLogDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();

  const [tab, setTab] = useState<Tab>('ITEMS');
  const [itemId, setItemId] = useState<string | null>(null);

  const job = useListingJob(jobId ?? undefined);
  const running = job.data?.status === 'PENDING' || job.data?.status === 'PROCESSING';
  const items = useListingJobItems(jobId ?? undefined, { page: 1, limit: 200 }, running);
  const logs = useListingJobLogs(jobId ?? undefined, itemId ?? undefined, running);
  const retry = useRetryListingJob();

  if (!jobId) return null;

  const rows = items.data?.items ?? [];
  const selected = rows.find((row) => row.id === itemId) ?? null;
  const canRetry = hasPermission('pod.listing.publish') || hasPermission('pod.listing.run');

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'ITEMS', label: t('listing.publishHistory.tabItems') },
    { key: 'LOG', label: t('listing.jobs.logTitle') },
    { key: 'RESPONSE', label: t('listing.drafts.tabResponse') },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={job.data?.name ?? t('listing.publishHistory.viewDetail')}
      className="max-w-4xl"
    >
      <div className="space-y-4">
        {job.data && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ListingStatusBadge
                status={job.data.status}
                label={t(`listing.jobs.status.${job.data.status}`)}
              />
              <span>
                {t('listing.jobs.queueInfo', {
                  concurrency: job.data.concurrency,
                  retries: job.data.maxRetries,
                })}
              </span>
              {job.data.finishedAt && <span>· {formatDateTime(job.data.finishedAt)}</span>}
            </div>
            <JobProgressBar job={job.data} />
            {job.data.lastError && (
              <p className="text-sm text-destructive">{job.data.lastError}</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-b">
          <div className="flex gap-1">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={
                  tab === item.key
                    ? 'border-b-2 border-primary px-3 py-2 text-sm font-medium'
                    : 'px-3 py-2 text-sm text-muted-foreground hover:text-foreground'
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          {canRetry && (job.data?.failedItems ?? 0) > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={retry.isPending || running}
              onClick={() =>
                void retry
                  .mutateAsync({ id: jobId, itemIds: itemId ? [itemId] : undefined })
                  .then(() => toast.success(t('listing.jobs.retryStarted')))
                  .catch((error: unknown) => toast.error(translateApiError(error)))
              }
            >
              <RotateCcw className="size-4" />
              {itemId ? t('listing.publish.retryOne') : t('listing.jobs.retryFailed')}
            </Button>
          )}
        </div>

        {items.isLoading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : tab === 'ITEMS' ? (
          <ItemList rows={rows} selectedId={itemId} onSelect={setItemId} />
        ) : tab === 'LOG' ? (
          <LogList
            logs={logs.data?.items ?? []}
            loading={logs.isLoading}
            emptyLabel={t('listing.jobs.noLog')}
          />
        ) : (
          <ResponseBlock item={selected} emptyLabel={t('listing.publishHistory.pickItem')} />
        )}
      </div>
    </Modal>
  );
}

/** Từng sản phẩm trong lượt — bấm để lọc log và response theo đúng nó. */
function ItemList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: PodListingJobItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation('pod');

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{t('listing.jobs.empty')}</p>;
  }

  return (
    <div className="max-h-[45vh] space-y-1 overflow-y-auto">
      {rows.map((row) => {
        const title = row.sessionProduct?.title ?? row.product?.title ?? row.payload?.title ?? '—';
        const active = row.id === selectedId;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(active ? null : row.id)}
            className={`flex w-full items-start justify-between gap-3 rounded border p-2 text-left text-sm ${
              active ? 'border-primary bg-muted/50' : 'hover:bg-muted/30'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{title}</p>
              <p className="text-xs text-muted-foreground">
                {row.shop?.name ?? '—'}
                {row.remoteProductId ? ` · ${row.remoteProductId}` : ''}
                {row.retryCount > 0
                  ? ` · ${t('listing.jobs.retryCount')}: ${row.retryCount}`
                  : ''}
              </p>
              {/* Lỗi của TỪNG sản phẩm, ngay tại dòng của nó (yêu cầu §11). */}
              {row.error && <p className="text-xs text-destructive">{row.error}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {row.payload?.reviewStatus && (
                <ListingStatusBadge
                  status={row.payload.reviewStatus}
                  label={t(`listing.drafts.reviewStatus.${row.payload.reviewStatus}`)}
                />
              )}
              <ListingStatusBadge
                status={row.status}
                label={t(`listing.jobs.itemStatus.${row.status}`)}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Log theo bước — mỗi dòng là một mốc thật của pipeline. */
function LogList({
  logs,
  loading,
  emptyLabel,
}: {
  logs: Array<{
    id: string;
    level: string;
    step: string;
    message: string;
    createdAt: string;
    payload: Record<string, unknown> | null;
  }>;
  loading: boolean;
  emptyLabel: string;
}) {
  const { formatDateTime } = useLocaleFormat();

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (logs.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="max-h-[45vh] space-y-1 overflow-y-auto font-mono text-xs">
      {logs.map((log) => (
        <div key={log.id} className="flex gap-2 border-b py-1">
          <span className="w-32 shrink-0 text-muted-foreground">
            {formatDateTime(log.createdAt)}
          </span>
          <span className="w-28 shrink-0 text-muted-foreground">{log.step}</span>
          <span className={log.level === 'ERROR' ? 'text-destructive' : log.level === 'WARN' ? 'text-amber-600' : ''}>
            {log.message}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Response TikTok của sản phẩm đang chọn — bằng chứng "sàn trả về gì". */
function ResponseBlock({
  item,
  emptyLabel,
}: {
  item: PodListingJobItem | null;
  emptyLabel: string;
}) {
  const { t } = useTranslation('pod');

  if (!item) return <p className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>;

  const response = item.payload?.publishResponse ?? null;
  const request = item.payload?.publishRequest ?? null;

  if (!response && !request) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t('listing.drafts.noResponse')}
      </p>
    );
  }

  return (
    <div className="max-h-[45vh] space-y-3 overflow-y-auto">
      {request && (
        <div>
          <p className="mb-1 text-xs font-medium">{t('listing.drafts.tabRequest')}</p>
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(request, null, 2)}
          </pre>
        </div>
      )}
      {response && (
        <div>
          <p className="mb-1 text-xs font-medium">{t('listing.drafts.tabResponse')}</p>
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
