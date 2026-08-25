'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { RequirePermission } from '@/components/require-permission';
import { useApiError } from '@/hooks/use-api-error';
import {
  SessionConfigForm,
  emptyConfig,
  type SessionConfigValue,
} from '@/features/pod-listing-session/components/session-config-form';
import { useCreateSession } from '@/features/pod-listing-session/hooks';

export default function NewListingPage() {
  const { t } = useTranslation('pod');
  return (
    <RequirePermission permission="pod.session.write" message={t('listing.common.noPermission')}>
      <NewListingView />
    </RequirePermission>
  );
}

/**
 * **POD → Auto Listing → New Listing**.
 *
 * Bước duy nhất ở đây là **cấu hình**: Market → Shops → 5 Template. Import file là bước tiếp
 * theo và diễn ra bên trong lượt đăng vừa tạo — tách ra như vậy vì cùng một cấu hình thường
 * được nạp thêm hàng nhiều lần, còn bắt chọn lại template mỗi lần import thì không.
 *
 * 🔴 Tạo lượt đăng KHÔNG gửi gì lên sàn.
 */
function NewListingView() {
  const { t } = useTranslation(['pod', 'common']);
  const router = useRouter();
  const translateApiError = useApiError();
  const create = useCreateSession();

  const [config, setConfig] = useState<SessionConfigValue>(emptyConfig());

  const submit = async (): Promise<void> => {
    if (!config.name.trim()) {
      toast.error(t('listing.sessions.missingName'));
      return;
    }

    try {
      const session = await create.mutateAsync({
        name: config.name.trim(),
        market: config.market,
        shopIds: config.shopIds,
        templates: config.templates,
        note: config.note.trim() || undefined,
      });
      toast.success(t('listing.sessions.created'));
      router.push(`/dashboard/pod/auto-listing/${session.id}`);
    } catch (error) {
      toast.error(t('listing.sessions.createFailed'), { description: translateApiError(error) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/pod/auto-listing">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('listing.sessions.newTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('listing.sessions.newSubtitle')}</p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <SessionConfigForm value={config} onChange={setConfig} disabled={create.isPending} />

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" asChild>
              <Link href="/dashboard/pod/auto-listing">{t('common:action.cancel')}</Link>
            </Button>
            <Button onClick={() => void submit()} disabled={create.isPending}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              {t('listing.sessions.createAndContinue')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
