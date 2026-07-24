'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  GROUP_BY_OPTIONS,
  METRIC_OPTIONS,
  QUICK_RANGE_OPTIONS,
  type QuickRange,
  type ReportGroupBy,
  type ReportMetric,
} from '../constants';

/** Dropdown chọn metric (Doanh thu | Đơn hàng). */
export function MetricSelect({
  value,
  onChange,
  id = 'metric',
}: {
  value: ReportMetric;
  onChange: (v: ReportMetric) => void;
  id?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Theo
      </Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as ReportMetric)}>
        {METRIC_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Dropdown chọn mức gom nhóm (Ngày | Tháng | Năm). */
export function GroupBySelect({
  value,
  onChange,
  id = 'group-by',
}: {
  value: ReportGroupBy;
  onChange: (v: ReportGroupBy) => void;
  id?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Gom nhóm
      </Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value as ReportGroupBy)}>
        {GROUP_BY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Dropdown chọn Seller (tùy chọn "Tất cả nhân viên"). */
export function SellerSelect({
  value,
  onChange,
  sellers,
  id = 'seller',
}: {
  value: string;
  onChange: (v: string) => void;
  sellers: { id: string; name: string }[];
  id?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Seller
      </Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Tất cả nhân viên</option>
        {sellers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Chọn Tháng/Năm (native month picker) — cho Hiệu suất Seller (forecast theo tháng). */
export function MonthSelect({
  month,
  year,
  onChange,
  id = 'month',
}: {
  month: number;
  year: number;
  onChange: (month: number, year: number) => void;
  id?: string;
}) {
  const value = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        Tháng
      </Label>
      <Input
        id={id}
        type="month"
        value={value}
        onChange={(e) => {
          const [y, m] = e.target.value.split('-').map(Number);
          if (y && m) onChange(m, y);
        }}
      />
    </div>
  );
}

/** Bộ lọc thời gian dùng chung: quick-range + ngày bắt đầu/kết thúc (tùy chọn). */
export function DateRangeFilter({
  quickRange,
  startDate,
  endDate,
  onQuickRange,
  onStartDate,
  onEndDate,
}: {
  quickRange: QuickRange;
  startDate?: string;
  endDate?: string;
  onQuickRange: (v: QuickRange) => void;
  onStartDate: (v?: string) => void;
  onEndDate: (v?: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="space-y-1.5 sm:w-44">
        <Label htmlFor="range" className="text-xs text-muted-foreground">
          Khoảng thời gian
        </Label>
        <NativeSelect
          id="range"
          value={quickRange}
          onChange={(e) => onQuickRange(e.target.value as QuickRange)}
        >
          {QUICK_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5 sm:w-40">
        <Label htmlFor="range-from" className="text-xs text-muted-foreground">
          Từ ngày
        </Label>
        <Input
          id="range-from"
          type="date"
          value={startDate ?? ''}
          onChange={(e) => onStartDate(e.target.value || undefined)}
        />
      </div>
      <div className="space-y-1.5 sm:w-40">
        <Label htmlFor="range-to" className="text-xs text-muted-foreground">
          Đến ngày
        </Label>
        <Input
          id="range-to"
          type="date"
          value={endDate ?? ''}
          onChange={(e) => onEndDate(e.target.value || undefined)}
        />
      </div>
    </div>
  );
}
