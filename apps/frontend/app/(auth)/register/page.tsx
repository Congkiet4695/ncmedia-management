import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { AuthCard } from '@/features/auth/components/auth-card';
import { RegisterForm } from '@/features/auth/components/register-form';

/** Xem ghi chú ở trang Đăng nhập: metadata không biết ngôn ngữ đang chọn. */
export const metadata: Metadata = {
  title: env.appName,
};

export default function RegisterPage() {
  return (
    <AuthCard titleKey="register.title" descriptionKey="register.subtitle">
      <RegisterForm />
    </AuthCard>
  );
}
