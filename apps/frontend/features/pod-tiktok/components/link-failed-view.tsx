'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader } from '@/components/ui/card';
import { usePodTiktokLinkResult } from '../hooks/use-pod-tiktok';
import {
  LinkResultShell,
  TIKTOK_ACCOUNTS_PATH,
  useLinkErrorMessage,
} from './link-result-shell';

/**
 * Trang báo uỷ quyền TikTok thất bại.
 *
 * Hai nguồn nguyên nhân:
 *  - `ref`: phiên đã được nhận diện ⇒ đọc mã lỗi đã lưu server-side.
 *  - `error`: `state` hỏng nên không có phiên nào để tra ⇒ backend gửi thẳng mã lỗi.
 */
export function LinkFailedView() {
  const { t } = useTranslation('pod');
  const translateError = useLinkErrorMessage();
  const searchParams = useSearchParams();
  const ref = searchParams.get('ref') ?? undefined;
  const errorParam = searchParams.get('error');

  const resultQuery = usePodTiktokLinkResult(ref);

  if (ref && resultQuery.isLoading) {
    return (
      <LinkResultShell>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('linkResult.loading')}</p>
        </CardContent>
      </LinkResultShell>
    );
  }

  const errorCode = resultQuery.data?.errorCode ?? errorParam;

  return (
    <LinkResultShell>
      <CardHeader className="items-center text-center">
        <ShieldAlert className="size-12 text-destructive" />
        <h1 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
          {t('linkResult.failedTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('linkResult.failedSubtitle')}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{t('linkResult.reason')}</p>
          <p className="mt-1 text-muted-foreground">{translateError(errorCode)}</p>
        </div>

        <Button asChild className="w-full">
          <Link href={TIKTOK_ACCOUNTS_PATH}>
            <RefreshCw className="size-4" />
            {t('linkResult.tryAgain')}
          </Link>
        </Button>
      </CardContent>
    </LinkResultShell>
  );
}
