'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, CheckCircle2, Copy, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocaleFormat } from '@/hooks/use-locale-format';

/** Tham số mang giá trị nhạy cảm — hiển thị riêng, không đưa vào bảng chi tiết. */
const AUTH_CODE_KEYS = ['auth_code', 'code'] as const;

/**
 * Màn hình công khai hiển thị Authorization Code TikTok trả về.
 *
 * 🔴 Bảo mật: mã CHỈ tồn tại trong bộ nhớ của trang. Không ghi localStorage, không đặt cookie,
 * không gửi đi đâu, không `console.log`. Đóng tab là mất — đúng như mong muốn với một mã dùng
 * một lần. Trang cũng đặt `robots: noindex` để không bị lập chỉ mục.
 */
export function LinkSuccessView() {
  const { t } = useTranslation('pod');
  const { formatDateTime } = useLocaleFormat();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Thời điểm uỷ quyền theo đồng hồ TRÌNH DUYỆT.
   *
   * Chốt một lần khi trang mở (không phải lúc render) để giá trị không nhảy mỗi lần re-render,
   * và đặt trong `useEffect` để tránh lệch hydration giữa server và client.
   */
  const [authorizedAt, setAuthorizedAt] = useState<string | null>(null);
  useEffect(() => setAuthorizedAt(new Date().toISOString()), []);

  /**
   * Đọc TOÀN BỘ query param, không chỉ `auth_code`.
   * TikTok bổ sung tham số mới sau này sẽ tự hiện ra ở bảng chi tiết — không phải sửa code.
   */
  const allParams = useMemo(
    () => Array.from(searchParams.entries()),
    [searchParams],
  );

  const authCode = useMemo(() => {
    for (const key of AUTH_CODE_KEYS) {
      const value = searchParams.get(key);
      if (value) return value;
    }
    return null;
  }, [searchParams]);

  const otherParams = useMemo(
    () => allParams.filter(([key]) => !(AUTH_CODE_KEYS as readonly string[]).includes(key)),
    [allParams],
  );

  const handleCopy = async () => {
    if (!authCode) return;
    try {
      await navigator.clipboard.writeText(authCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success(t('linkSuccess.copied'));
    } catch {
      // Clipboard API cần ngữ cảnh bảo mật (HTTPS) và quyền — trên vài trình duyệt mobile
      // sẽ bị chặn. Bôi đen sẵn nội dung để người dùng copy tay được ngay.
      inputRef.current?.select();
      toast.error(t('linkSuccess.copyFailed'));
    }
  };

  if (!authCode) {
    return (
      <Shell>
        <CardHeader className="items-center text-center">
          <ShieldAlert className="size-12 text-destructive" />
          <h1 className="mt-3 text-xl font-bold tracking-tight">{t('linkSuccess.failedTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('linkSuccess.failedSubtitle')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {otherParams.length > 0 && <ParamTable params={otherParams} label={t('linkSuccess.details')} />}
          <Button asChild variant="outline" className="w-full">
            <Link href="/dashboard/pod/tiktok-accounts">
              <ArrowLeft className="size-4" />
              {t('linkSuccess.back')}
            </Link>
          </Button>
        </CardContent>
      </Shell>
    );
  }

  return (
    <Shell>
      <CardHeader className="items-center text-center">
        <CheckCircle2 className="size-12 text-emerald-600" />
        <h1 className="mt-3 text-xl font-bold tracking-tight sm:text-2xl">
          {t('linkSuccess.title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('linkSuccess.subtitle')}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="auth-code">{t('linkSuccess.authCodeLabel')}</Label>
          <Input
            id="auth-code"
            ref={inputRef}
            readOnly
            value={authCode}
            // Bấm vào là bôi đen toàn bộ — thao tác quen thuộc khi cần copy tay.
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            className="break-all font-mono text-sm"
            spellCheck={false}
          />
        </div>

        <Button onClick={() => void handleCopy()} className="w-full">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {t('linkSuccess.copy')}
        </Button>

        <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          {t('linkSuccess.expiryNotice')}
        </p>

        {authorizedAt && (
          <dl className="flex items-baseline justify-between border-t pt-3 text-xs">
            <dt className="text-muted-foreground">{t('linkSuccess.authorizationTime')}</dt>
            <dd className="font-medium">{formatDateTime(authorizedAt)}</dd>
          </dl>
        )}

        {otherParams.length > 0 && <ParamTable params={otherParams} label={t('linkSuccess.details')} />}

        <p className="text-center text-xs text-muted-foreground">
          {t('linkSuccess.securityNotice')}
        </p>
      </CardContent>
    </Shell>
  );
}

/** Khung căn giữa, dùng chung cho cả trạng thái thành công lẫn thất bại. */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-lg">{children}</Card>
    </div>
  );
}

/**
 * Bảng các tham số còn lại TikTok gửi kèm (app_key, state, shop_id…).
 * Render động từ chính query string nên tham số mới xuất hiện mà không cần sửa gì.
 */
function ParamTable({ params, label }: { params: [string, string][]; label: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <dl className="divide-y rounded-md border text-xs">
        {params.map(([key, value]) => (
          <div key={key} className="flex flex-wrap gap-x-3 px-3 py-2">
            <dt className="font-mono text-muted-foreground">{key}</dt>
            <dd className="ml-auto max-w-[65%] break-all text-right font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
