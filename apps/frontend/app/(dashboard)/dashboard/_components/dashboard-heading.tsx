'use client';

import { useTranslation } from 'react-i18next';

/**
 * Tiêu đề trang Dashboard.
 *
 * Tách thành client component vì `page.tsx` chạy trên server nên không dùng được
 * `useTranslation` — cùng cách xử lý với `AuthCard` ở nhóm route xác thực.
 */
export function DashboardHeading() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t('dashboard.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
    </div>
  );
}
