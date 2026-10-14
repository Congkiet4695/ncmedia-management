'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  useDashboardFilterOptions,
  useDashboardOverview,
  useDashboardSummary,
  useDashboardTrends,
} from '../hooks/use-dashboard';
import type { DashboardDatePreset, DashboardRange } from '../types';
import { currentMonthRange, presetRange } from '../utils';
import { DashboardFilterBar } from './dashboard-filter-bar';
import { FinanceOrderSummary } from './finance-order-summary';
import { HoldBySellerCard, HoldCard, ShopStatusCard } from './overview-cards';
import { PeriodCards } from './period-cards';
import { SellerStatsTable } from './seller-stats-table';
import { TrendChartCard } from './trend-chart-card';

/**
 * Dashboard quản trị POD — bố cục theo ảnh tham chiếu (docs/dashboard):
 *   Hold · Trạng thái shop · Hold theo nhân sự
 *   Đơn theo kỳ (Hôm nay / Hôm qua / Tháng này / Tháng trước) · Tài chính + Đơn hàng
 *   Thống kê seller
 *   Biểu đồ xu hướng (Tài chính / Đơn hàng)
 *
 * Admin (`report.read`) và Seller (`pod.dashboard.read`) dùng CHUNG màn hình + API này; phạm vi
 * dữ liệu do backend giới hạn (Seller chỉ thấy TikTok Account được gán) — không lọc ở frontend.
 * Mỗi widget có query riêng ⇒ một widget lỗi không làm trắng cả màn hình.
 */
export function AdminDashboard() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('report.read') || hasPermission('pod.dashboard.read');

  const options = useDashboardFilterOptions(canView);
  const [filters, setFilters] = useState<Omit<DashboardRange, 'from' | 'to'>>({});
  const overview = useDashboardOverview(filters, canView);
  /** Bộ lọc thời gian: lựa chọn nhanh + khoảng ngày nó điền ("ALL" ⇒ hai ngày trống, gửi `allTime`). */
  const [period, setPeriod] = useState<{ preset: DashboardDatePreset; from: string; to: string } | null>(null);
  const offsetMinutes = overview.data?.timezoneOffsetMinutes;

  // Khoảng ngày mặc định ("Tháng này") cần múi giờ vận hành ⇒ dựng khi overview đã về.
  useEffect(() => {
    if (!period && offsetMinutes !== undefined) {
      setPeriod({ preset: 'THIS_MONTH', ...currentMonthRange(offsetMinutes) });
    }
  }, [period, offsetMinutes]);

  // Đơn vị tiền mặc định = đơn vị phổ biến nhất (backend sắp sẵn) — để ô chọn hiển thị đúng giá trị.
  useEffect(() => {
    const first = options.data?.currencies[0];
    if (!filters.currency && first) setFilters((current) => ({ ...current, currency: first }));
  }, [filters.currency, options.data]);

  // MỘT object khoảng cho cả ba widget theo ngày ⇒ đổi lựa chọn là cả ba đổi CÙNG lúc, mỗi widget đúng một request.
  const range = useMemo<DashboardRange | null>(() => {
    if (!period) return null;
    return period.preset === 'ALL'
      ? { ...filters, from: '', to: '', allTime: true }
      : { ...filters, from: period.from, to: period.to };
  }, [period, filters]);
  const rangeReady = canView && range !== null;
  const summary = useDashboardSummary(range ?? { from: '', to: '' }, rangeReady);
  const trends = useDashboardTrends(range ?? { from: '', to: '' }, rangeReady);

  if (!canView) return null;

  const overviewState = {
    data: overview.data,
    loading: overview.isLoading,
    error: overview.isError ? overview.error : undefined,
    onRetry: () => void overview.refetch(),
  };

  return (
    <section className="space-y-4">
      {range && (
        <DashboardFilterBar
          value={range}
          preset={period?.preset ?? 'THIS_MONTH'}
          options={options.data}
          onPresetChange={(preset) =>
            setPeriod(
              preset === 'ALL'
                ? { preset, from: '', to: '' }
                : { preset, ...presetRange(preset, offsetMinutes ?? 0) },
            )
          }
          onChange={(next) => {
            const { from, to, allTime: _allTime, ...rest } = next;
            // Sửa tay Từ ngày / Đến ngày ⇒ "Tuỳ chỉnh"; đổi tiền / shop / seller giữ nguyên lựa chọn thời gian.
            if (period && (from !== period.from || to !== period.to)) setPeriod({ preset: 'CUSTOM', from, to });
            setFilters(rest);
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <HoldCard {...overviewState} filters={filters} />
        <ShopStatusCard {...overviewState} filters={filters} />
        <HoldBySellerCard {...overviewState} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <PeriodCards {...overviewState} />
        <FinanceOrderSummary
          data={summary.data}
          loading={!range || summary.isLoading}
          error={summary.isError ? summary.error : undefined}
          onRetry={() => void summary.refetch()}
        />
      </div>

      {range && <SellerStatsTable range={range} enabled={rangeReady} />}

      <TrendChartCard
        data={trends.data}
        loading={!range || trends.isLoading}
        error={trends.isError ? trends.error : undefined}
        onRetry={() => void trends.refetch()}
      />
    </section>
  );
}
