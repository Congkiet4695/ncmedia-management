'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { OrganizationRow } from '../types';

/** Lý do từ chối phải đủ dài để người nhận biết đường sửa — khớp ràng buộc của backend. */
const REASON_MIN = 10;
const REASON_MAX = 1000;

/**
 * Hộp thoại XÁC NHẬN duyệt (§15).
 *
 * 🔴 Duyệt là hành động một chiều và có gửi email ra ngoài — không bao giờ để nó nằm sau một
 * cú bấm đơn trên bảng danh sách.
 */
export function ApproveDialog({
  organization,
  pending,
  onConfirm,
  onClose,
}: {
  organization: OrganizationRow | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['superAdmin', 'common']);
  if (!organization) return null;

  return (
    <Modal open onClose={onClose} title={t('approve.title')} className="max-w-md">
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="space-y-1">
            <p className="text-sm">
              {t('approve.confirm', { name: organization.name })}
            </p>
            <p className="text-xs text-muted-foreground">{t('approve.hint')}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('approve.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Hộp thoại TỪ CHỐI — bắt buộc nhập lý do (§9).
 *
 * 🔴 Validate ngay trên form thay vì chờ backend trả 400: lý do này được gửi thẳng vào email
 * cho người đăng ký, nên phải chặn ở chỗ người viết còn đang nhìn vào nó.
 */
export function RejectDialog({
  organization,
  pending,
  onConfirm,
  onClose,
}: {
  organization: OrganizationRow | null;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['superAdmin', 'common']);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  // Mở lại hộp thoại cho một Organization khác ⇒ xoá nội dung cũ. Giữ lại thì Super Admin có
  // thể gửi nhầm lý do của hồ sơ trước cho hồ sơ sau.
  useEffect(() => {
    setReason('');
    setTouched(false);
  }, [organization?.id]);

  if (!organization) return null;

  const trimmed = reason.trim();
  const tooShort = trimmed.length < REASON_MIN;

  return (
    <Modal open onClose={onClose} title={t('reject.title')} className="max-w-md">
      <div className="space-y-4">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <XCircle className="size-5" />
          </div>
          <p className="text-sm">{t('reject.confirm', { name: organization.name })}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reject-reason">
            {t('reject.reason')} <span className="text-destructive">*</span>
          </Label>
          <textarea
            id="reject-reason"
            rows={4}
            value={reason}
            maxLength={REASON_MAX}
            disabled={pending}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t('reject.reasonPlaceholder')}
            aria-invalid={touched && tooShort}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">{t('reject.reasonHint')}</p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {trimmed.length}/{REASON_MAX}
            </span>
          </div>
          {touched && tooShort && (
            <p className="text-sm text-destructive">{t('reject.reasonTooShort', { count: REASON_MIN })}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('common:action.cancel')}
          </Button>
          <Button
            variant="destructive"
            disabled={pending || tooShort}
            onClick={() => onConfirm(trimmed)}
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('reject.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
