import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  PodReturn,
  PodReturnFilter,
  PodReturnFilterOptions,
  PodReturnHistory,
  PodReturnListResult,
  PodReturnQuery,
  PodReturnSummary,
  PodReturnSyncResult,
} from './types';

const BASE = '/pod/tiktok/returns';

/** Bỏ tham số rỗng — backend coi `''` là một giá trị lọc. */
function clean<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as Partial<T>;
}

/**
 * Return Orders — mọi lời gọi đi qua backend (backend gọi TikTok, kiểm phạm vi shop). Frontend KHÔNG
 * gọi TikTok và không tự lọc dữ liệu.
 */
export const podReturnService = {
  async list(query: PodReturnQuery): Promise<PodReturnListResult> {
    const res = await apiClient.get<ApiResponse<PodReturnListResult>>(BASE, { params: clean(query) });
    return res.data.data;
  },

  async summary(filter: PodReturnFilter): Promise<PodReturnSummary> {
    const res = await apiClient.get<ApiResponse<PodReturnSummary>>(`${BASE}/summary`, { params: clean(filter) });
    return res.data.data;
  },

  async filterOptions(): Promise<PodReturnFilterOptions> {
    const res = await apiClient.get<ApiResponse<PodReturnFilterOptions>>(`${BASE}/filter-options`);
    return res.data.data;
  },

  async get(id: string): Promise<PodReturn> {
    const res = await apiClient.get<ApiResponse<PodReturn>>(`${BASE}/${id}`);
    return res.data.data;
  },

  async history(id: string): Promise<PodReturnHistory> {
    const res = await apiClient.get<ApiResponse<PodReturnHistory>>(`${BASE}/${id}/history`);
    return res.data.data;
  },

  async sync(shopId?: string): Promise<PodReturnSyncResult> {
    const res = await apiClient.post<ApiResponse<PodReturnSyncResult>>(`${BASE}/sync`, clean({ shopId }));
    return res.data.data;
  },
};
