'use client';

import { useMemo } from 'react';
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
import { DateRangeFilter } from '@/features/reports/components/report-filters';
import { useChartTheme } from '@/features/reports/hooks/use-chart-theme';
import { useReportFilters } from '@/features/reports/hooks/use-report-filters';
import { useWarehousePerformance } from '@/features/reports/hooks/use-reports';
import { WAREHOUSE_STATUS_STYLE } from '@/features/reports/constants';
import { formatCompact } from '@/features/reports/utils/format';
import { formatUSD } from '@/lib/format';

const STATUS_SERIES = [
  { key: 'notProcessed', name: WAREHOUSE_STATUS_STYLE.notProcessed.label, color: WAREHOUSE_STATUS_STYLE.notProcessed.color },
  { key: 'processing', name: WAREHOUSE_STATUS_STYLE.processing.label, color: WAREHOUSE_STATUS_STYLE.processing.color },
  { key: 'cancelled', name: WAREHOUSE_STATUS_STYLE.cancelled.label, color: WAREHOUSE_STATUS_STYLE.cancelled.color },
  { key: 'completed', name: WAREHOUSE_STATUS_STYLE.completed.label, color: WAREHOUSE_STATUS_STYLE.completed.color },
];

export default function ReportWarehousePerformancePage() {
  return (
    <RequirePermission permission="report.read" message="Bạn không có quyền xem Báo cáo.">
      <WarehouseView />
    </RequirePermission>
  );
}

function WarehouseView() {
  const filters = useReportFilters('month');
  const theme = useChartTheme();
  const query = useWarehousePerformance(filters.range);
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);

  const statusData = useMemo(
    () =>
      rows.map((r) => ({
        name: r.userName,
        notProcessed: r.notProcessed,
        processing: r.processing,
        cancelled: r.cancelled,
        completed: r.completed,
      })),
    [rows],
  );
  const balanceData = useMemo(
    () => rows.map((r) => ({ name: r.userName, revenue: r.revenue })),
    [rows],
  );
  const isEmpty = rows.length === 0;

  return (
    <div className="space-y-6">
      <ReportPageHeader
        title="Hiệu suất Kho"
        description="Thống kê xử lý đơn theo từng nhân viên Fulfillment."
      />

      <DateRangeFilter
        quickRange={filters.quickRange}
        startDate={filters.startDate}
        endDate={filters.endDate}
        onQuickRange={filters.selectQuickRange}
        onStartDate={filters.setStartDate}
        onEndDate={filters.setEndDate}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Tình trạng xử lí đơn hàng"
          loading={query.isLoading}
          error={query.isError ? query.error : undefined}
          isEmpty={isEmpty}
          height={320}
        >
          <ReportBarChart
            data={statusData}
            xKey="name"
            series={STATUS_SERIES}
            valueFormatter={(v) => String(Math.round(v))}
            tickFormatter={(v) => String(Math.round(v))}
          />
        </ChartCard>

        <ChartCard
          title="Balance làm được"
          description="Doanh thu các đơn phụ trách."
          loading={query.isLoading}
          error={query.isError ? query.error : undefined}
          isEmpty={isEmpty}
          height={320}
        >
          <ReportBarChart
            data={balanceData}
            xKey="name"
            series={[{ key: 'revenue', name: 'Balance', color: theme.primary }]}
            valueFormatter={formatUSD}
            tickFormatter={(v) => formatCompact(v, 'revenue')}
          />
        </ChartCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bảng hiệu suất Kho</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Đang tải…</p>
          ) : query.isError ? (
            <p className="py-10 text-center text-sm text-destructive">Không tải được dữ liệu.</p>
          ) : isEmpty ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Chưa có đơn nào được nhận xử lý trong khoảng thời gian này.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nhân viên Kho</TableHead>
                    <TableHead className="text-right">Tổng đơn</TableHead>
                    <TableHead className="text-right">Chưa xử lí</TableHead>
                    <TableHead className="text-right">Đang xử lí</TableHead>
                    <TableHead className="text-right">Đơn hủy</TableHead>
                    <TableHead className="text-right">Hoàn tất</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.userId}>
                      <TableCell className="font-medium">{r.userName}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.totalOrders}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.notProcessed}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.processing}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.cancelled}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.completed}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUSD(r.revenue)}</TableCell>
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
