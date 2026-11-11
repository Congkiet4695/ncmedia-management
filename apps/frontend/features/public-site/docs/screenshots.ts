// Chỉ dùng trong Server Component (đọc filesystem) — không import từ component 'use client'.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Thư mục ảnh minh hoạ tài liệu trong `public/` (KHÔNG đặt dưới `public/docs` vì trùng route /docs). */
export const DOC_SCREENSHOT_DIR = 'docs-screens';

/** Tên file ảnh của một màn hình: `/dashboard/pod/orders` → `dashboard-pod-orders.webp` (nhiều bài dùng chung 1 ảnh). */
export function screenshotFileForRoute(route: string): string {
  return `${route.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'root'}.webp`;
}

/**
 * Ảnh chụp màn hình THẬT (môi trường local, dữ liệu mẫu hư cấu) của màn hình mà bài viết mô tả, nếu đã có.
 * Kiểm tra file phía server lúc build → màn hình chưa có ảnh thì không hiển thị khung ảnh (không dùng ảnh giả).
 */
export function getDocScreenshot(route: string): string | null {
  const file = screenshotFileForRoute(route);
  return existsSync(join(process.cwd(), 'public', DOC_SCREENSHOT_DIR, file))
    ? `/${DOC_SCREENSHOT_DIR}/${file}`
    : null;
}
