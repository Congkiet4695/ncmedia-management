'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';

/** Số tên liệt kê trong hộp xác nhận; nhiều hơn thì gộp thành "+N". */
const LISTED_NAMES = 5;

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  /** Câu hỏi chính — nêu rõ SỐ LƯỢNG / TÊN thứ sẽ bị xoá. */
  description: string;
  /** Tên các bản ghi bị xoá (tuỳ chọn) — hiện tối đa 5 tên, phần còn lại gộp "+N". */
  names?: string[];
  /** Cảnh báo hậu quả (xoá vĩnh viễn, dữ liệu đi theo…). */
  warning: string;
  confirmLabel: string;
  /**
   * Bắt người dùng GÕ LẠI một chuỗi (vd slug tổ chức) trước khi nút xoá bật — dành cho thao tác phá huỷ
   * diện rộng. Bỏ trống ⇒ chỉ cần bấm xác nhận.
   */
  typeToConfirm?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Hộp xác nhận XOÁ dùng chung (Flash Sales, Auto Listing, Organization…).
 *
 * 🔴 Nút xác nhận khoá trong lúc request chạy và hộp không đóng được giữa chừng: bấm lần hai không được
 * sinh request thứ hai, và người dùng không được rời đi khi chưa biết kết quả.
 */
export function ConfirmDeleteDialog({
  open,
  title,
  description,
  names = [],
  warning,
  confirmLabel,
  typeToConfirm,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation('common');
  const [typed, setTyped] = useState('');

  // Mỗi lần mở là một lần xác nhận mới — không giữ chuỗi đã gõ từ lần trước.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const listed = names.slice(0, LISTED_NAMES);
  const hidden = names.length - listed.length;
  const confirmed = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title={title}
      description={description}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {t('action.cancel')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading || !confirmed}>
            {loading ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {listed.length > 0 && (
          <ul className="space-y-1 rounded-md border bg-muted/40 px-3 py-2">
            {listed.map((name, index) => (
              <li key={`${name}-${index}`} className="truncate font-medium">
                {name}
              </li>
            ))}
            {hidden > 0 && (
              <li className="text-xs text-muted-foreground">
                {t('deleteDialog.more', { count: hidden })}
              </li>
            )}
          </ul>
        )}

        <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p>{warning}</p>
            <p className="text-xs font-medium">{t('deleteDialog.irreversible')}</p>
          </div>
        </div>

        {typeToConfirm && (
          <label className="block space-y-1.5">
            <span className="text-muted-foreground">
              {t('deleteDialog.typeToConfirm', { value: typeToConfirm })}
            </span>
            <Input
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
              onChange={(event) => setTyped(event.target.value)}
              aria-label={t('deleteDialog.typeToConfirm', { value: typeToConfirm })}
            />
          </label>
        )}
      </div>
    </Modal>
  );
}
