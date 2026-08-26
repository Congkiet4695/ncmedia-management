'use client';

import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { useLocaleFormat } from '@/hooks/use-locale-format';
import { EMPTY, type OrderPriceBreakdown } from '../../order-view-model';

/**
 * Cột **Price** (§3): Items Subtotal · Tax · Total Paid by Buyer · Estimated Amount.
 *
 * 🔴 `Buyer Paid` được làm nổi bật, ba dòng còn lại mờ hơn: đó là con số người vận hành thực
 * sự đối chiếu. Bốn số cùng cỡ chữ thì mắt phải đọc cả bốn mới tìm ra cái cần.
 *
 * 🔴 Dòng nào **không có dữ liệu từ API** thì hiện `—` kèm tooltip nói rõ vì sao, thay vì tự
 * suy ra bằng một công thức tự chế. Chi tiết ở `buildPriceBreakdown`.
 */
export function OrderPriceCell({ price }: { price: OrderPriceBreakdown }) {
  const { t } = useTranslation('pod');
  const { formatCurrency } = useLocaleFormat();

  const money = (value: number | null): string =>
    value === null ? EMPTY : formatCurrency(value, price.currency);

  return (
    <div className="space-y-0.5 text-right text-[11px] leading-tight">
      <Line label={t('orders.price.subtotal')} value={money(price.subtotal)} />
      <Line
        label={t('orders.price.tax')}
        value={money(price.tax)}
        hint={price.tax === null ? t('orders.price.taxHint') : undefined}
      />
      <Line
        label={t('orders.price.buyerPaid')}
        value={money(price.buyerPaid)}
        emphasis
      />
      <Line
        label={t('orders.price.estimated')}
        value={money(price.estimated)}
        hint={price.estimated === null ? t('orders.price.estimatedHint') : undefined}
      />
    </div>
  );
}

function Line({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: string;
}) {
  const body = (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground opacity-80">{label}</span>
      <span
        className={
          emphasis
            ? 'font-semibold tabular-nums text-foreground'
            : 'tabular-nums text-muted-foreground'
        }
      >
        {value}
      </span>
    </div>
  );

  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
}
