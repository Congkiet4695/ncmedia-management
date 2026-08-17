'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader } from '@/components/ui/card';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { useCompleteTiktokOAuth, usePodTiktokLinkResult } from '../hooks/use-pod-tiktok';
import type { PodTiktokOAuthCompleteResult } from '../types';
import { LinkResultShell, TIKTOK_ACCOUNTS_PATH, useLinkErrorMessage } from './link-result-shell';

/** Đường dẫn "sạch" của chính trang này — không mang tham số nào. */
const CLEAN_PATH = '/tiktok/link-success';

/**
 * Trang kết quả uỷ quyền TikTok — cũng chính là **Redirect URI** đăng ký với TikTok
 * (`https://<domain>/tiktok/link-success`).
 *
 * Vòng đời:
 *  1. TikTok redirect về đây kèm `code`, `state`, `app_key`, `locale`, `shop_region`.
 *  2. Trang lập tức gửi các tham số đó xuống `POST /api/v1/tiktok/oauth/complete`.
 *     🔴 Frontend KHÔNG xử lý OAuth: không đổi token, không hiển thị `code`, không lưu
 *     `code` vào localStorage/sessionStorage, không log. Nó chỉ chuyển tiếp một lần.
 *  3. Xin xong kết quả thì **xoá toàn bộ query khỏi thanh địa chỉ** (`replaceState`) — mã
 *     uỷ quyền không được nằm lại trong URL, lịch sử duyệt web hay ảnh chụp màn hình.
 *  4. Hiển thị Account Name / Shop Name / Region / Linked Time, hoặc nguyên nhân thất bại.
 *
 * Trang cũng hỗ trợ đường tương thích ngược `?ref=` (khi Redirect URI vẫn trỏ vào backend,
 * backend xử lý xong rồi chuyển tiếp kèm vé đọc kết quả).
 */
export function LinkSuccessView() {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();
  const translateErrorCode = useLinkErrorMessage();
  const translateApiError = useApiError();
  const searchParams = useSearchParams();

  const completeMutation = useCompleteTiktokOAuth();
  const [result, setResult] = useState<PodTiktokOAuthCompleteResult | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);

  /**
   * Chốt tham số callback ở lần render ĐẦU TIÊN.
   *
   * Bắt buộc phải giữ lại vì ngay sau khi gọi backend, query bị xoá khỏi URL — đọc
   * `searchParams` ở lần render sau sẽ không còn gì.
   */
  const callbackRef = useRef(readCallbackParams(searchParams));
  const callback = callbackRef.current;

  // Đường tương thích ngược: backend đã xử lý xong và đưa sang đây kèm vé `ref`.
  const legacyResultQuery = usePodTiktokLinkResult(callback.hasCode ? undefined : callback.ref);

  /**
   * Gửi đúng MỘT lần. `code` dùng một lần duy nhất, nên effect chạy lại (React Strict Mode
   * ở dev gọi effect hai lượt) mà không chặn thì lượt thứ hai sẽ báo lỗi "state đã dùng"
   * và ghi đè mất kết quả thật.
   */
  const startedRef = useRef(false);
  const { mutateAsync: completeOAuth } = completeMutation;
  useEffect(() => {
    if (!callback.hasCode || startedRef.current) return;
    startedRef.current = true;

    completeOAuth({
      code: callback.code,
      state: callback.state,
      appKey: callback.appKey,
      locale: callback.locale,
      shopRegion: callback.shopRegion,
    })
      .then(setResult)
      .catch((error: unknown) => setTransportError(translateApiError(error)))
      .finally(() => {
        // Xoá query dù thành công hay thất bại: `code`/`state` không được ở lại trên URL.
        window.history.replaceState(null, '', CLEAN_PATH);
      });
  }, [callback, completeOAuth, translateApiError]);

  // --- Seller bấm Từ chối trên TikTok: quay về đây với `error`, không có `code` ---
  if (!callback.hasCode && callback.error) {
    return <FailureCard message={translateErrorCode(mapTiktokError(callback.error))} />;
  }

  // --- Đang hoàn tất (đường chính) hoặc đang đọc kết quả (đường tương thích) ---
  if ((callback.hasCode && !result && !transportError) || legacyResultQuery.isLoading) {
    return (
      <LinkResultShell>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('linkResult.loading')}</p>
        </CardContent>
      </LinkResultShell>
    );
  }

  if (transportError) return <FailureCard message={transportError} />;

  const summary = result ?? legacyResultQuery.data ?? null;

  // Không có tham số nào (vào thẳng URL) hoặc không tra được kết quả.
  if (!summary || legacyResultQuery.isError) {
    return <FailureCard message={translateErrorCode(null)} />;
  }

  if (!summary.success) {
    return (
      <FailureCard
        message={
          ('message' in summary && summary.message) || translateErrorCode(summary.errorCode)
        }
      />
    );
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
          <Row label={t('linkResult.accountName')} value={summary.accountName} />
          <Row label={t('linkResult.shopName')} value={summary.shopName} />
          <Row label={t('linkResult.region')} value={summary.region} />
          {summary.shopCount > 1 && (
            <Row label={t('linkResult.shopCount')} value={String(summary.shopCount)} />
          )}
          <Row
            label={t('linkResult.linkedAt')}
            value={summary.linkedAt ? formatDateTime(summary.linkedAt) : null}
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

/** Trạng thái thất bại — cùng hình hài với trang `/tiktok/link-failed`. */
function FailureCard({ message }: { message: string }) {
  const { t } = useTranslation('pod');
  return (
    <LinkResultShell>
      <CardHeader className="items-center text-center">
        <ShieldAlert className="size-12 text-destructive" />
        <h1 className="mt-3 text-xl font-bold tracking-tight">{t('linkResult.failedTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('linkResult.failedSubtitle')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{t('linkResult.reason')}</p>
          <p className="mt-1 text-muted-foreground">{message}</p>
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

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="ml-auto max-w-[65%] break-words text-right font-medium">{value}</dd>
    </div>
  );
}

/**
 * Đọc tham số TikTok đặt trên URL callback.
 * Tên tham số theo tài liệu TikTok (`code`, `state`, `app_key`, `locale`, `shop_region`);
 * chấp nhận `auth_code` như bí danh của `code` giống phía backend.
 */
function readCallbackParams(params: URLSearchParams) {
  const code = params.get('code') ?? params.get('auth_code') ?? '';
  const state = params.get('state') ?? '';
  return {
    code,
    state,
    hasCode: Boolean(code && state),
    appKey: params.get('app_key') ?? undefined,
    locale: params.get('locale') ?? undefined,
    shopRegion: params.get('shop_region') ?? undefined,
    error: params.get('error'),
    ref: params.get('ref') ?? undefined,
  };
}

/** `error=auth_denied` của TikTok → mã lỗi nghiệp vụ để dịch sang thông điệp người dùng. */
function mapTiktokError(error: string): string {
  return error === 'auth_denied' ? 'POD_TIKTOK_AUTH_DENIED' : 'POD_TIKTOK_INVALID_STATE';
}
