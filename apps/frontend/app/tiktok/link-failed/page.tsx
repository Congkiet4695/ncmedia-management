import { Suspense } from 'react';
import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { LinkFailedView } from '@/features/pod-tiktok/components/link-failed-view';

/**
 * Trang CÔNG KHAI báo uỷ quyền TikTok thất bại (state hỏng, Seller từ chối, TikTok lỗi…).
 *
 * Cùng lý do với trang thành công: Seller tới đây từ redirect của TikTok nên không thể
 * đặt guard đăng nhập.
 */
export const metadata: Metadata = {
  title: env.appName,
  robots: { index: false, follow: false },
};

export default function TiktokLinkFailedPage() {
  return (
    <Suspense>
      <LinkFailedView />
    </Suspense>
  );
}
