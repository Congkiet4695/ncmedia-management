'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/ui/native-select';
import { useApiError } from '@/hooks/use-api-error';
import { useAssignPodSeller, usePodSellerOptions } from '../hooks/use-pod-tiktok';
import type { PodSellerOption } from '../types';

interface SellerAssignSelectProps {
  accountId: string;
  accountName: string;
  sellerId: string | null;
  sellerFullName: string | null;
  sellerEmail: string | null;
  /** Không có quyền sửa ⇒ chỉ hiển thị, không render dropdown. */
  editable: boolean;
}

/** Giá trị đại diện cho "chưa phân công" trong `<select>` (option value không nhận null). */
const UNASSIGNED = '';

/**
 * Ô chọn Seller phụ trách ngay trên dòng của bảng TikTok Account.
 *
 * **Lưu ngay khi chọn** (không cần nút Save riêng) — thao tác chỉ có một trường nên
 * thêm nút Save chỉ làm chậm người dùng. Đổi thất bại thì tự quay lại giá trị cũ.
 *
 * Danh sách lựa chọn dùng chung một query cho cả bảng (`usePodSellerOptions` có cache),
 * nên dù bảng có bao nhiêu dòng cũng chỉ tải danh sách nhân sự MỘT lần — không N+1.
 */
export function SellerAssignSelect({
  accountId,
  accountName,
  sellerId,
  sellerFullName,
  sellerEmail,
  editable,
}: SellerAssignSelectProps) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const { data: options, isLoading } = usePodSellerOptions(editable);
  const assignMutation = useAssignPodSeller();
  // Hiển thị lạc quan: đổi ngay trên UI, quay lại giá trị cũ nếu server từ chối.
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  const currentId = optimisticId ?? sellerId;

  const label = (option: PodSellerOption) =>
    t('account.sellerOption', { name: option.fullName, email: option.email });

  if (!editable) {
    return sellerFullName || sellerEmail ? (
      <div className="min-w-0">
        <div className="truncate">{sellerFullName ?? sellerEmail}</div>
        {sellerFullName && sellerEmail && (
          <div className="truncate text-xs text-muted-foreground">{sellerEmail}</div>
        )}
      </div>
    ) : (
      <span className="text-muted-foreground">{t('account.unassigned')}</span>
    );
  }

  const handleChange = async (value: string) => {
    const nextId = value === UNASSIGNED ? null : value;
    if (nextId === currentId) return;

    setOptimisticId(nextId);
    try {
      await assignMutation.mutateAsync({ id: accountId, sellerId: nextId });
      const chosen = options?.find((option) => option.id === nextId);
      toast.success(
        nextId
          ? t('account.assignSuccess', {
              name: chosen?.fullName ?? t('account.sellerFallback'),
            })
          : t('account.unassignSuccess'),
        { description: accountName },
      );
    } catch (error) {
      setOptimisticId(null); // trả về giá trị server đang giữ
      toast.error(t('account.assignFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <NativeSelect
        value={currentId ?? UNASSIGNED}
        onChange={(e) => void handleChange(e.target.value)}
        disabled={isLoading || assignMutation.isPending}
        aria-label={t('account.sellerSelectLabel', { account: accountName })}
        className="h-9 min-w-[180px] max-w-[240px] text-sm"
      >
        <option value={UNASSIGNED}>{t('account.unassigned')}</option>
        {/* Seller hiện tại có thể đã nghỉ việc/đổi role ⇒ không còn trong danh sách chọn.
            Vẫn phải hiện ra, nếu không người dùng sẽ tưởng account chưa được phân công. */}
        {currentId && !options?.some((option) => option.id === currentId) && (
          <option value={currentId}>
            {sellerFullName ?? sellerEmail ?? t('account.sellerInactive')}
          </option>
        )}
        {options?.map((option) => (
          <option key={option.id} value={option.id}>
            {label(option)}
          </option>
        ))}
      </NativeSelect>

      {assignMutation.isPending ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        assignMutation.isSuccess && <Check className="size-4 shrink-0 text-emerald-600" />
      )}
    </div>
  );
}
