'use client';

import { AlertTriangle, DollarSign, Package, Store, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { useApiError } from '@/hooks/use-api-error';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import type { PodPayoutSummary } from '../payout-types';

interface PayoutSummaryCardProps {
  data?: PodPayoutSummary;
  loading: boolean;
  error: unknown;
}

/** Khung xương khi tải — giữ đúng chiều cao để layout không nhảy. */
function SummarySkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="sm:col-span-2">
        <CardContent className="space-y-3 p-6">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-10 w-56 animate-pulse rounded bg-muted" />
          <div className="h-3 w-40 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-3 p-6">
            <div className="h-3 w-20 animate-pulse rounded bg-muted" />
            <div className="h-7 w-16 animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Report Card — PAYOUT.
 *
 * Con số lớn = tổng Payout của TOÀN BỘ Account trong khoảng thời gian đã chọn,
 * lấy trực tiếp từ số tiền TikTok đã chi (Finance API), không tự tính lại.
 */
export function PayoutSummaryCard({ data, loading, error }: PayoutSummaryCardProps) {
  const { t } = useTranslation('pod');
  const translateApiError = useApiError();
  const { formatCurrency, formatDate, formatNumber } = useLocaleFormat();

  if (loading && !data) return <SummarySkeleton />;

  if (error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <AlertTriangle className="size-8 text-destructive" />
          <p className="text-sm text-destructive">
            {translateApiError(error)}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const mixedCurrency = data.currencies.length > 1;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="sm:col-span-2">
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <DollarSign className="size-4" />
            {t('payout.payout')}
          </div>
          <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
            {formatCurrency(data.totalPayout, data.currency)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {data.range.from && data.range.to
              ? `${formatDate(data.range.from)} → ${formatDate(data.range.to)}`
              : t('payout.allTime')}
            {' · '}
            {t('payout.payments', { count: data.paymentCount })}
          </p>

          {/* Cộng dồn nhiều loại tiền là sai về tài chính — phải nói rõ thay vì hiển thị êm. */}
          {mixedCurrency && (
            <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{t('payout.mixedCurrencyFull', { list: data.currencies.join(', ') })}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Package className="size-4" />
            {t('payout.settledOrders')}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatNumber(data.orderCount)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Store className="size-4" />
            {t('payout.accounts')}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatNumber(data.accountCount)}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3" />
            {formatNumber(data.sellerCount)} {t('payout.sellers')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
