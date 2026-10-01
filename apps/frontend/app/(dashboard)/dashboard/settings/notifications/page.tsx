'use client';

import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/require-permission';
import { NotificationEventsTable } from '@/features/notification/components/notification-events-table';
import { NotificationPreferencesCard } from '@/features/notification/components/notification-preferences-card';
import { TelegramConfigCard } from '@/features/notification/components/telegram-config-card';

/**
 * Cài đặt thông báo của TỔ CHỨC — chỉ người có `notification.config` (mặc định Admin).
 * Backend chặn lại bằng cùng permission; guard ở đây chỉ để không hiện trang trống cho Seller.
 */
export default function NotificationSettingsPage() {
  const { t } = useTranslation('notification');
  return (
    <RequirePermission permission="notification.config" message={t('noPermission')}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('pageDescription')}</p>
        </div>
        <TelegramConfigCard />
        <NotificationPreferencesCard />
        <NotificationEventsTable />
      </div>
    </RequirePermission>
  );
}
