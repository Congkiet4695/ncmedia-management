'use client';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
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
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import { useWarehouses } from '@/features/pod-listing/hooks/use-pod-listing';
import { ResourceSyncButton } from '@/features/pod-resource/components/resource-sync-button';

export default function PodWarehousesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <WarehousesView />
    </RequirePermission>
  );
}

/**
 * **POD → Warehouses** — kho hàng đồng bộ từ TikTok (Get Warehouse List).
 *
 * Kho là dữ liệu của TikTok, không tạo tay ở đây. Listing Template chỉ CHỌN kho từ danh
 * sách này — đó là lý do màn hình có nút đồng bộ nhưng không có nút thêm mới.
 */
function WarehousesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { formatDateTime } = useLocaleFormat();
  const { hasPermission } = useAuth();

  const warehousesQuery = useWarehouses();
  const warehouses = warehousesQuery.data ?? [];

  return (
    <TemplatePageShell
      title={t('listing.warehouses.title')}
      subtitle={t('listing.warehouses.subtitle')}
      loading={warehousesQuery.isLoading}
      error={warehousesQuery.error}
      empty={warehouses.length === 0}
      emptyMessage={t('listing.warehouses.empty')}
      actions={
        hasPermission('pod.product.sync') ? (
          // Dùng chung đường Resource Sync với Categories/Brands: có nhật ký, có trạng
          // thái, và quan trọng nhất là **báo đúng khi hỏng**. Bản cũ luôn báo "đồng bộ
          // thành công" kể cả khi TikTok từ chối mọi shop.
          <ResourceSyncButton resource="WAREHOUSE" label={t('listing.warehouses.sync')} />
        ) : undefined
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('listing.warehouses.name')}</TableHead>
            <TableHead>{t('listing.warehouses.tiktokId')}</TableHead>
            <TableHead>{t('listing.warehouses.type')}</TableHead>
            <TableHead>{t('listing.warehouses.region')}</TableHead>
            <TableHead>{t('listing.common.shop')}</TableHead>
            <TableHead>{t('listing.common.syncedAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {warehouses.map((warehouse) => (
            <TableRow key={warehouse.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{warehouse.name ?? '—'}</span>
                  {warehouse.isDefault && (
                    <Badge variant="success">{t('listing.common.default')}</Badge>
                  )}
                </div>
                {warehouse.effectStatus && (
                  <p className="text-xs text-muted-foreground">{warehouse.effectStatus}</p>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">{warehouse.tiktokWarehouseId}</TableCell>
              <TableCell className="text-sm">{warehouse.type ?? '—'}</TableCell>
              <TableCell className="text-sm">{warehouse.regionCode ?? '—'}</TableCell>
              <TableCell className="text-sm">{warehouse.shop?.name ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {formatDateTime(warehouse.syncedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TemplatePageShell>
  );
}
