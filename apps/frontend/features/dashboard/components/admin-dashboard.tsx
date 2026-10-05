'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import {
  useDashboardFilterOptions,
  useDashboardOverview,
  useDashboardSummary,
  useDashboardTrends,
} from '../hooks/use-dashboard';
import type { DashboardRange } from '../types';
import { currentMonthRange } from '../utils';
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
  const [days, setDays] = useState<{ from: string; to: string } | null>(null);

  // Khoảng ngày mặc định cần múi giờ vận hành ⇒ dựng khi overview đã về.
  useEffect(() => {
    if (!days && overview.data) setDays(currentMonthRange(overview.data.timezoneOffsetMinutes));
  }, [days, overview.data]);

  // Đơn vị tiền mặc định = đơn vị phổ biến nhất (backend sắp sẵn) — để ô chọn hiển thị đúng giá trị.
  useEffect(() => {
    const first = options.data?.currencies[0];
    if (!filters.currency && first) setFilters((current) => ({ ...current, currency: first }));
  }, [filters.currency, options.data]);

  const range = useMemo<DashboardRange | null>(() => (days ? { ...filters, ...days } : null), [days, filters]);
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
          options={options.data}
          onChange={(next) => {
            const { from, to, ...rest } = next;
            setDays({ from, to });
            setFilters(rest);
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <HoldCard {...overviewState} />
        <ShopStatusCard {...overviewState} />
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
