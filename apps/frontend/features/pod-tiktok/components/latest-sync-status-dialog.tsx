'use client';

import { History, Loader2 } from 'lucide-react';
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
import { useLatestSyncStatus } from '../hooks/use-pod-orders';
import type { PodShopSyncType } from '../order-types';
import { PodSyncStatusBadge } from './pod-order-status-badge';

interface LatestSyncStatusDialogProps {
  open: boolean;
  onClose: () => void;
  /** Đồng bộ đơn hay sản phẩm — mỗi loại một dòng trạng thái riêng cho mỗi shop. */
  syncType: PodShopSyncType;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Latest Sync Status — MỘT dòng mỗi shop, luôn là lần đồng bộ gần nhất (không phải lịch sử, nên
 * không phân trang). Backend đã lọc theo phạm vi: Admin thấy mọi shop, Seller chỉ shop được gán.
 */
export function LatestSyncStatusDialog({ open, onClose, syncType }: LatestSyncStatusDialogProps) {
  const { t } = useTranslation(['pod', 'common']);
  const translateApiError = useApiError();
  const { formatDateTime } = useLocaleFormat();
  const statusQuery = useLatestSyncStatus(syncType, open);
  const items = statusQuery.data ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('latestSync.title')}
      description={t(
        syncType === 'ORDER' ? 'latestSync.descriptionOrder' : 'latestSync.descriptionProduct',
      )}
      className="max-w-6xl"
    >
      {statusQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : statusQuery.isError ? (
        <p className="py-10 text-center text-sm text-destructive">
          {translateApiError(statusQuery.error)}
        </p>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <History className="size-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('latestSync.empty')}</p>
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('latestSync.shop')}</TableHead>
                <TableHead>{t('latestSync.trigger')}</TableHead>
                <TableHead>{t('latestSync.status')}</TableHead>
                <TableHead className="whitespace-nowrap">{t('latestSync.startedAt')}</TableHead>
                <TableHead className="whitespace-nowrap">{t('latestSync.endedAt')}</TableHead>
                <TableHead className="text-right">{t('latestSync.duration')}</TableHead>
                <TableHead className="text-right">{t('latestSync.total')}</TableHead>
                <TableHead className="text-right">{t('latestSync.created')}</TableHead>
                <TableHead className="text-right">{t('latestSync.updated')}</TableHead>
                <TableHead className="text-right">{t('latestSync.failed')}</TableHead>
                <TableHead>{t('latestSync.error')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={`${item.syncType}-${item.shopId}`}>
                  <TableCell className="max-w-[180px]">
                    <p className="truncate font-medium">{item.shopName ?? '—'}</p>
                    {item.accountName && item.accountName !== item.shopName && (
                      <p className="truncate text-xs text-muted-foreground">{item.accountName}</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs">
                    {t(`latestSync.triggers.${item.trigger}`)}
                  </TableCell>
                  <TableCell>
                    <PodSyncStatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(item.startedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {item.finishedAt ? formatDateTime(item.finishedAt) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(item.durationMs)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.total}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600">
                    {item.created}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.updated}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">
                    {item.failed}
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    {item.errorMessage ? (
                      <p className="truncate text-xs text-destructive" title={item.errorMessage}>
                        {item.errorCode ? `${item.errorCode}: ` : ''}
                        {item.errorMessage}
                      </p>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Modal>
  );
}
