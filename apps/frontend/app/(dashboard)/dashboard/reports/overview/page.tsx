'use client';

import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/require-permission';
import { ReportPageHeader } from '@/features/reports/components/report-page-header';
import { ChartCard } from '@/features/reports/components/chart-card';
import { ReportLineChart } from '@/features/reports/components/report-line-chart';
import {
  DateRangeFilter,
  GroupBySelect,
  MetricSelect,
} from '@/features/reports/components/report-filters';
import { useChartTheme } from '@/features/reports/hooks/use-chart-theme';
import { useReportFilters } from '@/features/reports/hooks/use-report-filters';
import { useOverview } from '@/features/reports/hooks/use-reports';
import type { ReportGroupBy, ReportMetric } from '@/features/reports/constants';
import { formatBucketLabel } from '@/features/reports/utils/date-range';
import { formatCompact, formatMetricValue, metricLabel } from '@/features/reports/utils/format';

export default function ReportOverviewPage() {
  return (
    <RequirePermission permission="report.read" message="Bạn không có quyền xem Báo cáo.">
      <OverviewView />
    </RequirePermission>
  );
}

function OverviewView() {
  const filters = useReportFilters('month');
  const [metric, setMetric] = useState<ReportMetric>('revenue');
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('day');
  const theme = useChartTheme();

  const query = useOverview({ ...filters.range, metric, groupBy });
  const points = useMemo(
    () => (query.data?.points ?? []).map((p) => ({ bucket: p.bucket, value: p.value })),
    [query.data],
  );

  const series = useMemo(
    () => [{ key: 'value', name: metricLabel(metric), color: theme.primary }],
    [metric, theme.primary],
  );

  return (
    <div className="space-y-6">
      <ReportPageHeader
        title="Tổng quan"
        description="Biểu đồ doanh thu / đơn hàng theo thời gian."
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
        title={`${metricLabel(metric)} theo ${groupBy === 'day' ? 'ngày' : groupBy === 'month' ? 'tháng' : 'năm'}`}
        toolbar={
          <>
            <MetricSelect value={metric} onChange={setMetric} />
            <GroupBySelect value={groupBy} onChange={setGroupBy} />
          </>
        }
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        isEmpty={points.length === 0}
        height={360}
      >
        <ReportLineChart
          data={points}
          xKey="bucket"
          series={series}
          valueFormatter={(v) => formatMetricValue(v, metric)}
          tickFormatter={(v) => formatCompact(v, metric)}
          xTickFormatter={(b) => formatBucketLabel(b, groupBy)}
          labelFormatter={(b) => formatBucketLabel(b, groupBy)}
        />
      </ChartCard>
    </div>
  );
}
