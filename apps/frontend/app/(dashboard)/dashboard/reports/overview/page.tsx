'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { formatCompact, formatMetricValue, useMetricLabel } from '@/features/reports/utils/format';

export default function ReportOverviewPage() {
  const { t } = useTranslation('report');
  return (
    <RequirePermission permission="report.read" message={t('noPermission')}>
      <OverviewView />
    </RequirePermission>
  );
}

function OverviewView() {
  const { t } = useTranslation('report');
  const metricLabel = useMetricLabel();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- metricLabel đổi cùng ngôn ngữ
    [metric, theme.primary],
  );

  return (
    <div className="space-y-6">
      <ReportPageHeader
        title={t('overview.title')}
        description={t('overview.description')}
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
        title={t('byGroup', {
          metric: metricLabel(metric),
          unit: t(
            groupBy === 'day'
              ? 'groupBy.unitDay'
              : groupBy === 'month'
                ? 'groupBy.unitMonth'
                : 'groupBy.unitYear',
          ),
        })}
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
