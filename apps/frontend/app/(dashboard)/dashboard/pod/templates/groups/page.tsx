'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useApiError } from '@/hooks/use-api-error';
import { useAuth } from '@/hooks/use-auth';
import { GroupTemplateDialog } from '@/features/pod-listing/components/group-template-dialog';
import {
  TemplatePageShell,
  TemplateRowActions,
} from '@/features/pod-listing/components/template-page-shell';
import { useDeletePodTemplate } from '@/features/pod-listing/hooks/use-pod-listing';
import { useTemplateListState } from '@/features/pod-listing/hooks/use-template-list-state';
import {
  POD_LISTING_MARKETS,
  type PodGroupTemplate,
  type PodListingMarket,
} from '@/features/pod-listing/types';

export default function GroupTemplatesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <GroupTemplatesView />
    </RequirePermission>
  );
}

/**
 * **POD → Templates → Group Template** — bộ 4 mảnh Category · SKU · Description · Image có tên,
 * chọn một lần ở Auto Listing / Custom Listing là điền đủ cả bốn.
 *
 * Mỗi dòng tóm tắt đủ bốn mảnh (đường dẫn danh mục, số SKU, số ảnh) để nhìn bảng là biết group
 * nào thiếu gì. Người chỉ có quyền đọc vẫn mở được chế độ Xem.
 */
function GroupTemplatesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const translateApiError = useApiError();
  const canWrite = hasPermission('pod.template.write');

  const state = useTemplateListState<PodGroupTemplate>('groups', { withMarket: true });
  const remove = useDeletePodTemplate('groups');
  const [selected, setSelected] = useState<PodGroupTemplate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtering = Boolean(state.search) || state.status !== 'ALL' || Boolean(state.market);

  const openDialog = (item: PodGroupTemplate | null) => {
    setSelected(item);
    setDialogOpen(true);
  };

  /**
   * Xoá có xác nhận, nói rõ hệ quả: group xoá MỀM; lượt đăng đã áp group giữ nguyên dữ liệu
   * (chúng giữ template con của riêng mình + ảnh chụp tên group).
   */
  const handleDelete = async (item: PodGroupTemplate) => {
    const used = item._count?.listingSessions ?? 0;
    const message =
      used > 0
        ? t('listing.groupTemplates.confirmDeleteUsed', { name: item.name, count: used })
        : t('listing.common.confirmDelete', { name: item.name });
    if (!window.confirm(message)) return;
    try {
      await remove.mutateAsync(item.id);
      toast.success(t('listing.common.deleted'));
    } catch (error) {
      toast.error(t('listing.common.deleteFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <>
      <TemplatePageShell
        title={t('listing.groupTemplates.title')}
        subtitle={t('listing.groupTemplates.subtitle')}
        createLabel={t('listing.groupTemplates.create')}
        onCreate={canWrite ? () => openDialog(null) : undefined}
        loading={state.list.isLoading}
        error={state.list.error}
        empty={state.items.length === 0}
        // Đang lọc mà không ra gì ≠ tổ chức chưa có group nào — nói đúng tình huống.
        emptyMessage={
          filtering ? t('listing.groupTemplates.noMatch') : t('listing.groupTemplates.empty')
        }
        emptyAction={
          canWrite && !filtering ? (
            <Button onClick={() => openDialog(null)}>
              <Plus className="size-4" />
              {t('listing.groupTemplates.create')}
            </Button>
          ) : undefined
        }
        onSearchChange={state.setSearch}
        sort={state.sort}
        status={{ value: state.status, onChange: state.setStatus, withDefault: false }}
        filters={
          // Thị trường của group = thị trường của Category Template trong group.
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
        onPageSizeChange={state.setPageSize}
      >
        <div className="overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead>{t('listing.groupTemplates.name')}</TableHead>
                <TableHead>{t('listing.groupTemplates.slot.category')}</TableHead>
                <TableHead>{t('listing.groupTemplates.slot.sku')}</TableHead>
                <TableHead>{t('listing.groupTemplates.slot.description')}</TableHead>
                <TableHead>{t('listing.groupTemplates.slot.image')}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      {item.categoryTemplate && <Badge variant="muted">{item.categoryTemplate.market}</Badge>}
                      {!item.isActive && <Badge variant="muted">{t('listing.common.off')}</Badge>}
                    </div>
                    {item.note && <p className="mt-0.5 text-xs text-muted-foreground">{item.note}</p>}
                  </TableCell>
                  <TableCell className="max-w-[260px] text-sm">
                    {item.categoryTemplate ? (
                      <>
                        <p className="truncate">{item.categoryTemplate.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.categoryTemplate.categoryPath ?? item.categoryTemplate.categoryName ?? '—'}
                        </p>
                      </>
                    ) : (
                      <Missing />
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.skuTemplate ? (
                      <>
                        <p>{item.skuTemplate.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('listing.groupTemplates.skuCount', { count: item.skuTemplate._count.items })}
                          {item.skuTemplate.variants.length > 0 &&
                            ` · ${item.skuTemplate.variants.map((variant) => variant.name).join(' × ')}`}
                        </p>
                      </>
                    ) : (
                      <Missing />
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.descriptionTemplate ? item.descriptionTemplate.name : <Missing />}
                  </TableCell>
                  <TableCell className="text-sm">
                    {item.imageTemplate ? (
                      <>
                        <p>{item.imageTemplate.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {t('listing.groupTemplates.imageCount', { count: item.imageTemplate._count.items })}
                        </p>
                      </>
                    ) : (
                      <Missing />
                    )}
                  </TableCell>
                  <TableCell>
                    <TemplateRowActions
                      extra={
                        canWrite ? undefined : (
                          <Button variant="outline" size="sm" onClick={() => openDialog(item)}>
                            {t('common:action.view')}
                          </Button>
                        )
                      }
                      onEdit={canWrite ? () => openDialog(item) : undefined}
                      onClone={canWrite ? () => void state.handleClone(item) : undefined}
                      onDelete={canWrite ? () => void handleDelete(item) : undefined}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TemplatePageShell>

      <GroupTemplateDialog
        open={dialogOpen}
        template={selected}
        readOnly={!canWrite}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}

/** Mảnh group không có — hiện xám để nhìn bảng là thấy. */
function Missing() {
  const { t } = useTranslation('pod');
  return <span className="text-xs text-muted-foreground">{t('listing.groupTemplates.none')}</span>;
}
