'use client';

import { useMemo, useState } from 'react';
import { Medal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RequirePermission } from '@/components/require-permission';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportPageHeader } from '@/features/reports/components/report-page-header';
import { ChartCard } from '@/features/reports/components/chart-card';
import { ReportBarChart } from '@/features/reports/components/report-bar-chart';
import { DateRangeFilter, MetricSelect } from '@/features/reports/components/report-filters';
import { useChartTheme } from '@/features/reports/hooks/use-chart-theme';
import { useReportFilters } from '@/features/reports/hooks/use-report-filters';
import { useSellerRanking } from '@/features/reports/hooks/use-reports';
import type { ReportMetric } from '@/features/reports/constants';
import { formatCompact, formatMetricValue, useMetricLabel } from '@/features/reports/utils/format';

const MEDAL_COLOR = ['#eda100', '#9aa0a6', '#cd7f32']; // vàng / bạc / đồng

export default function ReportSellerRankingPage() {
  const { t } = useTranslation('report');
  return (
    <RequirePermission permission="report.read" message={t('noPermission')}>
      <SellerRankingView />
    </RequirePermission>
  );
}

function SellerRankingView() {
  const filters = useReportFilters('month');
  const [metric, setMetric] = useState<ReportMetric>('revenue');
  const { t } = useTranslation('report');
  const metricLabel = useMetricLabel();
  const theme = useChartTheme();
  const query = useSellerRanking({ ...filters.range, metric });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  const chartData = useMemo(
    () => rows.slice(0, 15).map((r) => ({ name: r.sellerName, value: r.value })),
    [rows],
  );
  const valueFmt = (v: number) => formatMetricValue(v, metric);

  return (
    <div className="space-y-6">
      <ReportPageHeader
        title={t('ranking.title')}
        description={t('ranking.description')}
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
        title={t('rankingBy', { metric: metricLabel(metric).toLowerCase() })}
        toolbar={<MetricSelect value={metric} onChange={setMetric} />}
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        isEmpty={rows.length === 0}
        height={Math.max(260, chartData.length * 40)}
      >
        <ReportBarChart
          data={chartData}
          xKey="name"
          layout="vertical"
          series={[{ key: 'value', name: metricLabel(metric), color: theme.primary }]}
          valueFormatter={valueFmt}
          tickFormatter={(v) => formatCompact(v, metric)}
        />
      </ChartCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('ranking.tableTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('loading')}</p>
          ) : query.isError ? (
            <p className="py-10 text-center text-sm text-destructive">{t('loadFailedShort')}</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('noDataShort')}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">{t('ranking.rank')}</TableHead>
                    <TableHead>Seller</TableHead>
                    <TableHead className="text-right">{metricLabel(metric)}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.sellerId ?? '__none__'}>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
                          {r.rank <= 3 ? (
                            <Medal className="size-4" style={{ color: MEDAL_COLOR[r.rank - 1] }} />
                          ) : (
                            <span className="w-4 text-center text-muted-foreground">{r.rank}</span>
                          )}
                          {r.rank <= 3 ? r.rank : null}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{r.sellerName}</TableCell>
                      <TableCell className="text-right tabular-nums">{valueFmt(r.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
