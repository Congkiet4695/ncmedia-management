'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from 'react-i18next';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { usePodSyncLogs } from '../hooks/use-pod-orders';
import { PodSyncStatusBadge } from './pod-order-status-badge';

interface SyncHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  /** Giới hạn theo một shop; bỏ trống = xem toàn bộ. */
  shopId?: string;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Sync History — nhật ký các lượt đồng bộ.
 * Hiển thị đủ số liệu Sprint 2 yêu cầu: thời gian bắt đầu/kết thúc, thời lượng,
 * tổng đơn, created/updated/skipped/failed và thông báo lỗi (kèm request_id của TikTok).
 */
export function SyncHistoryDialog({ open, onClose, shopId }: SyncHistoryDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const [page, setPage] = useState(1);
  const logsQuery = usePodSyncLogs({ page, limit: 10, shopId }, open);

  const items = logsQuery.data?.items ?? [];
  const meta = logsQuery.data?.meta;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('orders.syncHistory')}
      description={t('syncHistory.description')}
      className="max-w-5xl"
    >
      <div className="space-y-4">
        {logsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : logsQuery.isError ? (
          <p className="py-10 text-center text-sm text-destructive">
            {translateApiError(logsQuery.error)}
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <History className="size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('syncHistory.empty')}</p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('syncHistory.shop')}</TableHead>
                  <TableHead>{t('syncHistory.trigger')}</TableHead>
                  <TableHead>{t('syncHistory.phase')}</TableHead>
                  <TableHead>{t('syncHistory.status')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('syncHistory.startedAt')}</TableHead>
                  <TableHead className="whitespace-nowrap">{t('syncHistory.endedAt')}</TableHead>
                  <TableHead className="text-right">{t('syncHistory.duration')}</TableHead>
                  <TableHead className="text-right">{t('syncHistory.total')}</TableHead>
                  <TableHead className="text-right">{t('syncHistory.created')}</TableHead>
                  <TableHead className="text-right">{t('syncHistory.updated')}</TableHead>
                  <TableHead className="text-right">{t('syncHistory.skipped')}</TableHead>
                  <TableHead className="text-right">{t('syncHistory.failed')}</TableHead>
                  <TableHead className="text-right">{t('syncHistory.apiCalls')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="max-w-[150px] truncate">
                      {log.shopName ?? log.accountName ?? t('syncHistory.systemWide')}
                    </TableCell>
                    <TableCell className="text-xs">{log.trigger}</TableCell>
                    <TableCell>
                      <span
                        className={
                          log.phase === 'BACKFILL'
                            ? 'rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700'
                            : 'text-xs text-muted-foreground'
                        }
                        title={t(
                          log.phase === 'BACKFILL'
                            ? 'syncHistory.phaseBackfillHint'
                            : 'syncHistory.phaseIncrementalHint',
                        )}
                      >
                        {t(
                          log.phase === 'BACKFILL'
                            ? 'syncHistory.phaseBackfill'
                            : 'syncHistory.phaseIncremental',
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <PodSyncStatusBadge status={log.status} />
                      {log.errorMessage && (
                        <p
                          className="mt-1 max-w-[220px] truncate text-xs text-destructive"
                          title={
                            log.tiktokRequestId
                              ? `${log.errorMessage} (request_id: ${log.tiktokRequestId})`
                              : log.errorMessage
                          }
                        >
                          {log.errorCode ? `${log.errorCode}: ` : ''}
                          {log.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(log.startTime)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(log.endTime)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatDuration(log.durationMs)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {log.tiktokTotalCount !== null &&
                      log.tiktokTotalCount > log.totalOrders &&
                      log.status === 'SUCCESS' ? (
                        <span
                          className="text-amber-600"
                          title={t('syncHistory.missingOrdersHint', {
                            expected: log.tiktokTotalCount,
                            actual: log.totalOrders,
                          })}
                        >
                          {log.totalOrders}/{log.tiktokTotalCount}
                        </span>
                      ) : (
                        log.totalOrders
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600">
                      {log.created}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{log.updated}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {log.skipped}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {log.failed}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {log.apiCalls}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {meta && meta.total > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {t('syncHistory.pageWithRuns', {
                page: meta.page,
                totalPages: meta.totalPages,
                total: meta.total,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
                {t('common:action.previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('common:action.next')}
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
