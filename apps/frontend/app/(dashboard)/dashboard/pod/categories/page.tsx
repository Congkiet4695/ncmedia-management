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
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import { useSyncedCategories } from '@/features/pod-listing/hooks/use-pod-listing';

export default function PodCategoriesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.product.read" message={t('products.noPermission')}>
      <CategoriesView />
    </RequirePermission>
  );
}

/**
 * **POD → Categories** — cây danh mục TikTok đã đồng bộ.
 *
 * Màn hình CHỈ ĐỌC: danh mục do TikTok định nghĩa, hệ thống không tạo/sửa.
 *
 * 🔴 Không còn nút **Sync Categories** ở đây. Cây danh mục là dữ liệu master TOÀN CỤC: một
 * Admin tổ chức bấm Sync nghĩa là ghi đè dữ liệu dùng chung của mọi tổ chức khác. Việc đồng
 * bộ thuộc về Super Admin (POD → TikTok Master Data) và chỉ cần làm một lần. Cột "Shop"
 * cũng đã bỏ — bản ghi không còn thuộc về shop nào.
 */
function CategoriesView() {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();
  const [search, setSearch] = useState('');

  const categoriesQuery = useSyncedCategories({ search: search || undefined });
  const categories = categoriesQuery.data ?? [];

  return (
    <TemplatePageShell
      title={t('listing.categories.title')}
      subtitle={t('listing.categories.subtitle')}
      loading={categoriesQuery.isLoading}
      error={categoriesQuery.error}
      empty={categories.length === 0}
      emptyMessage={t('listing.categories.empty')}
      onSearchChange={setSearch}
      searchPlaceholder={t('listing.categories.searchPlaceholder')}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('listing.categories.path')}</TableHead>
            <TableHead>{t('listing.categories.tiktokId')}</TableHead>
            <TableHead>{t('listing.categories.level')}</TableHead>
            <TableHead>{t('listing.categories.leaf')}</TableHead>
            <TableHead>{t('listing.common.syncedAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category.id}>
              <TableCell className="max-w-[420px]">
                <p className="truncate font-medium">{category.localName ?? '—'}</p>
                <p className="truncate text-xs text-muted-foreground">{category.path ?? ''}</p>
              </TableCell>
              <TableCell className="font-mono text-xs">{category.tiktokCategoryId}</TableCell>
              <TableCell className="tabular-nums">{category.level}</TableCell>
              <TableCell>
                {category.isLeaf ? (
                  <Badge variant="success">{t('listing.categories.leafYes')}</Badge>
                ) : (
                  <Badge variant="muted">{t('listing.categories.leafNo')}</Badge>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {formatDateTime(category.syncedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TemplatePageShell>
  );
}
