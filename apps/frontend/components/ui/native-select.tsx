import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * NativeSelect — select gốc HTML được style theo shadcn/ui.
 * Dùng native để không thêm dependency Radix; tương thích React Hook Form (forwardRef).
 */
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
