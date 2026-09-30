'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { cn } from '@/lib/utils';
import { EMPTY, type OrderPriceBreakdown } from '../../order-view-model';
import type { FinanceBreakdown, PodOrderProceeds } from '../../order-types';

/**
 * Cột **Giá**: Tạm tính · Thuế · Phí ship · Tổng tiền · Tiền thu về · Lợi nhuận · Margin.
 *
 * 🔴 Giao diện KHÔNG tự tính công thức tài chính nào — mọi số do backend trả:
 *   - Tiền thu về = \`settlement_amount\` (đã quyết toán) hoặc \`est_settlement_amount\` (ước tính)
 *     của TikTok Finance API; nhãn "Ước tính" / "Đã quyết toán" nói rõ nguồn.
 *   - Lợi nhuận = tiền thu về − base cost; Margin = lợi nhuận ÷ tiền thu về (backend tính).
 *   - Chưa đủ dữ kiện ⇒ \`—\` kèm tooltip nói đúng thiếu gì (chưa fulfill, chờ báo giá…).
 *
 * Hover dòng Tiền thu về ⇒ breakdown NGUYÊN VĂN của TikTok (Gross sales, Seller discount,
 * Referral fee, phí vận chuyển…).
 */
export function OrderPriceCell({ price }: { price: OrderPriceBreakdown }) {
  const { t } = useTranslation('pod');
  const { formatCurrency } = useLocaleFormat();
  const { financials } = price;
  const proceeds = financials.proceeds;
  const proceedsCurrency = proceeds?.currency ?? price.currency;

  const money = (value: number | null, currency = price.currency): string =>
    value === null ? EMPTY : formatCurrency(value, currency);

  const profitHint =
    financials.status === 'OK' ? undefined : t(`orders.price.profitStatus.${financials.status}`);

  return (
    <div className="space-y-0.5 text-right text-[11px] leading-tight">
      <Line label={t('orders.price.subtotal')} value={money(price.subtotal)} />
      <Line
        label={t('orders.price.tax')}
        value={money(price.tax)}
        hint={price.tax === null ? t('orders.price.taxHint') : undefined}
      />
      <Line label={t('orders.price.shipping')} value={money(price.shipping)} />
      <Line label={t('orders.price.buyerPaid')} value={money(price.buyerPaid)} emphasis />

      <div className="my-0.5 border-t border-dashed" />

      <Line
        label={
          proceeds
            ? t(`orders.price.proceeds.${proceeds.source}`)
            : t('orders.price.proceeds.label')
        }
        value={proceeds ? money(proceeds.amount, proceedsCurrency) : EMPTY}
        hint={
          proceeds ? (
            <ProceedsBreakdown proceeds={proceeds} />
          ) : (
            t('orders.price.profitStatus.NO_PROCEEDS')
          )
        }
      />
      <Line
        label={t('orders.price.profit')}
        value={money(financials.profit, proceedsCurrency)}
        hint={profitHint}
        tone={
          financials.profit === null
            ? undefined
            : financials.profit >= 0
              ? 'positive'
              : 'negative'
        }
      />
      <Line
        label={t('orders.price.margin')}
        value={
          financials.margin === null ? EMPTY : `${(financials.margin * 100).toFixed(1)}%`
        }
        hint={
          financials.margin === null && financials.profit !== null
            ? t('orders.price.marginUndefined')
            : profitHint
        }
      />
    </div>
  );
}

/** Tên hiển thị của một field breakdown: nhãn đã biết, còn lại hiện tên gốc cho dễ đọc. */
function useFieldLabel() {
  const { t, i18n } = useTranslation('pod');
  return (field: string): string => {
    const key = `orders.price.field.${field}`;
    if (i18n.exists(`pod:${key}`)) return t(key);
    return field.replace(/_amount$/, '').replace(/_/g, ' ');
  };
}

/**
 * Breakdown tiền thu về — đúng các khối TikTok trả (không cộng trừ gì thêm ở đây).
 * Dòng giá trị 0 được ẩn để tooltip đọc được (TikTok liệt kê hơn 50 loại phí).
 */
function ProceedsBreakdown({ proceeds }: { proceeds: PodOrderProceeds }) {
  const { t } = useTranslation('pod');
  const { formatCurrency, formatDateTime } = useLocaleFormat();
  const money = (value: number) => formatCurrency(value, proceeds.currency);
  // `estimated_settlement`: Unix timestamp (đơn đã giao) hoặc câu "x days after delivery" — giữ nguyên câu chữ.
  const settlement = proceeds.estimatedSettlement;
  const settlementText =
    settlement && /^\d+$/.test(settlement)
      ? formatDateTime(new Date(Number(settlement) * 1000).toISOString())
      : settlement;

  const sections: Array<{ title: string; total: number | null; breakdown: FinanceBreakdown | null }> = [
    { title: t('orders.price.section.revenue'), total: proceeds.revenueAmount, breakdown: proceeds.revenueBreakdown },
    { title: t('orders.price.section.feeTax'), total: proceeds.feeTaxAmount, breakdown: proceeds.feeTaxBreakdown },
    {
      title: t('orders.price.section.shippingCost'),
      total: proceeds.shippingCostAmount,
      breakdown: proceeds.shippingCostBreakdown,
    },
  ];

  return (
    <div className="min-w-[240px] space-y-1.5 text-left text-xs">
      <p className="font-medium">
        {t(`orders.price.proceeds.${proceeds.source}`)}: {money(proceeds.amount)}
      </p>
      {proceeds.source === 'ESTIMATED' && (
        <p className="text-[11px] opacity-80">
          {t('orders.price.estimatedNote')}
          {settlementText
            ? ` · ${t('orders.price.estimatedSettlement', { value: settlementText })}`
            : ''}
        </p>
      )}
      {sections.map((section) =>
        section.total === null ? null : (
          <div key={section.title}>
            <div className="flex justify-between gap-3 font-medium">
              <span>{section.title}</span>
              <span className="tabular-nums">{money(section.total)}</span>
            </div>
            <BreakdownLines breakdown={section.breakdown} money={money} />
          </div>
        ),
      )}
      {proceeds.adjustmentAmount !== null && proceeds.adjustmentAmount !== 0 && (
        <div className="flex justify-between gap-3 font-medium">
          <span>{t('orders.price.section.adjustment')}</span>
          <span className="tabular-nums">{money(proceeds.adjustmentAmount)}</span>
        </div>
      )}
      {proceeds.transactionCount > 1 && (
        <p className="text-[11px] opacity-80">
          {t('orders.price.multipleTransactions', { count: proceeds.transactionCount })}
        </p>
      )}
    </div>
  );
}

function BreakdownLines({
  breakdown,
  money,
  nested,
}: {
  breakdown: FinanceBreakdown | null;
  money: (value: number) => string;
  nested?: boolean;
}) {
  const labelOf = useFieldLabel();
  if (!breakdown) return null;

  return (
    <ul className={cn('space-y-0.5', nested ? 'pl-2' : 'pl-2 opacity-90')}>
      {Object.entries(breakdown).map(([field, value]) => {
        if (value === undefined) return null;
        if (typeof value === 'object') {
          return (
            <li key={field}>
              <BreakdownLines breakdown={value} money={money} nested />
            </li>
          );
        }
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount === 0) return null;
        return (
          <li key={field} className="flex justify-between gap-3">
            <span>{labelOf(field)}</span>
            <span className="tabular-nums">{money(amount)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Line({
  label,
  value,
  emphasis,
  hint,
  tone,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: ReactNode;
  tone?: 'positive' | 'negative';
}) {
  const body = (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground opacity-80">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          emphasis ? 'font-semibold text-foreground' : 'text-muted-foreground',
          tone === 'positive' && 'font-medium text-emerald-600 dark:text-emerald-400',
          tone === 'negative' && 'font-medium text-destructive',
        )}
      >
        {value}
      </span>
    </div>
  );

  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}
