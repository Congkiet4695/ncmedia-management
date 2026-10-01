'use client';

import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import type { DashboardFilterOptions, DashboardRange } from '../types';

interface DashboardFilterBarProps {
  value: DashboardRange;
  options: DashboardFilterOptions | undefined;
  onChange: (next: DashboardRange) => void;
}

/**
 * Bộ lọc chung: Khoảng ngày · Đơn vị tiền · Shop · Seller.
 *
 * - Khoảng ngày áp cho Tài chính / Đơn hàng / Thống kê seller / Xu hướng. Bốn thẻ Hôm nay · Hôm qua ·
 *   Tháng này · Tháng trước là kỳ CỐ ĐỊNH (theo đúng tên thẻ) nên không theo khoảng ngày.
 * - Đơn vị tiền / Shop / Seller áp cho MỌI widget.
 * - Danh sách shop / seller đã được backend giới hạn theo phạm vi người xem.
 * - Quốc gia: mỗi shop TikTok thuộc một thị trường (vùng hiển thị cạnh tên shop) và mỗi thị trường
 *   một đơn vị tiền — lọc theo Đơn vị tiền / Shop là lọc theo thị trường, không cần ô thứ năm.
 */
export function DashboardFilterBar({ value, options, onChange }: DashboardFilterBarProps) {
  const { t } = useTranslation('dashboard');
  const set = (patch: Partial<DashboardRange>) => onChange({ ...value, ...patch });

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-1.5">
        <Label htmlFor="dash-from" className="text-xs text-muted-foreground">
          {t('filter.from')}
        </Label>
        <Input
          id="dash-from"
          type="date"
          value={value.from}
          max={value.to}
          onChange={(event) => event.target.value && set({ from: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dash-to" className="text-xs text-muted-foreground">
          {t('filter.to')}
        </Label>
        <Input
          id="dash-to"
          type="date"
          value={value.to}
          min={value.from}
          onChange={(event) => event.target.value && set({ to: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dash-currency" className="text-xs text-muted-foreground">
          {t('filter.currency')}
        </Label>
        <NativeSelect
          id="dash-currency"
          value={value.currency ?? ''}
          onChange={(event) => set({ currency: event.target.value || undefined })}
        >
          {(options?.currencies.length ? options.currencies : []).map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
          {!options?.currencies.length && <option value="">—</option>}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dash-shop" className="text-xs text-muted-foreground">
          {t('filter.shop')}
        </Label>
        <NativeSelect
          id="dash-shop"
          value={value.shopId ?? ''}
          onChange={(event) => set({ shopId: event.target.value || undefined })}
        >
          <option value="">{t('filter.allShops')}</option>
          {options?.shops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.region ? `${shop.name} (${shop.region})` : shop.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dash-seller" className="text-xs text-muted-foreground">
          {t('filter.seller')}
        </Label>
        <NativeSelect
          id="dash-seller"
          value={value.sellerId ?? ''}
          onChange={(event) => set({ sellerId: event.target.value || undefined })}
        >
          <option value="">{t('filter.allSellers')}</option>
          {options?.sellers.map((seller) => (
            <option key={seller.id} value={seller.id}>
              {seller.name}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
