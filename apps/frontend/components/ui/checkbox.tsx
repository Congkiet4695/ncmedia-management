'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface CheckboxProps extends Omit<React.ComponentProps<'input'>, 'type' | 'checked'> {
  checked?: boolean;
  /** Trạng thái "một phần" — dùng cho ô chọn-tất-cả khi mới chọn vài dòng. */
  indeterminate?: boolean;
}

/**
 * Checkbox — input gốc, không phụ thuộc Radix.
 *
 * 🔴 `indeterminate` chỉ đặt được bằng JS (không có thuộc tính HTML tương ứng), nên phải gán
 * qua ref callback. Thiếu nó thì ô "chọn tất cả" hiển thị như CHƯA chọn gì trong khi người
 * dùng đã tick vài dòng — một lời nói dối nhỏ nhưng đủ để họ bấm nhầm.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked = false, indeterminate = false, ...props }, ref) => (
    <input
      type="checkbox"
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = indeterminate && !checked;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded border-input accent-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
