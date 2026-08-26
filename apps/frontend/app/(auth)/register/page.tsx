import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { RegisterPanel } from '@/features/auth/components/register-panel';

/** Xem ghi chú ở trang Đăng nhập: metadata không biết ngôn ngữ đang chọn. */
export const metadata: Metadata = {
  title: env.appName,
};

export default function RegisterPage() {
  return <RegisterPanel />;
}
