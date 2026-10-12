'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { dashboardService } from '../services/dashboard.service';
import type {
  DashboardFilters,
  DashboardPageQuery,
  DashboardRange,
  DashboardSellerQuery,
  DashboardShopStatus,
} from '../types';

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

/** Chỉ gọi khi popup MỞ (`enabled`) — không tải danh sách khi chỉ render Dashboard. */
export function useDashboardHoldShops(query: DashboardPageQuery, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'hold-shops', query],
    queryFn: () => dashboardService.holdShops(query),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardShops(query: DashboardPageQuery & { status: DashboardShopStatus }, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, 'shops', query],
    queryFn: () => dashboardService.shops(query),
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
