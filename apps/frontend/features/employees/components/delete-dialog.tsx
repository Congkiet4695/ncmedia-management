'use client';

import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

interface DeleteDialogProps {
  open: boolean;
  employeeName?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteDialog({ open, employeeName, loading, onConfirm, onClose }: DeleteDialogProps) {
  const { t } = useTranslation(['employee', 'common']);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('deleteTitle')}
      description={t('deleteDescription', { name: employeeName ?? '' })}
    >
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={loading}>
          {t('common:action.cancel')}
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          {t('common:action.delete')}
        </Button>
      </div>
    </Modal>
  );
}
