'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { cn } from '@/lib/utils';

export interface TemplateOption {
  id: string;
  name: string;
  /** Dòng phụ dưới tên — đường dẫn danh mục, số SKU, số ảnh… */
  hint?: string | null;
  /** Thị trường của template. Khác market đang chọn ⇒ cảnh báo. */
  market?: string | null;
}

/**
 * Bộ chọn **template có sẵn** dùng chung cho mọi khu vực của form Custom Listing.
 *
 * ```
 *   Mẫu Category   [Tee US — Womenswear > T-Shirts ▾] [Áp dụng] [↻] [×]
 *                  ⚠ Mẫu thuộc thị trường US, lượt đăng đang là UK
 * ```
 *
 * 🔴 **Chọn ≠ áp dụng.** Mở dropdown và chọn một mẫu KHÔNG đụng gì tới dữ liệu đang có;
 * chỉ khi bấm "Áp dụng" mới ghi vào form, và khi đó có xác nhận nếu sẽ đè lên dữ liệu người
 * dùng đã gõ. Tự động điền ngay lúc chọn là cách nhanh nhất để xoá mất công của người ta chỉ
 * vì họ bấm nhầm một dòng trong danh sách.
 *
 * 🔴 Cảnh báo lệch thị trường KHÔNG chặn: cây danh mục / brand / kho của TikTok khác nhau
 * theo market, nhưng quyết định sửa market hay đổi mẫu là của người dùng.
 */
export function TemplatePicker({
  label,
  options,
  loading,
  error,
  value,
  onChange,
  onApply,
  onRefresh,
  refreshing,
  market,
  confirmMessage,
  disabled,
}: {
  label: string;
  options: TemplateOption[];
  loading?: boolean;
  error?: boolean;
  value: string;
  onChange: (id: string) => void;
  /** Ghi dữ liệu của mẫu vào form. Chỉ chạy khi người dùng bấm "Áp dụng". */
  onApply: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Market đang chọn — để so với market của mẫu. */
  market?: string;
  /** Hỏi lại trước khi đè (bỏ trống = áp dụng thẳng). */
  confirmMessage?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation('pod');
  const [applied, setApplied] = useState(false);

  const selected = options.find((option) => option.id === value);
  const mismatch = Boolean(selected?.market && market && selected.market !== market);

  const handleApply = () => {
    if (!value) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    onApply(value);
    setApplied(true);
    // Dấu tích chỉ là phản hồi tức thời; tắt đi để lần áp dụng sau vẫn thấy rõ.
    window.setTimeout(() => setApplied(false), 2000);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          value={value}
          onChange={onChange}
          loading={loading}
          disabled={disabled}
          options={[
            { value: '', label: t('listing.templatePicker.none') },
            ...options.map((option) => ({
              value: option.id,
              label: option.hint ? `${option.name} — ${option.hint}` : option.name,
            })),
          ]}
          searchPlaceholder={t('listing.templatePicker.search', { label })}
          className="min-w-[260px] flex-1"
        />

        <Button variant="outline" size="sm" disabled={!value || disabled} onClick={handleApply}>
          {applied ? <Check className="size-4 text-emerald-600" /> : null}
          {t('listing.templatePicker.apply')}
        </Button>

        {value && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('listing.templatePicker.clear')}
            onClick={() => onChange('')}
          >
            <X className="size-4" />
          </Button>
        )}

        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('listing.templatePicker.refresh')}
            title={t('listing.templatePicker.refresh')}
            disabled={refreshing}
            onClick={onRefresh}
          >
            {refreshing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
        )}
      </div>

      {error ? (
        <p className="text-xs text-destructive">{t('listing.templatePicker.loadFailed')}</p>
      ) : !loading && options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('listing.templatePicker.empty')}</p>
      ) : null}

      {mismatch && (
        <p className={cn('flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400')}>
          <AlertTriangle className="size-3.5 shrink-0" />
          {t('listing.templatePicker.marketMismatch', {
            templateMarket: selected?.market,
            market,
          })}
          <Badge variant="warning">{selected?.market}</Badge>
        </p>
      )}
    </div>
  );
}
