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
import { DescriptionTemplateDialog } from '@/features/pod-listing/components/simple-template-dialogs';
import {
  TemplatePageShell,
  TemplateRowActions,
} from '@/features/pod-listing/components/template-page-shell';
import { TemplateTransferBar } from '@/features/pod-listing/components/template-transfer-bar';
import { useTemplateListState } from '@/features/pod-listing/hooks/use-template-list-state';
import type { PodDescriptionTemplate } from '@/features/pod-listing/types';

export default function DescriptionTemplatesPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.template.read" message={t('listing.common.noPermission')}>
      <DescriptionTemplatesView />
    </RequirePermission>
  );
}

/** **POD → Templates → Description Templates** — HTML + token, có preview. */
function DescriptionTemplatesView() {
  const { t } = useTranslation(['pod', 'common']);
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('pod.template.write');

  const state = useTemplateListState<PodDescriptionTemplate>('descriptions');
  const [editing, setEditing] = useState<PodDescriptionTemplate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  /** Bỏ thẻ HTML để cột "trích đoạn" đọc được, không hiện `<p>` lổn nhổn. */
  const excerpt = (html: string): string =>
    html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);

  return (
    <>
      <TemplatePageShell
        title={t('listing.descriptionTemplates.title')}
        subtitle={t('listing.descriptionTemplates.subtitle')}
        createLabel={t('listing.descriptionTemplates.create')}
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
            kind="descriptions"
            query={state.query}
            canExport
            canImport={canWrite}
          />
        }
        loading={state.list.isLoading}
        error={state.list.error}
        empty={state.items.length === 0}
        emptyMessage={t('listing.descriptionTemplates.empty')}
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
              <TableHead>{t('listing.descriptionTemplates.excerpt')}</TableHead>
              <TableHead>{t('listing.descriptionTemplates.tokenCount')}</TableHead>
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
                <TableCell className="max-w-[420px] truncate text-sm text-muted-foreground">
                  {excerpt(item.contentHtml)}
                </TableCell>
                <TableCell className="tabular-nums">{item.tokens?.length ?? 0}</TableCell>
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

      <DescriptionTemplateDialog
        open={dialogOpen}
        template={editing}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
