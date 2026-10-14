import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Button — component nền tảng theo chuẩn shadcn/ui (variant + size qua cva).
 *
 * Variant theo NGỮ NGHĨA hành động (docs/frontend-design-system.md §8) — chọn theo ý nghĩa, không theo sở thích màu:
 *  - `default` (Primary)  hành động chính của màn hình / form: Lưu, Xác nhận, Tạo.
 *  - `secondary`          hành động hỗ trợ đứng cạnh hành động chính.
 *  - `success`            hoàn tất / duyệt / kích hoạt (Approve, Publish, Activate).
 *  - `warning`            cần chú ý nhưng không phá huỷ (Tạm dừng, Gửi lại, Huỷ đồng bộ).
 *  - `destructive`        phá huỷ dữ liệu (Xoá, Thu hồi) — luôn đi kèm hộp xác nhận + nhãn chữ / icon.
 *  - `info`               đồng bộ, kiểm tra, xem thông tin (Sync, Check, Refresh).
 *  - `outline` / `ghost`  hành động phụ, mức nhấn thấp; `link` cho điều hướng dạng chữ.
 * Trạng thái: hover · active (nhấn) · focus-visible (vòng `ring`) · disabled đều thống nhất ở lớp gốc.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-[busy=true]:cursor-progress [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/80',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/80',
        success: 'bg-success text-success-foreground shadow-sm hover:bg-success/90 active:bg-success/80',
        warning: 'bg-warning text-warning-foreground shadow-sm hover:bg-warning/90 active:bg-warning/80',
        info: 'bg-info text-info-foreground shadow-sm hover:bg-info/90 active:bg-info/80',
        outline:
          'border border-input bg-card shadow-sm hover:border-primary/40 hover:bg-accent hover:text-accent-foreground active:bg-accent/70',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70 active:bg-secondary/60',
        ghost: 'hover:bg-accent hover:text-accent-foreground active:bg-accent/70',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
