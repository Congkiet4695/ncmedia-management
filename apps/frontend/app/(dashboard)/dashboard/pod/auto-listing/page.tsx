'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Loader2, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
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
import { useBulkDeleteFeedback } from '@/hooks/use-bulk-delete-feedback';
import { useAuth } from '@/hooks/use-auth';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { usePageSelection } from '@/hooks/use-page-selection';
import { ListingStatusBadge } from '@/features/pod-listing/components/listing-status-badge';
import { TemplatePageShell } from '@/features/pod-listing/components/template-page-shell';
import {
  useBulkDeleteSessions,
  useDeleteSession,
  useListingSessions,
} from '@/features/pod-listing-session/hooks';
import { POD_SESSION_STATUSES } from '@/features/pod-listing-session/types';
import type { PodSessionStatus } from '@/features/pod-listing-session/types';

export default function AutoListingPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.session.read" message={t('listing.common.noPermission')}>
      <ListingSessionListView />
    </RequirePermission>
  );
}

/**
 * **POD → Auto Listing** — danh sách các **lượt đăng hàng** (Listing Session).
 *
 * ```
 *   New Listing → Market → Shops → 5 Template → Import → Review → Start Listing
 * ```
 *
 * 🔴 Không còn màn "Draft Listing" riêng: Draft Product chỉ tồn tại bên trong một lượt đăng,
 * nên đường duy nhất tới nó là mở lượt đăng ra.
 */
function ListingSessionListView() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const { hasPermission } = useAuth();
  const { formatDateTime } = useLocaleFormat();
  const canWrite = hasPermission('pod.session.write');

  const [page, setPage] = useState(1);
  // Cỡ trang do người dùng chọn (ô "Số dòng mỗi trang"); đổi cỡ thì luôn về trang 1
  // vì trang cũ có thể không còn tồn tại ở cỡ mới.
  const [limit, setLimit] = useState(20);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PodSessionStatus | ''>('');

  const sessions = useListingSessions({
    page,
    limit,
    search: search || undefined,
    status: status || undefined,
  });
  const remove = useDeleteSession();
  const bulkDelete = useBulkDeleteSessions();
  const reportBulkDelete = useBulkDeleteFeedback();
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const items = sessions.data?.items ?? [];
  // Chọn nhiều để xoá — CHỈ các lượt xoá được của TRANG HIỆN TẠI (không bao giờ là "cả database").
  // Lượt đang LISTING không xoá được (backend cũng chặn, kể cả khi còn job / publish dở dang).
  const isDeletable = (status: PodSessionStatus) => status !== 'LISTING';
  const selection = usePageSelection(
    canWrite ? items.filter((row) => isDeletable(row.status)).map((row) => row.id) : [],
  );
  const selectedRows = items.filter((row) => selection.isSelected(row.id));

  const deleteSelected = (): void => {
    const ids = selectedRows.map((row) => row.id);
    if (ids.length === 0) return;
    void bulkDelete
      .mutateAsync(ids)
      .then((result) => {
        selection.forget(result.deleted);
        setConfirmBulkDelete(false);
        reportBulkDelete(result, {
          nameOf: (id) => items.find((row) => row.id === id)?.name ?? id,
          success: (count) => t('listing.sessions.bulkDelete.done', { count }),
          partial: (deleted, failed) => t('listing.sessions.bulkDelete.partial', { deleted, failed }),
        });
      })
      .catch((error: unknown) => toast.error(translateApiError(error)));
  };
  const create = (): void => router.push('/dashboard/pod/auto-listing/new');

  return (
    <TemplatePageShell
      title={t('listing.sessions.title')}
      subtitle={t('listing.sessions.subtitle')}
      createLabel={t('listing.sessions.create')}
      onCreate={canWrite ? create : undefined}
      loading={sessions.isLoading}
      error={sessions.error}
      empty={items.length === 0}
      emptyMessage={t('listing.sessions.empty')}
      onSearchChange={setSearch}
      searchPlaceholder={t('listing.sessions.searchPlaceholder')}
      meta={sessions.data?.meta ?? null}
      onPageChange={setPage}
        onPageSizeChange={(next) => {
          setLimit(next);
          setPage(1);
        }}
      filters={
        <Combobox
          value={status}
          onChange={(value) => setStatus(value as PodSessionStatus | '')}
          options={[
            { value: '', label: t('listing.sessions.allStatuses') },
            ...POD_SESSION_STATUSES.map((value) => ({
              value,
              label: t(`listing.sessions.status.${value}`),
            })),
          ]}
          className="w-[210px]"
        />
      }
      actions={
        !canWrite ? undefined : (
          <>
            {selectedRows.length > 0 && (
              <span className="self-center text-sm text-muted-foreground">
                {t('listing.sessions.bulkDelete.selected', { count: selectedRows.length })}
              </span>
            )}
            <Button
              variant="outline"
              className="text-destructive"
              disabled={selectedRows.length === 0 || bulkDelete.isPending}
              onClick={() => setConfirmBulkDelete(true)}
            >
              {bulkDelete.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('listing.sessions.bulkDelete.button', { count: selectedRows.length })}
            </Button>
            {/* 🔴 Đứng CẠNH nút tạo lượt CSV/Excel, không thay thế nó: hai lối vào cho hai
                cách làm việc khác nhau (nhập tay một sản phẩm vs nạp cả file). Luồng import
                giữ nguyên hoàn toàn. */}
            <Button onClick={() => router.push('/dashboard/pod/auto-listing/custom')}>
              <Rocket className="size-4" />
              {t('listing.custom.addButton')}
            </Button>
            <Button variant="outline" onClick={create}>
              <Plus className="size-4" />
              {t('listing.sessions.create')}
            </Button>
          </>
        )
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            {canWrite && (
              <TableHead className="w-[40px]">
                <Checkbox
                  aria-label={t('listing.sessions.bulkDelete.selectPage')}
                  title={t('listing.sessions.bulkDelete.selectPage')}
                  checked={selection.allSelected}
                  indeterminate={selection.someSelected}
                  disabled={bulkDelete.isPending || items.every((row) => !isDeletable(row.status))}
                  onChange={selection.togglePage}
                />
              </TableHead>
            )}
            <TableHead>{t('listing.sessions.name')}</TableHead>
            <TableHead>{t('listing.sessions.market')}</TableHead>
            <TableHead>{t('listing.sessions.shops')}</TableHead>
            <TableHead className="text-right">{t('listing.sessions.products')}</TableHead>
            <TableHead>{t('listing.common.status')}</TableHead>
            <TableHead>{t('listing.sessions.updatedAt')}</TableHead>
            <TableHead className="text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((session) => (
            <TableRow key={session.id}>
              {canWrite && (
                <TableCell>
                  <Checkbox
                    aria-label={t('listing.sessions.bulkDelete.selectRow', { name: session.name })}
                    title={isDeletable(session.status) ? undefined : t('listing.sessions.bulkDelete.notDeletable')}
                    disabled={bulkDelete.isPending || !isDeletable(session.status)}
                    checked={selection.isSelected(session.id)}
                    onChange={() => selection.toggleRow(session.id)}
                  />
                </TableCell>
              )}
              <TableCell>
                <Link
                  href={`/dashboard/pod/auto-listing/${session.id}`}
                  className="font-medium hover:underline"
                >
                  {session.name}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {session.source === 'CUSTOM'
                    ? t('listing.custom.sourceLabel')
                    : (session.sourceFile ?? t('listing.sessions.noImport'))}
                </p>
              </TableCell>
              <TableCell>{session.market}</TableCell>
              <TableCell className="text-sm">
                {session.shops.length === 0
                  ? '—'
                  : session.shops.map((link) => link.shop.name).join(', ')}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <span className="text-success">{session.counts.UPLOADED}</span>
                {' / '}
                <span className="text-destructive">{session.counts.FAILED}</span>
                {' / '}
                {session.counts.TOTAL}
              </TableCell>
              <TableCell>
                <ListingStatusBadge
                  status={session.status}
                  label={t(`listing.sessions.status.${session.status}`)}
                />
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                {formatDateTime(session.updatedAt)}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/dashboard/pod/auto-listing/${session.id}`}>
                      <Eye className="size-4" />
                    </Link>
                  </Button>
                  {/* Custom Listing sửa bằng form đầy đủ — mở thẳng từ danh sách. */}
                  {canWrite && session.source === 'CUSTOM' && (
                    <Button variant="ghost" size="sm" asChild title={t('listing.custom.editCustom')}>
                      <Link href={`/dashboard/pod/auto-listing/custom/${session.id}`}>
                        <Pencil className="size-4" />
                      </Link>
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('common:action.delete')}
                      onClick={() => {
                        if (
                          !window.confirm(
                            t('listing.sessions.deleteConfirm', { name: session.name }),
                          )
                        ) {
                          return;
                        }
                        void remove
                          .mutateAsync(session.id)
                          .then(() => toast.success(t('listing.sessions.deleted')))
                          .catch((error: unknown) => toast.error(translateApiError(error)));
                      }}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ConfirmDeleteDialog
        open={confirmBulkDelete}
        title={t('listing.sessions.bulkDelete.title', { count: selectedRows.length })}
        description={t('listing.sessions.bulkDelete.question', { count: selectedRows.length })}
        names={selectedRows.map((row) => row.name)}
        warning={t('listing.sessions.bulkDelete.warning')}
        confirmLabel={t('listing.sessions.bulkDelete.confirm', { count: selectedRows.length })}
        loading={bulkDelete.isPending}
        onConfirm={deleteSelected}
        onClose={() => setConfirmBulkDelete(false)}
      />
    </TemplatePageShell>
  );
}
