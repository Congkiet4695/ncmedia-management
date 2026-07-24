import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  DashboardSummary,
  DateRangeParams,
  MetricParams,
  OverviewSeries,
  SellerChart,
  SellerPerformance,
  SellerPerformanceParams,
  SellerRanking,
  SellerReport,
  SellerTimeSeriesParams,
  TimeSeriesParams,
  WarehousePerformance,
} from '../types';

/** Bỏ field rỗng/undefined khỏi query params. */
function clean(obj: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  );
}

async function get<T>(url: string, params: object): Promise<T> {
  const res = await apiClient.get<ApiResponse<T>>(url, { params: clean(params) });
  return res.data.data;
}

export const reportService = {
  dashboardSummary: (p: DateRangeParams) =>
    get<DashboardSummary>('/reports/dashboard-summary', p),
  overview: (p: TimeSeriesParams) => get<OverviewSeries>('/reports/overview', p),
  seller: (p: SellerTimeSeriesParams) => get<SellerReport>('/reports/seller', p),
  sellerChart: (p: MetricParams) => get<SellerChart>('/reports/seller-chart', p),
  sellerPerformance: (p: SellerPerformanceParams) =>
    get<SellerPerformance>('/reports/seller-performance', p),
  warehousePerformance: (p: DateRangeParams) =>
    get<WarehousePerformance>('/reports/warehouse-performance', p),
  sellerRanking: (p: MetricParams) => get<SellerRanking>('/reports/seller-ranking', p),
};
