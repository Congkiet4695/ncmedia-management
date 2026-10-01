import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  DashboardFilterOptions,
  DashboardFilters,
  DashboardOverview,
  DashboardRange,
  DashboardSellerPage,
  DashboardSellerQuery,
  DashboardSummary,
  DashboardTrends,
} from '../types';

const BASE_PATH = '/pod/dashboard';

/** Bỏ tham số rỗng — backend coi "không gửi" là "không lọc". */
function params<T extends object>(query: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/** API Dashboard quản trị — mọi số liệu tổng hợp ở backend (SQL), giao diện chỉ hiển thị. */
export const dashboardService = {
  async filters(): Promise<DashboardFilterOptions> {
    const res = await apiClient.get<ApiResponse<DashboardFilterOptions>>(`${BASE_PATH}/filters`);
    return res.data.data;
  },
  async overview(query: DashboardFilters): Promise<DashboardOverview> {
    const res = await apiClient.get<ApiResponse<DashboardOverview>>(`${BASE_PATH}/overview`, {
      params: params(query),
    });
    return res.data.data;
  },
  async summary(query: DashboardRange): Promise<DashboardSummary> {
    const res = await apiClient.get<ApiResponse<DashboardSummary>>(`${BASE_PATH}/summary`, {
      params: params(query),
    });
    return res.data.data;
  },
  async sellers(query: DashboardSellerQuery): Promise<DashboardSellerPage> {
    const res = await apiClient.get<ApiResponse<DashboardSellerPage>>(`${BASE_PATH}/sellers`, {
      params: params(query),
    });
    return res.data.data;
  },
  async trends(query: DashboardRange): Promise<DashboardTrends> {
    const res = await apiClient.get<ApiResponse<DashboardTrends>>(`${BASE_PATH}/trends`, {
      params: params(query),
    });
    return res.data.data;
  },
};
