'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/ui/native-select';
import { useApiError } from '@/hooks/use-api-error';
import { useFulfillmentProviderOptions } from '@/features/fulfillment/hooks/use-fulfillment';
import { useAssignFulfillmentProvider } from '../hooks/use-pod-tiktok';

interface FulfillmentProviderSelectProps {
  accountId: string;
  accountName: string;
  fulfillmentAccountId: string | null;
  fulfillmentProviderName: string | null;
  /** Nhà cung cấp đang gán có ACTIVE không — cảnh báo nếu đã bị tắt sau khi gán. */
  fulfillmentProviderActive: boolean | null;
  /** Không có quyền sửa ⇒ chỉ hiển thị, không render dropdown. */
  editable: boolean;
}

/** Giá trị đại diện cho "chưa cấu hình" (option value không nhận null). */
const UNASSIGNED = '';

/**
 * Ô chọn nhà cung cấp fulfillment ngay trên dòng của bảng TikTok Account.
 *
 * Lưu ngay khi chọn — thao tác chỉ có một trường, thêm nút Save chỉ làm chậm người dùng.
 * Đổi thất bại thì tự quay lại giá trị cũ.
 *
 * Danh sách lựa chọn dùng CHUNG một query cho cả bảng (`useFulfillmentProviderOptions` có
 * cache), nên bảng bao nhiêu dòng cũng chỉ tải danh sách MỘT lần — không N+1.
 */
export function FulfillmentProviderSelect({
  accountId,
  accountName,
  fulfillmentAccountId,
  fulfillmentProviderName,
  fulfillmentProviderActive,
  editable,
}: FulfillmentProviderSelectProps) {
  const { t } = useTranslation('fulfillment');
  const translateApiError = useApiError();
  const { data: options, isLoading } = useFulfillmentProviderOptions(editable);
  const mutation = useAssignFulfillmentProvider();
  // Hiển thị lạc quan: đổi ngay trên UI, quay lại giá trị cũ nếu server từ chối.
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  const currentId = optimisticId ?? fulfillmentAccountId;

  if (!editable) {
    return fulfillmentProviderName ? (
      <span className={fulfillmentProviderActive === false ? 'text-amber-600' : undefined}>
        {fulfillmentProviderName}
        {fulfillmentProviderActive === false && t('assign.inactiveSuffix')}
      </span>
    ) : (
      <span className="text-muted-foreground">{t('assign.unassigned')}</span>
    );
  }

  const handleChange = async (value: string) => {
    const nextId = value === UNASSIGNED ? null : value;
    if (nextId === currentId) return;

    setOptimisticId(nextId);
    try {
      await mutation.mutateAsync({ id: accountId, fulfillmentAccountId: nextId });
      const chosen = options?.find((option) => option.id === nextId);
      toast.success(
        nextId ? t('assign.success', { name: chosen?.name ?? '' }) : t('assign.cleared'),
        { description: accountName },
      );
    } catch (error) {
      setOptimisticId(null); // trả về giá trị server đang giữ
      toast.error(t('assign.failed'), { description: translateApiError(error) });
    }
  };

  const noProvider = !isLoading && (options?.length ?? 0) === 0;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <NativeSelect
        value={currentId ?? UNASSIGNED}
        onChange={(e) => void handleChange(e.target.value)}
        disabled={isLoading || mutation.isPending}
        aria-label={t('assign.selectLabel', { account: accountName })}
        className="h-9 min-w-[170px] max-w-[240px] text-sm"
      >
        <option value={UNASSIGNED}>
          {noProvider ? t('assign.noProvider') : t('assign.unassigned')}
        </option>
        {/* Nhà cung cấp đang gán có thể đã bị tắt/xoá ⇒ không còn trong danh sách chọn.
            Vẫn phải hiện ra, nếu không người dùng sẽ tưởng kết nối chưa được cấu hình. */}
        {currentId && !options?.some((option) => option.id === currentId) && (
          <option value={currentId}>
            {fulfillmentProviderName ?? ''}
            {fulfillmentProviderActive === false ? t('assign.inactiveSuffix') : ''}
          </option>
        )}
        {options?.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </NativeSelect>

      {mutation.isPending ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        mutation.isSuccess && <Check className="size-4 shrink-0 text-emerald-600" />
      )}
    </div>
  );
}
