'use client';

import { useState } from 'react';
import { LineChart as LineChartIcon, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ReportLineChart } from '@/features/reports/components/report-line-chart';
import { useChartTheme } from '@/features/reports/hooks/use-chart-theme';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { DashboardTrends } from '../types';
import { fullDay, shortDay } from '../utils';
import { WidgetCard } from './widget-card';

type Tab = 'finance' | 'orders';

/**
 * Biểu đồ xu hướng: tab Tài chính (Đã thanh toán / Đang xử lý) và Đơn hàng (Tổng / Giao thành
 * công / Đang xử lý / Đã huỷ). Backend trả ĐỦ mọi ngày trong khoảng (ngày trống = 0).
 */
export function TrendChartCard({
  data,
  loading,
  error,
  onRetry,
}: {
  data: DashboardTrends | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency, formatNumber } = useLocaleFormat();
  const theme = useChartTheme();
  const [tab, setTab] = useState<Tab>('finance');
  const currency = data?.currency ?? null;
  const money = (value: number) => (currency ? formatCurrency(value, currency) : String(value));

  const tabs: Array<{ key: Tab; label: string; icon: typeof TrendingUp }> = [
    { key: 'finance', label: t('trend.finance'), icon: TrendingUp },
    { key: 'orders', label: t('trend.orders'), icon: LineChartIcon },
  ];

  return (
    <WidgetCard title={t('trend.title')} icon={TrendingUp} loading={loading} error={error} onRetry={onRetry}>
      <div className="space-y-4">
        <div role="tablist" className="flex gap-4 border-b">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2 text-sm font-medium',
                tab === key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        {data && (
          <>
            <p className="text-sm font-semibold">
              {tab === 'finance'
                ? t('trend.financeTitle', { currency: currency ?? '—' })
                : t('trend.ordersTitle')}
            </p>
            <div className="h-72 w-full">
              {tab === 'finance' ? (
                <ReportLineChart
                  data={data.finance}
                  xKey="day"
                  series={[
                    { key: 'paid', name: t('trend.paid'), color: theme.categorical[0] },
                    { key: 'processing', name: t('trend.processing'), color: theme.categorical[1] },
                  ]}
                  valueFormatter={money}
                  tickFormatter={(value) => formatNumber(value)}
                  xTickFormatter={shortDay}
                  labelFormatter={fullDay}
                />
              ) : (
                <ReportLineChart
                  data={data.orders}
                  xKey="day"
                  series={[
                    { key: 'total', name: t('trend.total'), color: theme.categorical[0] },
                    { key: 'delivered', name: t('trend.delivered'), color: theme.categorical[1] },
                    { key: 'inProgress', name: t('trend.inProgress'), color: theme.categorical[2] },
                    { key: 'cancelled', name: t('trend.cancelled'), color: theme.categorical[3] },
                  ]}
                  valueFormatter={(value) => formatNumber(value)}
                  tickFormatter={(value) => formatNumber(value)}
                  xTickFormatter={shortDay}
                  labelFormatter={fullDay}
                />
              )}
            </div>
          </>
        )}
      </div>
    </WidgetCard>
  );
}
