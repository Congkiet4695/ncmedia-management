'use client';

import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/require-permission';
import { NotificationEventsTable } from '@/features/notification/components/notification-events-table';
import { NotificationPreferencesCard } from '@/features/notification/components/notification-preferences-card';
import { TelegramConfigCard } from '@/features/notification/components/telegram-config-card';

/**
 * Thông báo Telegram CÁ NHÂN của người đang đăng nhập (mặc định: Employee, quyền `notification.self`).
 *
 * Cùng ba khối với trang của tổ chức (cấu hình bot / loại thông báo / thông báo gần đây), nhưng mọi lời gọi đi vào
 * `/notifications/me/*`. Không có ô chọn shop: phạm vi là các shop ĐANG được gán cho người dùng, backend tự lọc lúc
 * ghi và lúc gửi. Guard ở đây chỉ để không hiện trang trống — backend chặn bằng cùng quyền.
 */
export default function MyNotificationSettingsPage() {
  const { t } = useTranslation('notification');
  return (
    <RequirePermission permission="notification.self" message={t('me.noPermission')}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('me.pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('me.pageDescription')}</p>
        </div>
        <p className="flex gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('me.scopeNote')}
        </p>
        <TelegramConfigCard scope="me" />
        <NotificationPreferencesCard scope="me" />
        <NotificationEventsTable scope="me" />
      </div>
    </RequirePermission>
  );
}
