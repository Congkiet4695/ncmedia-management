'use client';

import { useMemo } from 'react';
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
import { DateRangeFilter } from '@/features/reports/components/report-filters';
import { useChartTheme } from '@/features/reports/hooks/use-chart-theme';
import { useReportFilters } from '@/features/reports/hooks/use-report-filters';
import { useWarehousePerformance } from '@/features/reports/hooks/use-reports';
import { WAREHOUSE_STATUS_STYLE } from '@/features/reports/constants';
import { formatCompact } from '@/features/reports/utils/format';
import { formatUSD } from '@/lib/format';

/** Thứ tự cột trong biểu đồ trạng thái — nhãn dịch tại chỗ render. */
const STATUS_KEYS = ['notProcessed', 'processing', 'cancelled', 'completed'] as const;

export default function ReportWarehousePerformancePage() {
  const { t } = useTranslation('report');
  return (
    <RequirePermission permission="report.read" message={t('noPermission')}>
      <WarehouseView />
    </RequirePermission>
  );
}

function WarehouseView() {
  const { t } = useTranslation('report');
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
        title={t('warehouse.title')}
        description={t('warehouse.description')}
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
          title={t('warehouse.statusChart')}
          loading={query.isLoading}
          error={query.isError ? query.error : undefined}
          isEmpty={isEmpty}
          height={320}
        >
          <ReportBarChart
            data={statusData}
            xKey="name"
            series={STATUS_KEYS.map((key) => ({
              key,
              name: t(WAREHOUSE_STATUS_STYLE[key].labelKey),
              color: WAREHOUSE_STATUS_STYLE[key].color,
            }))}
            valueFormatter={(v) => String(Math.round(v))}
            tickFormatter={(v) => String(Math.round(v))}
          />
        </ChartCard>

        <ChartCard
          title={t('warehouse.balance')}
          description={t('warehouse.balanceDescription')}
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
          <CardTitle className="text-lg">{t('warehouse.tableTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t('loading')}</p>
          ) : query.isError ? (
            <p className="py-10 text-center text-sm text-destructive">{t('loadFailedShort')}</p>
          ) : isEmpty ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('warehouse.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('warehouse.staff')}</TableHead>
                    <TableHead className="text-right">{t('warehouse.totalOrders')}</TableHead>
                    <TableHead className="text-right">
                      {t('warehouseStatus.notProcessed')}
                    </TableHead>
                    <TableHead className="text-right">{t('warehouseStatus.processing')}</TableHead>
                    <TableHead className="text-right">{t('warehouseStatus.cancelled')}</TableHead>
                    <TableHead className="text-right">{t('warehouseStatus.completed')}</TableHead>
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
