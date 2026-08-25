'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
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
import { CategoryTemplateDialog } from '@/features/pod-listing/components/category-template-dialog';
import {
  TemplatePageShell,
  TemplateRowActions,
} from '@/features/pod-listing/components/template-page-shell';
import { TemplateTransferBar } from '@/features/pod-listing/components/template-transfer-bar';
import { useTemplateListState } from '@/features/pod-listing/hooks/use-template-list-state';
import {
  POD_LISTING_MARKETS,
  type PodCategoryTemplate,
  type PodListingMarket,
} from '@/features/pod-listing/types';

export default function CategoryTemplatesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <CategoryTemplatesView />
    </RequirePermission>
  );
}

/**
 * **POD → Templates → Category Templates**.
 *
 * Danh mục · brand · kho · size chart · video · kích thước kiện · thuộc tính — tất cả lấy
 * từ dữ liệu TikTok đã đồng bộ, không có gì viết cứng.
 */
function CategoryTemplatesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('pod.template.write');

  const state = useTemplateListState<PodCategoryTemplate>('categories', { withMarket: true });
  const [editing, setEditing] = useState<PodCategoryTemplate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <TemplatePageShell
        title={t('listing.categoryTemplates.title')}
        subtitle={t('listing.categoryTemplates.subtitle')}
        createLabel={t('listing.categoryTemplates.create')}
        onCreate={
          canWrite
            ? () => {
                setEditing(null);
                setDialogOpen(true);
              }
            : undefined
        }
        actions={
          <TemplateTransferBar
            kind="categories"
            query={state.query}
            canExport
            canImport={canWrite}
          />
        }
        loading={state.list.isLoading}
        error={state.list.error}
        empty={state.items.length === 0}
        emptyMessage={t('listing.categoryTemplates.empty')}
        onSearchChange={state.setSearch}
        sort={state.sort}
        status={{ value: state.status, onChange: state.setStatus }}
        filters={
          <Combobox
            value={state.market}
            onChange={(value) => state.setMarket(value as PodListingMarket | '')}
            options={[
              { value: '', label: t('listing.filters.allMarkets') },
              ...POD_LISTING_MARKETS.map((market) => ({ value: market, label: market })),
            ]}
            className="w-[150px]"
          />
        }
        meta={state.meta}
        onPageChange={state.setPage}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('listing.common.name')}</TableHead>
              <TableHead>{t('listing.common.market')}</TableHead>
              <TableHead>{t('listing.categoryTemplates.category')}</TableHead>
              <TableHead>{t('listing.categoryTemplates.brand')}</TableHead>
              <TableHead>{t('listing.categoryTemplates.warehouse')}</TableHead>
              <TableHead>{t('listing.categoryTemplates.attributesCount')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    {item.isDefault && <Badge variant="success">{t('listing.common.default')}</Badge>}
                    {!item.isActive && <Badge variant="muted">{t('listing.common.off')}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="muted">{item.market}</Badge>
                </TableCell>
                <TableCell className="max-w-[280px] truncate text-sm">
                  {item.categoryPath ?? item.categoryName ?? item.tiktokCategoryId}
                </TableCell>
                <TableCell className="text-sm">{item.brandName ?? '—'}</TableCell>
                <TableCell className="text-sm">{item.warehouse?.name ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{item.attributes?.length ?? 0}</TableCell>
                <TableCell>
                  <TemplateRowActions
                    onEdit={
                      canWrite
                        ? () => {
                            setEditing(item);
                            setDialogOpen(true);
                          }
                        : undefined
                    }
                    onClone={canWrite ? () => void state.handleClone(item) : undefined}
                    onDelete={canWrite ? () => void state.handleDelete(item) : undefined}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TemplatePageShell>

      <CategoryTemplateDialog
        open={dialogOpen}
        template={editing}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
