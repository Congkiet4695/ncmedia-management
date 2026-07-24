'use client';

import { useMemo, useState } from 'react';
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
import { MetricSelect, MonthSelect } from '@/features/reports/components/report-filters';
import { useChartTheme } from '@/features/reports/hooks/use-chart-theme';
import { useSellerPerformance } from '@/features/reports/hooks/use-reports';
import type { ReportMetric } from '@/features/reports/constants';
import { formatCompact, formatMetricValue, metricLabel } from '@/features/reports/utils/format';

/** Nhãn 3 cột theo metric (giống mockup hiệu suất seller 5). */
const SERIES_LABELS: Record<ReportMetric, { target: string; actual: string; forecast: string }> = {
  order: {
    target: 'Đơn hàng cần đạt',
    actual: 'Đơn hàng thực đạt',
    forecast: 'Dự báo đơn cuối tháng',
  },
  revenue: {
    target: 'Doanh thu đề ra',
    actual: 'Doanh thu thực đạt',
    forecast: 'Dự báo doanh thu cuối tháng',
  },
};

export default function ReportSellerPerformancePage() {
  return (
    <RequirePermission permission="report.read" message="Bạn không có quyền xem Báo cáo.">
      <SellerPerformanceView />
    </RequirePermission>
  );
}

function SellerPerformanceView() {
  const now = new Date();
  const [metric, setMetric] = useState<ReportMetric>('revenue');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const theme = useChartTheme();

  const query = useSellerPerformance({ metric, month, year });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const isRevenue = metric === 'revenue';

  // Màu theo mockup: xanh dương (cần đạt), teal (thực đạt), vàng (dự báo).
  const colors = {
    target: theme.primary,
    actual: theme.categorical[4], // aqua/teal
    forecast: theme.categorical[3], // yellow
  };
  const labels = SERIES_LABELS[metric];
  const series = [
    { key: 'target', name: labels.target, color: colors.target },
    { key: 'actual', name: labels.actual, color: colors.actual },
    { key: 'forecast', name: labels.forecast, color: colors.forecast },
  ];

  const data = useMemo(
    () =>
      rows.map((r) => ({
        name: r.sellerName,
        target: isRevenue ? r.targetRevenue : r.targetOrders,
        actual: isRevenue ? r.actualRevenue : r.actualOrders,
        forecast: isRevenue ? r.forecastRevenue : r.forecastOrders,
      })),
    [rows, isRevenue],
  );

  const valueFmt = (v: number) => formatMetricValue(v, metric);
  const tickFmt = (v: number) => formatCompact(v, metric);
  const meta = query.data;

  return (
    <div className="space-y-6">
      <ReportPageHeader
        title="Hiệu suất Seller"
        description="KPI (cần đạt) · Thực đạt · Dự báo cuối tháng theo từng Seller."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <MetricSelect value={metric} onChange={setMetric} />
        <MonthSelect month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y); }} />
        {meta && (
          <p className="text-xs text-muted-foreground sm:pb-2">
            Đã qua {meta.daysElapsed}/{meta.daysInMonth} ngày trong tháng.
          </p>
        )}
      </div>

      <ChartCard
        title={`Hiệu suất ${metricLabel(metric).toLowerCase()} theo Seller`}
        description={isRevenue ? 'Đơn vị: USD ($)' : 'Đơn vị: số đơn'}
        loading={query.isLoading}
        error={query.isError ? query.error : undefined}
        isEmpty={data.length === 0}
        height={400}
      >
        <ReportBarChart
          data={data}
          xKey="name"
          series={series}
          valueFormatter={valueFmt}
          tickFormatter={tickFmt}
          showLabels
        />
      </ChartCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bảng hiệu suất Seller</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>
          ) : query.isError ? (
            <p className="py-10 text-center text-sm text-destructive">Không tải được dữ liệu.</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Chưa có Seller nào.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seller</TableHead>
                    <TableHead className="text-right">{labels.target}</TableHead>
                    <TableHead className="text-right">{labels.actual}</TableHead>
                    <TableHead className="text-right">{labels.forecast}</TableHead>
                    <TableHead className="text-right">% đạt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const target = isRevenue ? r.targetRevenue : r.targetOrders;
                    const actual = isRevenue ? r.actualRevenue : r.actualOrders;
                    const forecast = isRevenue ? r.forecastRevenue : r.forecastOrders;
                    const pct = target > 0 ? Math.round((actual / target) * 100) : null;
                    return (
                      <TableRow key={r.sellerId ?? '__none__'}>
                        <TableCell className="font-medium">{r.sellerName}</TableCell>
                        <TableCell className="text-right tabular-nums">{valueFmt(target)}</TableCell>
                        <TableCell className="text-right tabular-nums">{valueFmt(actual)}</TableCell>
                        <TableCell className="text-right tabular-nums">{valueFmt(forecast)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {pct === null ? '—' : `${pct}%`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
