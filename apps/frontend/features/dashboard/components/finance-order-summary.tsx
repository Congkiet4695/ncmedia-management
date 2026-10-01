'use client';

import { DollarSign, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { DashboardSummary, OrderStatusGroup } from '../types';
import { fullDay } from '../utils';
import { WidgetCard } from './widget-card';

/** Nhóm hiển thị trong bảng Đơn hàng (DELIVERED là thanh tiến độ; UNPAID/OTHER chỉ hiện khi có đơn). */
const ROWS: Array<{ group: OrderStatusGroup; tone?: 'danger'; optional?: boolean }> = [
  { group: 'SHIPPING' },
  { group: 'AWAITING_COLLECTION' },
  { group: 'TO_SHIP' },
  { group: 'UNPAID', optional: true },
  { group: 'CANCELLED', tone: 'danger' },
  { group: 'OTHER', optional: true },
];

/** Tài chính (Đã thanh toán / Đang xử lý) + Đơn hàng theo nhóm trạng thái — cùng khoảng ngày. */
export function FinanceOrderSummary({
  data,
  loading,
  error,
  onRetry,
}: {
  data: DashboardSummary | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const { formatCurrency } = useLocaleFormat();
  const currency = data?.currency ?? null;
  const money = (value: number) => (currency ? formatCurrency(value, currency) : '—');
  // Ngày đã là ngày theo giờ vận hành (backend) — hiển thị nguyên, không đổi múi giờ trình duyệt.
  const rangeText = data ? `${fullDay(data.from)} - ${fullDay(data.to)}` : '';

  return (
    <WidgetCard title={t('finance.title')} icon={DollarSign} hint={t('finance.hint')} loading={loading} error={error} onRetry={onRetry}>
      {data && (
        <div className="space-y-5">
          <section className="space-y-3">
            <p className="text-xs text-muted-foreground">{rangeText}</p>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-muted-foreground">{t('finance.paid')}</span>
              <span className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {money(data.finance.paid)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border-l-4 border-primary bg-primary/5 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('finance.processing')}</span>
              <span className="font-semibold tabular-nums text-primary">{money(data.finance.processing)}</span>
            </div>
          </section>

          <section className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2">
              <ShoppingCart className="size-4 text-primary" />
              <h4 className="text-sm font-semibold">{t('orders.title')}</h4>
            </div>
            <p className="text-2xl font-bold tabular-nums">{t('orders.count', { count: data.orders.total })}</p>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.min(data.orders.deliveredRate ?? 0, 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('orders.delivered', { count: data.orders.delivered })}
                {data.orders.deliveredRate !== null ? ` (${data.orders.deliveredRate}%)` : ''}
              </span>
            </div>
            <ul className="space-y-1.5 text-sm">
              {ROWS.map(({ group, tone, optional }) => {
                const row = data.orders.groups.find((entry) => entry.group === group);
                if (!row || (optional && row.count === 0)) return null;
                return (
                  <li
                    key={group}
                    className={cn(
                      'grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-md px-3 py-2',
                      tone === 'danger' ? 'border-l-4 border-destructive bg-destructive/5 text-destructive' : 'bg-muted/40',
                    )}
                  >
                    <span>{t(`orders.group.${group}`)}</span>
                    <span className="w-10 text-right tabular-nums">{row.count}</span>
                    <span className="w-24 text-right font-medium tabular-nums">{money(row.amount)}</span>
                  </li>
                );
              })}
              {/* Đơn hoàn: chưa đồng bộ TikTok Return & Refund ⇒ nói rõ, không hiện số đoán. */}
              {!data.returnsAvailable && (
                <li className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-md border-l-4 border-destructive/40 bg-muted/40 px-3 py-2 text-muted-foreground">
                  <span>{t('orders.group.RETURNED')}</span>
                  <Tooltip content={t('orders.returnsUnavailable')}>
                    <span className="text-xs italic">{t('orders.noData')}</span>
                  </Tooltip>
                </li>
              )}
            </ul>
          </section>
        </div>
      )}
    </WidgetCard>
  );
}
