'use client';

import { Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { EMPTY } from '../../order-view-model';
import { CopyButton } from './copy-button';

/** Số mã vận đơn hiện thẳng; phần dư gom vào một dòng "+n". */
const VISIBLE_LIMIT = 2;

/**
 * Cột **Tracking Number** (§5).
 *
 * Chưa có ⇒ `—`. Có ⇒ mã (rút gọn giữa) kèm nút Copy. Nhiều mã ⇒ danh sách.
 *
 * 🔴 Rút gọn ở GIỮA chứ không cắt đuôi: hai kiện cùng hãng vận chuyển thường trùng nhau ở
 * phần đầu, cắt đuôi là hai dòng trông y hệt nhau. Nút Copy luôn chép mã ĐẦY ĐỦ.
 */
export function TrackingCell({ numbers }: { numbers: string[] }) {
  const { t } = useTranslation('pod');

  if (numbers.length === 0) {
    return <span className="text-sm text-muted-foreground">{EMPTY}</span>;
  }

  const visible = numbers.slice(0, VISIBLE_LIMIT);
  const hidden = numbers.slice(VISIBLE_LIMIT);

  return (
    <ul className="space-y-1">
      {visible.map((number) => (
        <li key={number} className="flex items-center gap-1">
          <Truck className="size-3 shrink-0 text-muted-foreground" />
          <Tooltip content={number}>
            <span className="font-mono text-[11px] tabular-nums">{shorten(number)}</span>
          </Tooltip>
          <CopyButton value={number} label={t('orders.copyTracking')} />
        </li>
      ))}

      {hidden.length > 0 && (
        <Tooltip content={hidden.join(' · ')}>
          <li className="cursor-default text-[11px] text-muted-foreground">
            {t('orders.moreTracking', { count: hidden.length })}
          </li>
        </Tooltip>
      )}
    </ul>
  );
}

/** `920019203924123456` → `9200192…3456`. Giữ đủ đầu và đuôi để phân biệt bằng mắt. */
function shorten(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}
