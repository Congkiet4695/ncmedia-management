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
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { SkuTemplateDialog } from '@/features/pod-listing/components/sku-template-dialog';
import {
  TemplatePageShell,
  TemplateRowActions,
} from '@/features/pod-listing/components/template-page-shell';
import { TemplateTransferBar } from '@/features/pod-listing/components/template-transfer-bar';
import { usePodTemplate } from '@/features/pod-listing/hooks/use-pod-listing';
import { useTemplateListState } from '@/features/pod-listing/hooks/use-template-list-state';
import type { PodSkuTemplate } from '@/features/pod-listing/types';

export default function SkuTemplatesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <SkuTemplatesView />
    </RequirePermission>
  );
}

/**
 * **POD → Templates → SKU Templates**.
 *
 * Khai báo trục biến thể (không giới hạn Color/Size), hệ thống sinh toàn bộ tổ hợp; mỗi
 * SKU có giá gốc / giá bán / tồn / giảm giá / barcode / ảnh / bật-tắt riêng.
 *
 * Danh sách chỉ nạp phần tóm tắt; bảng SKU chi tiết được nạp khi mở form — một template
 * có thể có tới 500 dòng, kéo hết về chỉ để hiện một con số là phí.
 */
function SkuTemplatesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const { formatCurrency } = useLocaleFormat();
  const canWrite = hasPermission('pod.template.write');

  const state = useTemplateListState<PodSkuTemplate>('skus');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const detail = usePodTemplate<PodSkuTemplate>('skus', editingId ?? undefined);

  return (
    <>
      <TemplatePageShell
        title={t('listing.skuTemplates.title')}
        subtitle={t('listing.skuTemplates.subtitle')}
        createLabel={t('listing.skuTemplates.create')}
        onCreate={
          canWrite
            ? () => {
                setEditingId(null);
                setDialogOpen(true);
              }
            : undefined
        }
        actions={
          <TemplateTransferBar kind="skus" query={state.query} canExport canImport={canWrite} />
        }
        loading={state.list.isLoading}
        error={state.list.error}
        empty={state.items.length === 0}
        emptyMessage={t('listing.skuTemplates.empty')}
        onSearchChange={state.setSearch}
        sort={state.sort}
        status={{ value: state.status, onChange: state.setStatus }}
        meta={state.meta}
        onPageChange={state.setPage}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('listing.common.name')}</TableHead>
              <TableHead>{t('listing.skuTemplates.variants')}</TableHead>
              <TableHead>{t('listing.skuTemplates.itemCount')}</TableHead>
              <TableHead>{t('listing.skuTemplates.defaultSale')}</TableHead>
              <TableHead>{t('listing.common.currency')}</TableHead>
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
                    {item.isStale && (
                      <Badge variant="warning">{t('listing.skuTemplates.needsGenerate')}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[320px] truncate text-sm">
                  {(item.variants ?? [])
                    .map((variant) => `${variant.name} (${variant.values.length})`)
                    .join(' · ') || '—'}
                </TableCell>
                <TableCell className="tabular-nums">
                  {item._count?.items ?? 0}
                  {/* Số SKU sẽ có sau khi bấm Tạo SKU — lệch nghĩa là bảng đang cũ. */}
                  {item.expectedItemCount !== (item._count?.items ?? 0) && (
                    <span className="ml-1 text-xs text-amber-600">/ {item.expectedItemCount}</span>
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {formatCurrency(item.defaultSalePrice, item.currency)}
                </TableCell>
                <TableCell className="text-sm">{item.currency ?? '—'}</TableCell>
                <TableCell>
                  <TemplateRowActions
                    onEdit={
                      canWrite
                        ? () => {
                            setEditingId(item.id);
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

      <SkuTemplateDialog
        open={dialogOpen}
        template={editingId ? (detail.data ?? null) : null}
        onClose={() => {
          setDialogOpen(false);
          setEditingId(null);
        }}
      />
    </>
  );
}
