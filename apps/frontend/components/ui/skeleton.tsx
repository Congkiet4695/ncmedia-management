import { cn } from '@/lib/utils';

/**
 * Skeleton — khối giữ chỗ trong lúc tải.
 *
 * Dùng thay cho spinner ở BẢNG: spinner đặt giữa vùng trống làm cả bảng nhảy chiều cao khi
 * dữ liệu về. Skeleton giữ nguyên bố cục nên mắt người dùng không phải tìm lại vị trí cũ.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
