'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import type { PodOrderFinancials } from '../../order-types';
import { useFinancialLabels } from './order-financial-labels';

/**
 * Thông tin tài chính của đơn (màn chi tiết):
 *
 * ```
 *   Est. proceeds       $9.76
 *   Base cost           $4.00
 *   Seller shipping     $5.97   (chưa trừ trong Est. proceeds)
 *   Label cost          $0.50
 *   ─────────────────────────
 *   Profit             −$0.71
 *   Margin             −7.3%
 * ```
 *
 * 🔴 Mọi con số do backend tính (`calculateOrderFinancials`) — giao diện không cộng trừ gì. Không đủ dữ kiện ⇒ "—"
 * kèm lý do, không bao giờ hiện 0 thay cho "chưa biết".
 */
export function OrderFinancialCard({
  financials,
  currency,
}: {
  financials: PodOrderFinancials;
  currency: string | null;
}) {
  const { t } = useTranslation('pod');
  const { formatCurrency } = useLocaleFormat();
  const { sellerShippingLabel, sellerShippingHint, baseCostHint, profitHint } =
    useFinancialLabels(financials);
  const proceeds = financials.proceeds;
  const unit = proceeds?.currency ?? currency;
  const money = (value: number | null | undefined, code: string | null = unit) =>
    value === null || value === undefined || !code ? '—' : formatCurrency(value, code);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('orderDetail.financialTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Row
          label={
            proceeds
              ? t(`orders.price.proceeds.${proceeds.source}`)
              : t('orders.price.proceeds.label')
          }
          value={money(proceeds?.amount)}
          note={proceeds ? undefined : t('orders.price.profitStatus.NO_PROCEEDS')}
        />
        <Row
          label={t('orders.price.baseCost')}
          value={money(financials.productCost, financials.costCurrency ?? unit)}
          note={baseCostHint}
        />
        <Row
          label={sellerShippingLabel}
          value={financials.sellerShipping ? money(financials.sellerShipping.amount) : '—'}
          note={sellerShippingHint}
        />
        <Row
          label={t('orders.price.labelCost')}
          value={money(financials.labelCost, financials.labelCostCurrency || unit)}
          note={t('orders.price.labelCostHint')}
        />
        <div className="my-1 border-t" />
        <Row
          label={t('orders.price.profit')}
          value={money(financials.profit)}
          note={profitHint}
          emphasis
          tone={
            financials.profit === null
              ? undefined
              : financials.profit >= 0
                ? 'positive'
                : 'negative'
          }
        />
        <Row
          label={t('orders.price.margin')}
          value={financials.margin === null ? '—' : `${(financials.margin * 100).toFixed(2)}%`}
          note={
            financials.margin === null && financials.profit !== null
              ? t('orders.price.marginUndefined')
              : undefined
          }
        />
        <p className="pt-3 text-xs text-muted-foreground">{t('orderDetail.financialFormula')}</p>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  note,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  emphasis?: boolean;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="border-b py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span
          className={cn(
            'text-right text-sm tabular-nums',
            emphasis ? 'font-semibold' : 'font-medium',
            tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
            tone === 'negative' && 'text-destructive',
          )}
        >
          {value}
        </span>
      </div>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
