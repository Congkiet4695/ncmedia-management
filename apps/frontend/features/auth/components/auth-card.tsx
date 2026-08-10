'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Khung thẻ dùng chung cho các màn hình xác thực.
 *
 * Tồn tại vì các trang trong nhóm route `(auth)` là Server Component nên không gọi được
 * `useTranslation`.
 * Tách phần tiêu đề/mô tả ra client component giúp trang giữ nguyên khả năng SSR mà
 * chữ hiển thị vẫn theo ngôn ngữ người dùng chọn.
 *
 * @param titleKey Khoá dịch trong namespace `auth`, vd `login.title`.
 */
export function AuthCard({
  titleKey,
  descriptionKey,
  children,
}: {
  titleKey: string;
  descriptionKey: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('auth');
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t(titleKey)}</CardTitle>
        <CardDescription>{t(descriptionKey)}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
