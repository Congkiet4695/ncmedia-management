import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Kích thước ảnh chụp màn hình gốc (cửa sổ 1440 × 900) — giữ đúng tỉ lệ, tránh nhảy bố cục. */
export const SCREENSHOT_SIZE = { width: 1440, height: 900 } as const;

/**
 * Khung "cửa sổ trình duyệt" cho ảnh chụp màn hình THẬT của hệ thống (dữ liệu mẫu, không dữ liệu thật / bí mật).
 * `priority` chỉ cho ảnh ở màn hình đầu tiên; còn lại tải lười (mặc định của next/image).
 */
export function ScreenshotFrame({
  src,
  alt,
  priority,
  className,
  sizes = '(min-width: 1024px) 50vw, 100vw',
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  return (
    <figure
      className={cn(
        'overflow-hidden rounded-xl border border-border/70 bg-card shadow-xl',
        className,
      )}
    >
      <div
        className="flex items-center gap-1.5 border-b border-border/70 bg-muted/60 px-3 py-2"
        aria-hidden
      >
        <span className="size-2.5 rounded-full bg-destructive/60" />
        <span className="size-2.5 rounded-full bg-warning/60" />
        <span className="size-2.5 rounded-full bg-success/60" />
      </div>
      <Image
        src={src}
        alt={alt}
        width={SCREENSHOT_SIZE.width}
        height={SCREENSHOT_SIZE.height}
        sizes={sizes}
        priority={priority}
        className="h-auto w-full"
      />
    </figure>
  );
}
