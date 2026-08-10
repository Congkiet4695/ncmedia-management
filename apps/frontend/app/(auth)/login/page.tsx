import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { AuthCard } from '@/features/auth/components/auth-card';
import { LoginForm } from '@/features/auth/components/login-form';

/**
 * Tiêu đề tab dùng tên thương hiệu (trung lập ngôn ngữ): ngôn ngữ được lưu ở localStorage
 * nên server render metadata KHÔNG biết người dùng đang chọn ngôn ngữ nào.
 */
export const metadata: Metadata = {
  title: env.appName,
};

export default function LoginPage() {
  return (
    <AuthCard titleKey="login.title" descriptionKey="login.subtitle">
      <LoginForm />
    </AuthCard>
  );
}
