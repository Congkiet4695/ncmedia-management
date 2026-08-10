'use client';

import { DollarSign, ShoppingCart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/use-auth';
import { formatUSD } from '@/lib/format';
import { DateRangeFilter } from '@/features/reports/components/report-filters';
import { StatCard } from '@/features/reports/components/stat-card';
import { useReportFilters } from '@/features/reports/hooks/use-report-filters';
import { useDashboardSummary } from '@/features/reports/hooks/use-reports';

/**
 * DashboardSummary — thẻ KPI (Tổng Đơn hàng + Tổng Doanh thu) + bộ lọc thời gian dùng chung.
 * Mặc định: Hôm nay. Chỉ hiển thị với người có quyền `report.read`.
 */
export function DashboardSummary() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const canView = hasPermission('report.read');
  const filters = useReportFilters('today');
  const query = useDashboardSummary(filters.range, canView);

  if (!canView) return null;

  const data = query.data;
  const errored = query.isError;

  return (
    <section className="space-y-4">
      <DateRangeFilter
        quickRange={filters.quickRange}
        startDate={filters.startDate}
        endDate={filters.endDate}
        onQuickRange={filters.selectQuickRange}
        onStartDate={filters.setStartDate}
        onEndDate={filters.setEndDate}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label={t('dashboard.totalOrders')}
          icon={ShoppingCart}
          loading={query.isLoading}
          value={errored ? '—' : String(data?.totalOrders ?? 0)}
        />
        <StatCard
          label={t('dashboard.totalRevenue')}
          icon={DollarSign}
          loading={query.isLoading}
          value={errored ? '—' : formatUSD(data?.totalRevenue ?? 0)}
        />
      </div>
    </section>
  );
}
