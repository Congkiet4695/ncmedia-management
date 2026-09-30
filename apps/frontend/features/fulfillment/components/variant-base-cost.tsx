'use client';

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useProviderVariantPrice } from '../hooks/use-fulfillment';
import { providerErrorText } from '../provider-error';

interface VariantBaseCostProps {
  /** Tài khoản nhà cung cấp đang chọn. */
  accountId: string | null | undefined;
  /** `fulfillment_variants.id` của biến thể đang chọn — chưa chọn ⇒ không hỏi giá. */
  variantId: string | null | undefined;
  /** Base Cost ĐANG LƯU của ánh xạ (để nói rõ khi giá nhà cung cấp khác giá đã lưu). */
  savedBaseCost?: number | null;
}

/**
 * **Base Cost của biến thể đang chọn — chỉ đọc.**
 *
 * 🔴 Giá do BACKEND lấy từ giá biến thể của nhà cung cấp (danh mục đã đồng bộ) và chính backend
 * ghi vào Base Cost khi lưu cấu hình. Ô này chỉ HIỂN THỊ: không còn ô nhập giá tay, không gửi giá
 * từ giao diện. Lỗi ⇒ nói rõ vì sao, không bao giờ hiện 0 như thể đã lấy được giá.
 *
 * Gọi API đúng MỘT lần cho mỗi (tài khoản, biến thể) — react-query nhớ 5 phút; mở/đóng ô chọn
 * không gọi lại.
 */
export function VariantBaseCost({ accountId, variantId, savedBaseCost }: VariantBaseCostProps) {
  const { t } = useTranslation('fulfillment');
  const translateApiError = useApiError();
  const { formatCurrency, formatDateTime } = useLocaleFormat();
  const price = useProviderVariantPrice(accountId ?? undefined, variantId ?? undefined);

  const saved =
    savedBaseCost === null || savedBaseCost === undefined ? null : Number(savedBaseCost);

  return (
    <div className="space-y-1">
      <Label>{t('fulfill.config.baseCost')}</Label>
      {!variantId ? (
        <p className="text-xs text-muted-foreground">{t('fulfill.config.baseCostSelectVariant')}</p>
      ) : price.isPending ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('fulfill.config.baseCostLoading')}
        </p>
      ) : price.isError ? (
        <div className="space-y-0.5">
          <p className="flex gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {providerErrorText(price.error, translateApiError(price.error))}
          </p>
          {saved !== null && (
            <p className="text-[11px] text-muted-foreground">
              {t('fulfill.config.baseCostKeptSaved', { value: formatCurrency(saved, null) })}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-0.5">
          <p className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
            <CheckCircle2 className="size-3.5 text-emerald-600" />
            {formatCurrency(price.data.price, price.data.currency)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t('fulfill.config.baseCostSource', {
              sku: price.data.sku,
              syncedAt: formatDateTime(price.data.syncedAt),
            })}
          </p>
          {saved !== null && saved !== price.data.price && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {t('fulfill.config.baseCostWillUpdate', { value: formatCurrency(saved, price.data.currency) })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
