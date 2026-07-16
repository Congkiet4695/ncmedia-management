'use client';

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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Xóa nhân viên"
      description={`Bạn có chắc muốn xóa "${employeeName ?? ''}"? Nhân viên sẽ bị xóa mềm và không thể đăng nhập.`}
    >
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={loading}>
          Hủy
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Xóa
        </Button>
      </div>
    </Modal>
  );
}
