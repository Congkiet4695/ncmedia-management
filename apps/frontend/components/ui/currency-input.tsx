'use client';

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Ký hiệu tiền tệ của một mã ISO — `USD → $`, `GBP → £`, `VND → ₫`.
 *
 * 🔴 Lấy từ `Intl`, KHÔNG phải bảng tra tự viết: thêm một thị trường mới thì ký hiệu đúng
 * ngay, không phải sửa mã. Trình duyệt nào không dựng được thì rơi về chính mã tiền tệ.
 */
export function currencySymbol(currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase() || 'USD';
  try {
    return (
      new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? code
    );
  } catch {
    return code;
  }
}

interface AffixedInputProps extends Omit<React.ComponentProps<'input'>, 'type'> {
  /** Ký hiệu hiển thị ở mép phải ô nhập ($, %, ₫…). */
  affix: string;
}

/**
 * Ô nhập số có ký hiệu đơn vị ngay trong ô.
 *
 * Giá trị lưu vẫn là **số trần** (`19.99`) — chỉ phần hiển thị mới có đơn vị. Nhét ký hiệu
 * vào chính giá trị là cách chắc chắn để `Number("$19.99")` trả về `NaN` ở đâu đó.
 */
const AffixedNumberInput = React.forwardRef<HTMLInputElement, AffixedInputProps>(
  ({ affix, className, ...props }, ref) => (
    <div className="relative">
      <Input
        ref={ref}
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        className={cn('pr-8 text-right tabular-nums', className)}
        {...props}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        {affix}
      </span>
    </div>
  ),
);
AffixedNumberInput.displayName = 'AffixedNumberInput';

/** Ô nhập tiền — ký hiệu suy ra từ mã tiền tệ của template (Market US ⇒ USD ⇒ `$`). */
export const CurrencyInput = React.forwardRef<
  HTMLInputElement,
  Omit<AffixedInputProps, 'affix'> & { currency: string | null | undefined }
>(({ currency, ...props }, ref) => (
  <AffixedNumberInput ref={ref} affix={currencySymbol(currency)} {...props} />
));
CurrencyInput.displayName = 'CurrencyInput';

/** Ô nhập phần trăm (giảm giá). */
export const PercentInput = React.forwardRef<
  HTMLInputElement,
  Omit<AffixedInputProps, 'affix'>
>((props, ref) => <AffixedNumberInput ref={ref} affix="%" max={100} {...props} />);
PercentInput.displayName = 'PercentInput';

/** Ô nhập số nguyên (tồn kho) — không có đơn vị, nhưng cùng canh phải cho thẳng cột. */
export const QuantityInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<'input'>, 'type'>
>(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    type="number"
    inputMode="numeric"
    step="1"
    min="0"
    className={cn('text-right tabular-nums', className)}
    {...props}
  />
));
QuantityInput.displayName = 'QuantityInput';
