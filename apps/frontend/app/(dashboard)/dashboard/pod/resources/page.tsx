'use client';

import { useState } from 'react';
import { AlertTriangle, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RequirePermission } from '@/components/require-permission';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { ResourceLogDialog } from '@/features/pod-resource/components/resource-log-dialog';
import { ResourceSyncButton } from '@/features/pod-resource/components/resource-sync-button';
import { useResourceStatus } from '@/features/pod-resource/hooks';
import type { PodResourceStatus, PodResourceSyncStatus, PodResourceType } from '@/features/pod-resource/types';

const STATUS_VARIANT: Record<PodResourceSyncStatus, 'success' | 'warning' | 'destructive' | 'muted'> =
  {
    SUCCESS: 'success',
    PARTIAL: 'warning',
    FAILED: 'destructive',
    RUNNING: 'muted',
    IDLE: 'muted',
  };

export default function PodResourcesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.product.read" message={t('products.noPermission')}>
      <ResourcesView />
    </RequirePermission>
  );
}

/**
 * **POD → Resources** — nơi duy nhất kéo dữ liệu dùng chung của TikTok về cache.
 *
 * Mỗi tài nguyên một dòng: số bản ghi đang có, lần đồng bộ gần nhất, thời gian chạy,
 * trạng thái, nút Sync và nút xem nhật ký.
 *
 * 🔴 Trình tự có ý nghĩa: **Categories trước, Attributes sau** — thuộc tính lấy theo danh
 * mục nên chưa có danh mục thì nút Sync của Attributes bị khoá kèm lời giải thích, thay vì
 * cho bấm rồi trả về 0 bản ghi khó hiểu.
 */
function ResourcesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const canSync = hasPermission('pod.product.sync');
  const { formatDateTime } = useLocaleFormat();

  const status = useResourceStatus();
  const [logResource, setLogResource] = useState<PodResourceType | null>(null);

  const rows = status.data ?? [];
  const failing = rows.filter((row) => row.status === 'FAILED' && row.lastError);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('resources.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('resources.subtitle')}</p>
      </div>

      {failing.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="flex gap-3 pt-6">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('resources.hasErrors')}</p>
              {failing.map((row) => (
                <p key={row.resource} className="text-xs text-muted-foreground">
                  <span className="font-medium">{t(`resources.names.${row.resource}`)}</span>
                  {': '}
                  {row.lastError}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('resources.resource')}</TableHead>
                  <TableHead className="text-right">{t('resources.records')}</TableHead>
                  <TableHead>{t('resources.lastSync')}</TableHead>
                  <TableHead className="text-right">{t('resources.duration')}</TableHead>
                  <TableHead>{t('resources.status')}</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <ResourceRow
                    key={row.resource}
                    row={row}
                    canSync={canSync}
                    formatDateTime={formatDateTime}
                    onViewLog={() => setLogResource(row.resource)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {status.isLoading && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('listing.common.loading')}
            </p>
          )}
        </CardContent>
      </Card>

      <ResourceLogDialog
        open={logResource !== null}
        resource={logResource}
        onClose={() => setLogResource(null)}
      />
    </div>
  );
}

function ResourceRow({
  row,
  canSync,
  formatDateTime,
  onViewLog,
}: {
  row: PodResourceStatus;
  canSync: boolean;
  formatDateTime: (value: string | null | undefined) => string;
  onViewLog: () => void;
}) {
  const { t } = useTranslation('pod');
  const blocked = !row.ready;

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{t(`resources.names.${row.resource}`)}</p>
        <p className="text-xs text-muted-foreground">
          {t(`resources.descriptions.${row.resource}`)}
        </p>
        {blocked && row.dependsOn && (
          <p className="mt-1 text-xs text-warning-foreground">
            {t('resources.blockedBy', { resource: t(`resources.names.${row.dependsOn}`) })}
          </p>
        )}
      </TableCell>

      <TableCell className="text-right tabular-nums">
        {row.totalRecords.toLocaleString()}
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {row.lastSyncAt ? formatDateTime(row.lastSyncAt) : t('resources.never')}
      </TableCell>

      <TableCell className="text-right tabular-nums text-sm">
        {row.durationMs === null ? '—' : `${(row.durationMs / 1000).toFixed(1)}s`}
      </TableCell>

      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status]}>{row.status}</Badge>
        {row.lastError && (
          <p className="mt-1 max-w-[280px] truncate text-xs text-destructive" title={row.lastError}>
            {row.lastError}
          </p>
        )}
      </TableCell>

      <TableCell>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onViewLog}>
            <FileText className="size-4" />
            {t('resources.viewLog')}
          </Button>
          {canSync && (
            <ResourceSyncButton resource={row.resource} size="sm" disabled={blocked} />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
