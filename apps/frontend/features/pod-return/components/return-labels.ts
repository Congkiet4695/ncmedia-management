'use client';

import { useTranslation } from 'react-i18next';
import type { ReturnStatusGroup } from '../types';

/** `RETURN_AND_REFUND` ⇒ `Return and refund` — dùng khi chưa có bản dịch cho mã TikTok mới. */
export function humanizeCode(code: string | null | undefined): string {
  if (!code) return '—';
  const text = code.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const STATUS_GROUP_VARIANT: Record<ReturnStatusGroup, 'default' | 'success' | 'warning' | 'destructive' | 'muted'> = {
  PENDING: 'warning',
  PROCESSING: 'default',
  COMPLETED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'muted',
  OTHER: 'muted',
};

/**
 * Nhãn dễ đọc cho mã TikTok. Mã đã biết ⇒ bản dịch; mã mới ⇒ chuyển mã thành chữ (không đoán nghĩa).
 * Giá trị gốc luôn được hiển thị kèm (tooltip / dòng phụ) để đối chiếu với Seller Center.
 */
export function useReturnLabels() {
  const { t, i18n } = useTranslation('podReturn');
  const known = (prefix: string, code: string | null | undefined) =>
    code && i18n.exists(`podReturn:${prefix}.${code}`) ? t(`${prefix}.${code}`) : humanizeCode(code);
  return {
    type: (code: string | null | undefined) => known('type', code),
    status: (code: string | null | undefined) => known('status', code),
    group: (group: ReturnStatusGroup) => t(`group.${group}`),
    role: (code: string | null | undefined) => known('role', code),
  };
}
