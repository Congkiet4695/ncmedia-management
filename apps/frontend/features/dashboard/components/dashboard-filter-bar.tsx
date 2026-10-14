'use client';

import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  DASHBOARD_DATE_PRESETS,
  type DashboardDatePreset,
  type DashboardFilterOptions,
  type DashboardRange,
} from '../types';

interface DashboardFilterBarProps {
  value: DashboardRange;
  /** Lựa chọn nhanh đang áp dụng; `CUSTOM` = người dùng tự chọn Từ ngày / Đến ngày. */
  preset: DashboardDatePreset;
  options: DashboardFilterOptions | undefined;
  onPresetChange: (preset: Exclude<DashboardDatePreset, 'CUSTOM'>) => void;
  onChange: (next: DashboardRange) => void;
}

/**
 * Bộ lọc chung: Thời gian (lựa chọn nhanh) · Khoảng ngày · Đơn vị tiền · Shop · Seller.
 *
 * - Thời gian / Khoảng ngày áp cho Tài chính / Đơn hàng / Thống kê seller / Xu hướng. Bốn thẻ Hôm nay · Hôm qua ·
 *   Tháng này · Tháng trước là kỳ CỐ ĐỊNH (theo đúng tên thẻ) nên không theo khoảng ngày.
 * - Lựa chọn nhanh điền sẵn Từ ngày / Đến ngày (theo giờ vận hành); sửa tay một trong hai ô ⇒ "Tuỳ chỉnh".
 *   "Tất cả thời gian" bỏ trống hai ô và gửi `allTime` — không tự giới hạn vào khoảng mặc định nào.
 * - Đơn vị tiền / Shop / Seller áp cho MỌI widget.
 * - Danh sách shop / seller đã được backend giới hạn theo phạm vi người xem.
 * - Quốc gia: mỗi shop TikTok thuộc một thị trường (vùng hiển thị cạnh tên shop) và mỗi thị trường
 *   một đơn vị tiền — lọc theo Đơn vị tiền / Shop là lọc theo thị trường, không cần ô thứ năm.
 * - Nằm trong luồng trang (không sticky / fixed) — cuộn đi cùng nội dung.
 */
export function DashboardFilterBar({ value, preset, options, onPresetChange, onChange }: DashboardFilterBarProps) {
  const { t } = useTranslation('dashboard');
  const set = (patch: Partial<DashboardRange>) => onChange({ ...value, ...patch });
  // Sửa tay một ô ngày khi đang "Tất cả thời gian" (hai ô trống) ⇒ khoảng MỘT ngày, ô kia lấy cùng giá trị.
  const setDay = (side: 'from' | 'to', day: string) => {
    const other = side === 'from' ? value.to || day : value.from || day;
    set(side === 'from' ? { from: day, to: other, allTime: false } : { from: other, to: day, allTime: false });
  };

  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <div className="space-y-1.5">
        <Label htmlFor="dash-preset" className="text-xs text-muted-foreground">
          {t('filter.period')}
        </Label>
        <NativeSelect
          id="dash-preset"
          value={preset}
          onChange={(event) => {
            const next = event.target.value as DashboardDatePreset;
            if (next !== 'CUSTOM') onPresetChange(next);
          }}
        >
          {DASHBOARD_DATE_PRESETS.map((option) => (
            <option key={option} value={option}>
              {t(`filter.preset.${option}`)}
            </option>
          ))}
          {/* Chỉ để HIỂN THỊ trạng thái "đã chọn ngày tay" — không chọn được (không có khoảng nào để điền). */}
          {preset === 'CUSTOM' && (
            <option value="CUSTOM" disabled>
              {t('filter.preset.CUSTOM')}
            </option>
          )}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dash-from" className="text-xs text-muted-foreground">
          {t('filter.from')}
        </Label>
        <Input
          id="dash-from"
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(event) => event.target.value && setDay('from', event.target.value)}
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
          min={value.from || undefined}
          onChange={(event) => event.target.value && setDay('to', event.target.value)}
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
