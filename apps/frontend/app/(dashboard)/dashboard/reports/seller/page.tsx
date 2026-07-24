'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { ReportPageHeader } from '@/features/reports/components/report-page-header';
import { ChartCard } from '@/features/reports/components/chart-card';
import { ReportBarChart } from '@/features/reports/components/report-bar-chart';
import { DateRangeFilter, MetricSelect } from '@/features/reports/components/report-filters';
import { useChartTheme } from '@/features/reports/hooks/use-chart-theme';
import { useReportFilters } from '@/features/reports/hooks/use-report-filters';
import { useSellerChart } from '@/features/reports/hooks/use-reports';
import type { ReportMetric } from '@/features/reports/constants';
import { formatCompact, formatMetricValue, metricLabel } from '@/features/reports/utils/format';

export default function ReportSellerPage() {
  return (
    <RequirePermission permission="report.read" message="Bạn không có quyền xem Báo cáo.">
      <SellerView />
    </RequirePermission>
  );
}

function SellerView() {
  const filters = useReportFilters('month');
  const [metric, setMetric] = useState<ReportMetric>('revenue');
  const theme = useChartTheme();

  const query = useSellerChart({ ...filters.range, metric });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const data = useMemo(() => rows.map((r) => ({ name: r.sellerName, value: r.value })), [rows]);

  const valueFmt = (v: number) => formatMetricValue(v, metric);
  const tickFmt = (v: number) => formatCompact(v, metric);

  return (
    <div className="space-y-6">
      <ReportPageHeader
        title="Doanh thu / Đơn Seller"
        description="Tổng doanh thu hoặc số đơn theo từng Seller trong khoảng thời gian đã chọn."
      />

      <DateRangeFilter
        quickRange={filters.quickRange}
        startDate={filters.startDate}
        endDate={filters.endDate}
        onQuickRange={filters.selectQuickRange}
        onStartDate={filters.setStartDate}
        onEndDate={filters.setEndDate}
      />

      <ChartCard
        title={`${metricLabel(metric)} theo Seller`}
        description={metric === 'revenue' ? 'Đơn vị: USD ($)' : 'Đơn vị: số đơn'}
        toolbar={<MetricSelect value={metric} onChange={setMetric} />}
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        isEmpty={data.length === 0}
        height={Math.max(360, 120 + data.length * 8)}
      >
        <ReportBarChart
          data={data}
          xKey="name"
          series={[{ key: 'value', name: metricLabel(metric), color: theme.primary }]}
          valueFormatter={valueFmt}
          tickFormatter={tickFmt}
          showLabels
        />
      </ChartCard>
    </div>
  );
}
