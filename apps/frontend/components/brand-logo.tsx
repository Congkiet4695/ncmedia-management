import Image from 'next/image';
import type { CSSProperties } from 'react';
import { env } from '@/lib/env';
import { cn } from '@/lib/utils';

/**
 * Logo chính thức của hệ thống — `public/logo.jpg` (1280×1280, nền than chì). NGUỒN DUY NHẤT: mọi chỗ
 * hiển thị logo (sidebar, drawer mobile, trang đăng nhập / đăng ký, màn hình tải, trang kết quả liên kết
 * TikTok) đều đi qua component này — đổi logo chỉ cần thay file ảnh.
 *
 * Ảnh gốc có khoảng nền trống lớn quanh logo. KHÔNG sửa ảnh: khung `overflow-hidden` + phóng ảnh bằng
 * `transform` chỉ cắt phần NỀN trống, nội dung logo không bị cắt / kéo giãn (khung vuông, `object-cover`
 * trên ảnh vuông ⇒ giữ đúng tỷ lệ).
 *  - `full`: biểu tượng + chữ — phần logo nằm trong khoảng ~21%…79% của ảnh ⇒ phóng 1.55 lần vẫn đủ lề.
 *  - `mark`: chỉ biểu tượng "S" (sidebar thu gọn, màn hình tải) — biểu tượng ở ~35%…56% chiều cao, tâm
 *    ~39.6% ⇒ phóng 2.6 lần rồi dời xuống 27% để tâm biểu tượng về giữa khung.
 */
const CROP: Record<BrandLogoVariant, { scale: number; style: CSSProperties }> = {
  full: { scale: 1.55, style: { transform: 'scale(1.55)' } },
  mark: { scale: 2.6, style: { transform: 'translateY(27%) scale(2.6)' } },
};

/**
 * Kích thước chuẩn theo vị trí — đổi cỡ logo ở MỘT chỗ, mọi nơi hiển thị đồng nhất.
 * `px` = cạnh khung lớn nhất (theo breakpoint) để Next chọn cỡ ảnh đủ nét.
 * (2026-10-14: tăng ~20% so với bản trước — sidebar 80→96, rail 40→48, tải 56→68, đăng nhập 112→136.)
 */
const SIZE = {
  /** Sidebar thu gọn (rail 76px). */
  rail: { className: 'size-12 rounded-lg', px: 48 },
  /** Sidebar mở rộng / drawer mobile. */
  sidebar: { className: 'size-24 rounded-xl shadow-md', px: 96 },
  /** Màn hình tải (khởi động app, chờ phiên). */
  splash: { className: 'size-[68px] rounded-xl shadow-md', px: 68 },
  /** Trang đơn lẻ ngoài shell (kết quả liên kết TikTok). */
  page: { className: 'size-24 rounded-2xl shadow-lg', px: 96 },
  /** Trang đăng nhập / đăng ký. */
  auth: { className: 'size-[116px] rounded-2xl shadow-lg sm:size-[136px]', px: 136 },
} as const;

export type BrandLogoVariant = 'full' | 'mark';
export type BrandLogoSize = keyof typeof SIZE;

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  /** Kích thước chuẩn theo vị trí hiển thị (xem `SIZE`). */
  size: BrandLogoSize;
  /** Lớp bổ sung (vd màu vòng viền). Khung luôn vuông để không méo ảnh. */
  className?: string;
  /** Ảnh nằm trong vùng hiển thị đầu tiên (sidebar, đăng nhập) ⇒ tải sớm. */
  priority?: boolean;
}

export function BrandLogo({ variant = 'full', size, className, priority }: BrandLogoProps) {
  const { className: sizeClass, px } = SIZE[size];
  return (
    <span
      className={cn(
        'relative block aspect-square shrink-0 overflow-hidden bg-sidebar ring-1 ring-sidebar-border',
        sizeClass,
        className,
      )}
    >
      <Image
        src="/logo.jpg"
        alt={`Logo ${env.appName}`}
        fill
        sizes={`${Math.ceil(px * CROP[variant].scale)}px`}
        priority={priority}
        className="object-cover"
        style={CROP[variant].style}
      />
    </span>
  );
}
