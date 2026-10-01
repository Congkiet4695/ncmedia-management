'use client';

import { Store, Users, Wallet } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import type { DashboardOverview } from '../types';
import { WidgetCard, WidgetEmpty } from './widget-card';

interface OverviewCardProps {
  data: DashboardOverview | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** TỔNG TIỀN ĐANG HOLD — tiền TikTok CHƯA quyết toán, theo đơn vị tiền đang chọn. */
export function HoldCard({ data, loading, error, onRetry }: OverviewCardProps) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useLocaleFormat();
  const hold = data?.hold;

  return (
    <WidgetCard title={t('hold.title')} icon={Wallet} hint={t('hold.hint')} loading={loading} error={error} onRetry={onRetry}>
      {hold && (
        <div className="flex h-full flex-col justify-center gap-3">
          <div className="flex items-center gap-2">
            {hold.currency ? <Badge variant="default">{hold.currency}</Badge> : <Badge variant="muted">—</Badge>}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <p className="text-3xl font-bold tabular-nums tracking-tight text-primary">
              {hold.currency ? formatCurrency(hold.amount, hold.currency) : '—'}
            </p>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              <Store className="size-3.5" />
              <b className="tabular-nums text-foreground">{hold.shopCount}</b> {t('hold.shops')}
            </span>
          </div>
          {/* Đơn vị tiền khác: liệt kê riêng, KHÔNG quy đổi (hệ thống không có nguồn tỷ giá). */}
          {hold.otherCurrencies.length > 0 && (
            <ul className="space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
              {hold.otherCurrencies.map((row) => (
                <li key={row.currency} className="flex justify-between tabular-nums">
                  <span>{row.currency}</span>
                  <span>
                    {formatCurrency(row.amount, row.currency)} · {row.shopCount} {t('hold.shops')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

const SHOP_COLORS = { live: '#52c41a', inactive: '#ef4444', deauthorized: '#f59e0b' } as const;

/** TRẠNG THÁI SHOP — donut theo trạng thái thật của shop (ACTIVE / INACTIVE / DEAUTHORIZED). */
export function ShopStatusCard({ data, loading, error, onRetry }: OverviewCardProps) {
  const { t } = useTranslation('dashboard');
  const status = data?.shopStatus;
  const slices = status
    ? (['live', 'inactive', 'deauthorized'] as const).map((key) => ({
        key,
        name: t(`shop.${key}`),
        value: status[key],
        color: SHOP_COLORS[key],
      }))
    : [];
  const visible = slices.filter((slice) => slice.value > 0);

  return (
    <WidgetCard title={t('shop.title')} icon={Store} hint={t('shop.hint')} loading={loading} error={error} onRetry={onRetry}>
      {status && (
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative size-36 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={visible.length ? visible : [{ key: 'empty', name: '', value: 1, color: '#e5e7eb' }]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="68%"
                  outerRadius="100%"
                  stroke="none"
                  isAnimationActive={false}
                >
                  {(visible.length ? visible : [{ key: 'empty', color: '#e5e7eb' }]).map((slice) => (
                    <Cell key={slice.key} fill={slice.color} />
                  ))}
                </Pie>
                {visible.length > 0 && <ChartTooltip />}
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums">{status.total}</span>
              <span className="text-xs text-muted-foreground">{t('shop.shops')}</span>
            </div>
          </div>
          <ul className="min-w-40 flex-1 space-y-2 text-sm">
            {slices.map((slice) => (
              <li key={slice.key} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: slice.color }} />
                  {slice.name}
                </span>
                <span className="font-semibold tabular-nums" style={{ color: slice.value ? slice.color : undefined }}>
                  {slice.value}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 border-t pt-2 text-muted-foreground">
              <span>{t('shop.total')}</span>
              <span className="font-semibold tabular-nums text-foreground">{status.total}</span>
            </li>
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** TIỀN HOLD THEO NHÂN SỰ — đủ MỌI seller có hold (cuộn trong thẻ, không cắt top N). */
export function HoldBySellerCard({ data, loading, error, onRetry }: OverviewCardProps) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useLocaleFormat();
  const rows = data?.holdBySeller ?? [];
  const currency = data?.hold.currency ?? null;

  return (
    <WidgetCard
      title={t('holdBySeller.title')}
      icon={Users}
      hint={t('holdBySeller.hint')}
      loading={loading}
      error={error}
      onRetry={onRetry}
      contentClassName="p-0"
    >
      {rows.length === 0 ? (
        <WidgetEmpty message={t('holdBySeller.empty')} />
      ) : (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-medium">{t('holdBySeller.seller')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('holdBySeller.shop')}</th>
                <th className="px-5 py-2 text-right font-medium">{currency ?? '—'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sellerId ?? 'unassigned'} className="border-t">
                  <td className="px-5 py-2 font-medium">{row.sellerName ?? t('unassigned')}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.shopCount}</td>
                  <td className="px-5 py-2 text-right font-semibold tabular-nums text-primary">
                    {currency ? formatCurrency(row.amount, currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetCard>
  );
}
