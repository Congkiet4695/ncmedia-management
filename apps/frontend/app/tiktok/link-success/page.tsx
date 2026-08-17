import { Suspense } from 'react';
import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { LinkSuccessView } from '@/features/pod-tiktok/components/link-success-view';

/**
 * Trang CÔNG KHAI xác nhận đã liên kết TikTok Shop.
 *
 * Nằm ngoài nhóm route `(dashboard)` nên không có sidebar, không có guard đăng nhập —
 * Seller tới đây từ redirect của TikTok khi chưa (hoặc không) đăng nhập hệ thống.
 * `middleware.ts` chỉ chặn `/dashboard/*`, `/login`, `/register` nên đường dẫn này đi thẳng.
 */
export const metadata: Metadata = {
  title: env.appName,
  // Trang kết quả của một phiên uỷ quyền — không để công cụ tìm kiếm lập chỉ mục.
  robots: { index: false, follow: false },
};

export default function TiktokLinkSuccessPage() {
  // `useSearchParams()` bên trong yêu cầu ranh giới Suspense theo tài liệu Next.js;
  // thiếu nó thì cả trang có thể âm thầm rơi về render phía client.
  return (
    <Suspense>
      <LinkSuccessView />
    </Suspense>
  );
}
