'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader } from '@/components/ui/card';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { usePodTiktokLinkResult } from '../hooks/use-pod-tiktok';
import {
  LinkResultShell,
  TIKTOK_ACCOUNTS_PATH,
  useLinkErrorMessage,
} from './link-result-shell';

/**
 * Trang xác nhận đã liên kết TikTok Shop.
 *
 * 🔴 Không còn Authorization Code ở đây. Backend đã tự đổi token, tự lấy shop và tự lưu
 * kết nối TRƯỚC khi chuyển hướng tới đây; trang chỉ đọc một tóm tắt phi nhạy cảm qua vé
 * `ref` trên URL (tên shop, region, thời điểm). Token không bao giờ ra tới frontend.
 */
export function LinkSuccessView() {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();
  const translateError = useLinkErrorMessage();
  const searchParams = useSearchParams();
  const ref = searchParams.get('ref') ?? undefined;

  const resultQuery = usePodTiktokLinkResult(ref);

  if (!ref || resultQuery.isError) {
    return <FailureCard message={translateError(null)} />;
  }

  if (resultQuery.isLoading || !resultQuery.data) {
    return (
      <LinkResultShell>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('linkResult.loading')}</p>
        </CardContent>
      </LinkResultShell>
    );
  }

  const result = resultQuery.data;

  // Vé hợp lệ nhưng phiên đã hỏng (vd Seller từ chối) — hiển thị đúng nguyên nhân
  // thay vì báo thành công sai sự thật.
  if (!result.success) {
    return <FailureCard message={translateError(result.errorCode)} />;
  }

  return (
    <LinkResultShell>
      <CardHeader className="items-center text-center">
        <CheckCircle2 className="size-12 text-emerald-600" />
        <h1 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
          {t('linkResult.successTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('linkResult.successSubtitle')}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        <dl className="divide-y rounded-md border text-sm">
          <Row label={t('linkResult.accountName')} value={result.accountName} />
          <Row label={t('linkResult.shopName')} value={result.shopName} />
          <Row label={t('linkResult.region')} value={result.region} />
          {result.shopCount > 1 && (
            <Row label={t('linkResult.shopCount')} value={String(result.shopCount)} />
          )}
          <Row
            label={t('linkResult.linkedAt')}
            value={result.linkedAt ? formatDateTime(result.linkedAt) : null}
          />
        </dl>

        <Button asChild className="w-full">
          <Link href={TIKTOK_ACCOUNTS_PATH}>
            {t('linkResult.returnToDashboard')}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </CardContent>
    </LinkResultShell>
  );
}

/** Nhánh hỏng của chính trang success — giữ nguyên một hình hài với trang link-failed. */
function FailureCard({ message }: { message: string }) {
  const { t } = useTranslation('pod');
  return (
    <LinkResultShell>
      <CardHeader className="items-center text-center">
        <ShieldAlert className="size-12 text-destructive" />
        <h1 className="mt-3 text-xl font-bold tracking-tight">{t('linkResult.failedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <Link href={TIKTOK_ACCOUNTS_PATH}>{t('linkResult.tryAgain')}</Link>
        </Button>
      </CardContent>
    </LinkResultShell>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto max-w-[65%] break-words text-right font-medium">{value}</dd>
    </div>
  );
}
