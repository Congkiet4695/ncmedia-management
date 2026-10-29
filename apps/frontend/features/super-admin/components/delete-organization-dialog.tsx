'use client';

import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { useApiError } from '@/hooks/use-api-error';
import { useDeleteOrganization } from '../hooks';
import type { OrganizationDeletionResult } from '../types';

interface DeleteOrganizationDialogProps {
  /** Tổ chức cần xoá — `null` ⇒ hộp đóng. */
  organization: { id: string; name: string; slug: string } | null;
  onClose: () => void;
  onDeleted?: (result: OrganizationDeletionResult) => void;
}

/**
 * Hộp XOÁ CỨNG Organization (Super Admin).
 *
 * 🔴 Người dùng phải GÕ LẠI slug của tổ chức mới bật được nút xoá, và slug đó được gửi lên để backend tự
 * đối chiếu — một cú bấm nhầm dòng (hoặc request gửi lại từ lịch sử) không thể xoá một tổ chức khác.
 */
export function DeleteOrganizationDialog({
  organization,
  onClose,
  onDeleted,
}: DeleteOrganizationDialogProps) {
  const { t } = useTranslation('superAdmin');
  const translateApiError = useApiError();
  const remove = useDeleteOrganization();

  const confirm = (): void => {
    if (!organization) return;
    void remove
      .mutateAsync({ id: organization.id, confirmSlug: organization.slug })
      .then((result) => {
        toast.success(t('delete.done', { name: result.name }), {
          description: t('delete.doneDetail', {
            rows: result.deletedRows,
            files: result.storageFilesDeleted,
          }),
        });
        onClose();
        onDeleted?.(result);
      })
      .catch((error: unknown) => toast.error(translateApiError(error)));
  };

  return (
    <ConfirmDeleteDialog
      open={organization !== null}
      title={t('delete.title')}
      description={t('delete.question', { name: organization?.name ?? '' })}
      names={organization ? [`${organization.name} (${organization.slug})`] : []}
      warning={t('delete.warning')}
      confirmLabel={t('delete.confirm')}
      typeToConfirm={organization?.slug}
      loading={remove.isPending}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
