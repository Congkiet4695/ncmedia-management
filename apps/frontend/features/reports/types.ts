import type { ReportGroupBy, ReportMetric } from './constants';

/** Bộ lọc thời gian dùng chung (Dashboard + Reports). */
export interface DateRangeParams {
  startDate?: string;
  endDate?: string;
}
export interface MetricParams extends DateRangeParams {
  metric?: ReportMetric;
}
export interface TimeSeriesParams extends MetricParams {
  groupBy?: ReportGroupBy;
}
export interface SellerTimeSeriesParams extends TimeSeriesParams {
  sellerId?: string;
}
export interface SellerPerformanceParams {
  metric?: ReportMetric;
  month?: number;
  year?: number;
}

export interface DashboardSummary {
  totalOrders: number;
  totalRevenue: number;
  currency: string;
}

export interface TimeSeriesPoint {
  bucket: string;
  value: number;
}

export interface OverviewSeries {
  metric: ReportMetric;
  groupBy: ReportGroupBy;
  points: TimeSeriesPoint[];
}

export interface SellerSeries {
  sellerId: string | null;
  sellerName: string;
  points: TimeSeriesPoint[];
  total: number;
}
export interface SellerReport {
  metric: ReportMetric;
  groupBy: ReportGroupBy;
  sellers: SellerSeries[];
}

export interface SellerChartRow {
  sellerId: string | null;
  sellerName: string;
  value: number;
}
export interface SellerChart {
  metric: ReportMetric;
  rows: SellerChartRow[];
}

export interface SellerPerformanceRow {
  sellerId: string | null;
  sellerName: string;
  targetOrders: number;
  actualOrders: number;
  forecastOrders: number;
  targetRevenue: number;
  actualRevenue: number;
  forecastRevenue: number;
}
export interface SellerPerformance {
  metric: ReportMetric;
  month: number;
  year: number;
  daysElapsed: number;
  daysInMonth: number;
  rows: SellerPerformanceRow[];
}

export interface WarehousePerformanceRow {
  userId: string;
  userName: string;
  totalOrders: number;
  notProcessed: number;
  processing: number;
  cancelled: number;
  completed: number;
  revenue: number;
}
export interface WarehousePerformance {
  rows: WarehousePerformanceRow[];
}

export interface SellerRankingRow {
  rank: number;
  sellerId: string | null;
  sellerName: string;
  value: number;
}
export interface SellerRanking {
  metric: ReportMetric;
  rows: SellerRankingRow[];
}
