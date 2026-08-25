'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
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
import { ImageTemplateDialog } from '@/features/pod-listing/components/image-template-dialog';
import {
  TemplatePageShell,
  TemplateRowActions,
} from '@/features/pod-listing/components/template-page-shell';
import { TemplateTransferBar } from '@/features/pod-listing/components/template-transfer-bar';
import { usePodTemplate } from '@/features/pod-listing/hooks/use-pod-listing';
import { useTemplateListState } from '@/features/pod-listing/hooks/use-template-list-state';
import type { PodImageTemplate } from '@/features/pod-listing/types';

export default function ImageTemplatesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <ImageTemplatesView />
    </RequirePermission>
  );
}

/**
 * **POD → Templates → Image Templates** — thư viện ảnh mẫu (mockup) của phôi.
 *
 * 🔴 Ảnh CỐ ĐỊNH của phôi (mockup mặt trước/sau, lifestyle, bảng size), upload một lần rồi
 * dùng cho hàng nghìn listing. Không phải ảnh sản phẩm.
 */
function ImageTemplatesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('pod.template.write');

  const state = useTemplateListState<PodImageTemplate>('images');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Bộ ảnh đang mở được nạp riêng để gallery luôn thấy dữ liệu mới nhất sau mỗi thao tác.
  const detail = usePodTemplate<PodImageTemplate>('images', editingId ?? undefined);

  /** Đếm theo loại: "MAIN_FRONT 1 · LIFESTYLE 3" — nhìn là biết bộ đủ hay thiếu. */
  const breakdown = (template: PodImageTemplate): string => {
    const counts = new Map<string, number>();
    for (const item of template.items ?? []) {
      counts.set(item.assetType, (counts.get(item.assetType) ?? 0) + 1);
    }
    return [...counts.entries()].map(([type, count]) => `${type} ${count}`).join(' · ') || '—';
  };

  return (
    <>
      <TemplatePageShell
        title={t('listing.imageTemplates.title')}
        subtitle={t('listing.imageTemplates.subtitle')}
        createLabel={t('listing.imageTemplates.create')}
        onCreate={
          canWrite
            ? () => {
                setEditingId(null);
                setDialogOpen(true);
              }
            : undefined
        }
        actions={
          <TemplateTransferBar kind="images" query={state.query} canExport canImport={canWrite} />
        }
        loading={state.list.isLoading}
        error={state.list.error}
        empty={state.items.length === 0}
        emptyMessage={t('listing.imageTemplates.emptyList')}
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
              <TableHead>{t('listing.imageTemplates.previewColumn')}</TableHead>
              <TableHead>{t('listing.imageTemplates.imageCount')}</TableHead>
              <TableHead>{t('listing.imageTemplates.breakdown')}</TableHead>
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
                  {item.description && (
                    <p className="max-w-[320px] truncate text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {(item.items ?? []).slice(0, 5).map((image) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={image.id}
                        src={image.imageUrl}
                        alt={image.title}
                        title={image.title}
                        className="size-9 rounded border object-cover"
                      />
                    ))}
                    {(item.items ?? []).length === 0 && (
                      <span className="flex size-9 items-center justify-center rounded border bg-muted">
                        <ImageOff className="size-4 text-muted-foreground" />
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">{item.items?.length ?? 0}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{breakdown(item)}</TableCell>
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

      <ImageTemplateDialog
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
