'use client';

import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useResourceLogs } from '../hooks';
import type { PodResourceSyncStatus, PodResourceType } from '../types';

/** Màu badge theo trạng thái — hỏng phải đỏ, một phần phải vàng, không được xanh hết. */
const STATUS_VARIANT: Record<PodResourceSyncStatus, 'success' | 'warning' | 'destructive' | 'muted'> =
  {
    SUCCESS: 'success',
    PARTIAL: 'warning',
    FAILED: 'destructive',
    RUNNING: 'muted',
    IDLE: 'muted',
  };

/**
 * Nhật ký đồng bộ của một tài nguyên.
 *
 * Cột quan trọng nhất là **lỗi**: khi sync hỏng, thứ người vận hành cần là thông điệp
 * nguyên văn của TikTok (mã lỗi + đường dẫn tài liệu), không phải "thất bại, thử lại sau".
 */
export function ResourceLogDialog({
  open,
  resource,
  onClose,
}: {
  open: boolean;
  resource: PodResourceType | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();
  const logs = useResourceLogs({ resource: resource ?? undefined, limit: 50 }, open && Boolean(resource));

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="max-w-4xl"
      title={t('resources.logTitle', {
        resource: resource ? t(`resources.names.${resource}`) : '',
      })}
      description={t('resources.logHint')}
    >
      <div className="max-h-[60vh] overflow-auto">
        {logs.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (logs.data ?? []).length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t('resources.logEmpty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('resources.startedAt')}</TableHead>
                <TableHead>{t('listing.common.shop')}</TableHead>
                <TableHead>{t('resources.status')}</TableHead>
                <TableHead className="text-right">{t('resources.records')}</TableHead>
                <TableHead className="text-right">{t('resources.duration')}</TableHead>
                <TableHead>{t('resources.error')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(logs.data ?? []).map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDateTime(log.startedAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.shopName ?? (
                      <span className="text-muted-foreground">{t('resources.summaryRow')}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[log.status]}>{log.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{log.totalRecords}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(log.durationMs / 1000).toFixed(1)}s
                  </TableCell>
                  <TableCell className="max-w-[380px] text-xs text-destructive">
                    {log.errorMessage ?? ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Modal>
  );
}
