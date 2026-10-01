'use client';

import { ArrowDown, ArrowUp, CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { DashboardOverview, DashboardPeriod } from '../types';
import { formatChange } from '../utils';
import { WidgetCard } from './widget-card';

const PERIODS = ['today', 'yesterday', 'thisMonth', 'lastMonth'] as const;

/**
 * Đơn theo kỳ: Hôm nay · Hôm qua · Tháng này · Tháng trước (giờ vận hành do backend tính).
 * % chỉ có ở Hôm nay (so với Hôm qua) và Tháng này (so với Tháng trước); kỳ trước = 0 ⇒ "—".
 */
export function PeriodCards({
  data,
  loading,
  error,
  onRetry,
}: {
  data: DashboardOverview | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation('dashboard');
  return (
    <WidgetCard title={t('period.title')} icon={CalendarDays} hint={t('period.hint')} loading={loading} error={error} onRetry={onRetry}>
      {data && (
        <div className="grid gap-3 sm:grid-cols-2">
          {PERIODS.map((key) => (
            <PeriodTile
              key={key}
              label={t(`period.${key}`)}
              period={data.periods[key]}
              compare={key === 'today' || key === 'thisMonth'}
              currency={data.currency}
            />
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function PeriodTile({
  label,
  period,
  compare,
  currency,
}: {
  label: string;
  period: DashboardPeriod;
  compare: boolean;
  currency: string | null;
}) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useLocaleFormat();
  const money = (value: number) => (currency ? formatCurrency(value, currency) : '—');
  const change = period.orderChange;

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{period.orders}</p>
      <p
        className={cn(
          'mt-0.5 flex h-4 items-center gap-1 text-xs font-medium tabular-nums',
          change === null ? 'text-muted-foreground' : change >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
        )}
      >
        {compare &&
          (change === null ? (
            <span title={t('period.noBaseline')}>—</span>
          ) : (
            <>
              {change >= 0 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
              {formatChange(change)}
            </>
          ))}
      </p>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t('period.estRevenue')}</dt>
          <dd className="font-medium tabular-nums text-primary">{money(period.estRevenue)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t('period.payout')}</dt>
          <dd className="font-medium tabular-nums text-primary">{money(period.payout)}</dd>
        </div>
      </dl>
    </div>
  );
}
