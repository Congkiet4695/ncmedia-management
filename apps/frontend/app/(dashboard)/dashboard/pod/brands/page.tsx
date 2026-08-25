'use client';

import { useState } from 'react';
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
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import { useSyncedBrands } from '@/features/pod-listing/hooks/use-pod-listing';
import { ResourceSyncButton } from '@/features/pod-resource/components/resource-sync-button';

export default function PodBrandsPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.product.read" message={t('products.noPermission')}>
      <BrandsView />
    </RequirePermission>
  );
}

/**
 * **POD → Brands** — thương hiệu TikTok đã đồng bộ (chỉ đọc).
 *
 * `authorizedStatus` là thứ quan trọng nhất trên màn hình này: brand chưa được cấp quyền
 * thì listing dùng brand đó sẽ bị TikTok từ chối, biết trước vẫn hơn.
 */
function BrandsView() {
  const { t } = useTranslation('pod');
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Gõ tới đâu hỏi server tới đó — danh sách brand quá lớn để lọc tại chỗ.
  const keyword = useDebouncedValue(search.trim(), 300);

  const brandsQuery = useSyncedBrands({ keyword: keyword || undefined, page, pageSize: 50 });
  const brands = brandsQuery.data?.items ?? [];

  return (
    <TemplatePageShell
      title={t('listing.brands.title')}
      subtitle={t('listing.brands.subtitle')}
      actions={
        hasPermission('pod.product.sync') ? (
          <ResourceSyncButton resource="BRAND" label={t('resources.syncBrands')} />
        ) : undefined
      }
      loading={brandsQuery.isLoading}
      error={brandsQuery.error}
      empty={brands.length === 0}
      emptyMessage={t('listing.brands.empty')}
      onSearchChange={(value) => {
        setPage(1);
        setSearch(value);
      }}
      searchPlaceholder={t('listing.brands.searchPlaceholder')}
      meta={brandsQuery.data?.meta ?? null}
      onPageChange={setPage}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('listing.brands.name')}</TableHead>
            <TableHead>{t('listing.brands.tiktokId')}</TableHead>
            <TableHead>{t('listing.brands.authorized')}</TableHead>
            <TableHead>{t('listing.brands.status')}</TableHead>
            <TableHead>{t('listing.common.shop')}</TableHead>
            <TableHead>{t('listing.common.syncedAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brands.map((brand) => (
            <TableRow key={brand.id}>
              <TableCell className="font-medium">
                {brand.name ?? '—'}
                {/* Bản ghi No brand do hệ thống tạo vì TikTok không liệt kê — nói rõ ra để
                    người vận hành không đi tìm nó trong Seller Center. */}
                {brand.isSystem && (
                  <Badge variant="muted" className="ml-2">
                    {t('listing.brands.systemRecord')}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">{brand.tiktokBrandId}</TableCell>
              <TableCell>
                {brand.authorizedStatus ? (
                  <Badge variant={brand.authorizedStatus === 'AUTHORIZED' ? 'success' : 'muted'}>
                    {brand.authorizedStatus}
                  </Badge>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-sm">{brand.brandStatus ?? '—'}</TableCell>
              <TableCell className="text-sm">{brand.shop?.name ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {formatDateTime(brand.syncedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TemplatePageShell>
  );
}
