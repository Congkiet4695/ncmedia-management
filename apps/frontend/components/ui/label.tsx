import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Label — primitive theo chuẩn shadcn/ui (dựng trên thẻ <label> thuần).
 */
const Label = React.forwardRef<HTMLLabelElement, React.ComponentProps<'label'>>(
  ({ className, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
          className,
        )}
        {...props}
      />
    );
  },
);
Label.displayName = 'Label';

export { Label };
