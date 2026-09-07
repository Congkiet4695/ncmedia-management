'use client';

import { AlertTriangle, Globe, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
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
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { MasterDataSyncButton } from '@/features/pod-master-data/components/master-data-sync-button';
import { useMasterDataStatus } from '@/features/pod-master-data/hooks';
import type {
  PodMasterDataResourceStatus,
  PodMasterDataStatus,
} from '@/features/pod-master-data/types';

const STATUS_VARIANT: Record<
  PodMasterDataStatus,
  'success' | 'warning' | 'destructive' | 'muted'
> = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'destructive',
  RUNNING: 'muted',
  IDLE: 'muted',
};

export default function PodMasterDataPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission
      permission={['pod.product.read', 'platform.masterdata.read']}
      message={t('products.noPermission')}
    >
      <MasterDataView />
    </RequirePermission>
  );
}

/**
 * **POD → TikTok Master Data** — danh mục, thương hiệu và thuộc tính dùng chung toàn nền tảng.
 *
 * 🔴 Một màn hình cho HAI vai, khác nhau đúng một nút:
 *
 *   - **Super Admin** thấy số liệu + **Sync Now**.
 *   - **Admin tổ chức** thấy y hệt số liệu, KHÔNG có nút.
 *
 * Vì sao org admin vẫn được xem: trước đây họ phải tự bấm Sync ba lần mới dùng được
 * Template. Nay việc đó không còn là của họ — nhưng nếu giấu luôn màn hình thì khi dữ liệu
 * chưa được đồng bộ, họ chỉ thấy dropdown danh mục trống rỗng mà không biết vì sao và phải
 * hỏi ai. Con số ở đây trả lời đúng câu đó.
 *
 * `canSync` đến từ SERVER (permission `platform.masterdata.sync`), không suy ra từ tên role.
 */
function MasterDataView() {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();

  const status = useMasterDataStatus();
  const overview = status.data;
  const rows = overview?.resources ?? [];
  const canSync = overview?.canSync ?? false;
  const failing = rows.filter((row) => row.status === 'FAILED' && row.lastError);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Globe className="size-5 text-muted-foreground" />
            {t('masterData.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('masterData.subtitle')}</p>
        </div>
        {canSync && <MasterDataSyncButton onDone={() => void status.refetch()} />}
      </div>

      {/* Org admin cần biết vì sao mình không có nút Sync — nói thẳng thay vì để họ đi tìm. */}
      {!canSync && (
        <Card className="border-muted">
          <CardContent className="flex gap-3 pt-6">
            <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('masterData.readOnlyNotice')}</p>
          </CardContent>
        </Card>
      )}

      {failing.length > 0 && (
        <Card className="border-destructive/40">
          <CardContent className="flex gap-3 pt-6">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('masterData.hasErrors')}</p>
              {failing.map((row) => (
                <p key={row.resource} className="text-xs text-muted-foreground">
                  <span className="font-medium">{t(`masterData.names.${row.resource}`)}</span>
                  {': '}
                  {row.lastError}
                </p>
              ))}
              {/* Trấn an có căn cứ: lượt hỏng không có bước xoá nào — dữ liệu cũ còn nguyên. */}
              <p className="pt-1 text-xs text-muted-foreground">
                {t('masterData.failureKeepsData')}
              </p>
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
                  <TableHead>{t('masterData.resource')}</TableHead>
                  <TableHead className="text-right">{t('masterData.records')}</TableHead>
                  <TableHead>{t('masterData.lastSync')}</TableHead>
                  <TableHead className="text-right">{t('masterData.duration')}</TableHead>
                  <TableHead>{t('masterData.status')}</TableHead>
                  {canSync && <TableHead className="text-right" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <MasterDataRow
                    key={row.resource}
                    row={row}
                    canSync={canSync}
                    formatDateTime={formatDateTime}
                    onDone={() => void status.refetch()}
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
    </div>
  );
}

function MasterDataRow({
  row,
  canSync,
  formatDateTime,
  onDone,
}: {
  row: PodMasterDataResourceStatus;
  canSync: boolean;
  formatDateTime: (value: string | null | undefined) => string;
  onDone: () => void;
}) {
  const { t } = useTranslation('pod');
  const blocked = !row.ready;

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{t(`masterData.names.${row.resource}`)}</p>
        <p className="text-xs text-muted-foreground">
          {t(`masterData.descriptions.${row.resource}`)}
        </p>
        {blocked && row.dependsOn && (
          <p className="mt-1 text-xs text-warning-foreground">
            {t('masterData.blockedBy', { resource: t(`masterData.names.${row.dependsOn}`) })}
          </p>
        )}
      </TableCell>

      <TableCell className="text-right tabular-nums">
        {row.totalRecords.toLocaleString()}
      </TableCell>

      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {row.lastSyncAt ? formatDateTime(row.lastSyncAt) : t('masterData.never')}
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

      {canSync && (
        <TableCell>
          <div className="flex justify-end">
            <MasterDataSyncButton
              resources={[row.resource]}
              size="sm"
              variant="outline"
              disabled={blocked}
              onDone={onDone}
            />
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}
