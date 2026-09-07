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
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import { useSyncedBrands } from '@/features/pod-listing/hooks/use-pod-listing';

export default function PodBrandsPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.product.read" message={t('products.noPermission')}>
      <BrandsView />
    </RequirePermission>
  );
}

/**
 * 🔴 Màn hình CHỈ ĐỌC, không còn nút Sync: thương hiệu là dữ liệu master TOÀN CỤC do Super
 * Admin đồng bộ một lần cho cả nền tảng (POD → TikTok Master Data). Cột "Shop" cũng đã bỏ —
 * bản ghi không còn thuộc về shop nào.
 *
 * **POD → Brands** — thương hiệu TikTok đã đồng bộ (chỉ đọc).
 *
 * `authorizedStatus` là thứ quan trọng nhất trên màn hình này: brand chưa được cấp quyền
 * thì listing dùng brand đó sẽ bị TikTok từ chối, biết trước vẫn hơn.
 */
function BrandsView() {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // TikTok có hàng chục nghìn thương hiệu ⇒ mặc định 50 dòng, người dùng đổi được.
  const [limit, setLimit] = useState(50);
  // Gõ tới đâu hỏi server tới đó — danh sách brand quá lớn để lọc tại chỗ.
  const keyword = useDebouncedValue(search.trim(), 300);

  const brandsQuery = useSyncedBrands({ keyword: keyword || undefined, page, limit });
  const brands = brandsQuery.data?.items ?? [];

  return (
    <TemplatePageShell
      title={t('listing.brands.title')}
      subtitle={t('listing.brands.subtitle')}
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
      onPageSizeChange={(next) => {
        setLimit(next);
        setPage(1);
      }}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('listing.brands.name')}</TableHead>
            <TableHead>{t('listing.brands.tiktokId')}</TableHead>
            <TableHead>{t('listing.brands.authorized')}</TableHead>
            <TableHead>{t('listing.brands.status')}</TableHead>
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
