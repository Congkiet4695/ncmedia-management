'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboard.service';
import type { DashboardFilters, DashboardRange, DashboardSellerQuery } from '../types';

const KEY = 'pod-dashboard';

/**
 * Mỗi widget là MỘT query riêng: widget lỗi chỉ hiện lỗi của nó, không làm trắng cả Dashboard.
 * `keepPreviousData`: đổi bộ lọc không làm widget nhấp nháy về trạng thái rỗng.
 */
export function useDashboardFilterOptions(enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'filters'],
    queryFn: () => dashboardService.filters(),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDashboardOverview(filters: DashboardFilters, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'overview', filters],
    queryFn: () => dashboardService.overview(filters),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardSummary(range: DashboardRange, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'summary', range],
    queryFn: () => dashboardService.summary(range),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardSellers(query: DashboardSellerQuery, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'sellers', query],
    queryFn: () => dashboardService.sellers(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardTrends(range: DashboardRange, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'trends', range],
    queryFn: () => dashboardService.trends(range),
    enabled,
    placeholderData: keepPreviousData,
  });
}
