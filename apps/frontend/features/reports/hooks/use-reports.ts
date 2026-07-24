'use client';

import { useQuery } from '@tanstack/react-query';
import { reportService } from '../services/report.service';
import type {
  DateRangeParams,
  MetricParams,
  SellerPerformanceParams,
  SellerTimeSeriesParams,
  TimeSeriesParams,
} from '../types';

const KEY = 'reports';
const STALE = 60 * 1000;

export function useDashboardSummary(params: DateRangeParams, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'dashboard-summary', params],
    queryFn: () => reportService.dashboardSummary(params),
    staleTime: STALE,
    enabled,
  });
}

export function useOverview(params: TimeSeriesParams) {
  return useQuery({
    queryKey: [KEY, 'overview', params],
    queryFn: () => reportService.overview(params),
    staleTime: STALE,
  });
}

export function useSellerReport(params: SellerTimeSeriesParams) {
  return useQuery({
    queryKey: [KEY, 'seller', params],
    queryFn: () => reportService.seller(params),
    staleTime: STALE,
  });
}

export function useSellerChart(params: MetricParams) {
  return useQuery({
    queryKey: [KEY, 'seller-chart', params],
    queryFn: () => reportService.sellerChart(params),
    staleTime: STALE,
  });
}

export function useSellerPerformance(params: SellerPerformanceParams) {
  return useQuery({
    queryKey: [KEY, 'seller-performance', params],
    queryFn: () => reportService.sellerPerformance(params),
    staleTime: STALE,
  });
}

export function useWarehousePerformance(params: DateRangeParams) {
  return useQuery({
    queryKey: [KEY, 'warehouse-performance', params],
    queryFn: () => reportService.warehousePerformance(params),
    staleTime: STALE,
  });
}

export function useSellerRanking(params: MetricParams) {
  return useQuery({
    queryKey: [KEY, 'seller-ranking', params],
    queryFn: () => reportService.sellerRanking(params),
    staleTime: STALE,
  });
}
