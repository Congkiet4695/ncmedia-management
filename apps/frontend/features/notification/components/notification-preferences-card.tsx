'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiError } from '@/hooks/use-api-error';
import { useNotificationPreferences, useSaveNotificationPreferences, useTelegramConfig } from '../hooks/use-notification';
import type { NotificationPreferences } from '../types';

const OPTIONS: Array<keyof NotificationPreferences> = ['newOrder', 'fulfillment'];

/**
 * Loại thông báo tổ chức muốn nhận (New Order / Fulfill).
 *
 * Lưu riêng theo TỔ CHỨC (backend lấy tổ chức từ JWT) và lưu được cả khi chưa cấu hình bot.
 * Backend áp dụng ở cả hai đầu: không ghi sự kiện cho loại đã tắt, worker bỏ qua sự kiện đã ghi
 * trước khi tắt — giao diện chỉ hiển thị, không tự lọc gì.
 */
export function NotificationPreferencesCard() {
  const { t } = useTranslation(['notification', 'common']);
  const translateApiError = useApiError();
  const query = useNotificationPreferences();
  const telegram = useTelegramConfig();
  const save = useSaveNotificationPreferences();
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);

  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);

  const dirty =
    draft !== null &&
    query.data !== undefined &&
    (draft.newOrder !== query.data.newOrder || draft.fulfillment !== query.data.fulfillment);
  const telegramReady = telegram.data?.configured === true && telegram.data.enabled;

  const handleSave = async () => {
    if (!draft) return;
    try {
      await save.mutateAsync(draft);
      toast.success(t('preferences.saved'));
    } catch (error) {
      toast.error(t('preferences.saveFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{t('preferences.title')}</CardTitle>
        <CardDescription>{t('preferences.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading || !draft ? (
          query.isError ? (
            <p className="text-sm text-destructive">{translateApiError(query.error)}</p>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )
        ) : (
          <>
            {!telegramReady && !telegram.isLoading && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {t('preferences.telegramNotReady')}
              </p>
            )}
            <div className="space-y-3">
              {OPTIONS.map((key) => (
                <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={draft[key]}
                    disabled={save.isPending}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{t(`preferences.${key}.label`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`preferences.${key}.hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
            <Button onClick={() => void handleSave()} disabled={!dirty || save.isPending}>
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t('common:action.save')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
