import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type { PodProductCloneBatch, PodProductCloneListResult, PodProductCloneQuery } from '../types';

const BASE_PATH = '/pod/product-clones';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/**
 * Clone Products / Clone History — đọc lượt nhân bản và chạy lại shop FAILED.
 *
 * Tạo lượt vẫn qua `podProductService.clone(id, payload)`; mỗi lượt là một Listing Job
 * `type = CLONE` ở backend, màn hình này chỉ là góc nhìn "theo sản phẩm nguồn → từng shop đích".
 */
export const podProductCloneService = {
  async list(query: PodProductCloneQuery): Promise<PodProductCloneListResult> {
    const res = await apiClient.get<ApiResponse<PodProductCloneListResult>>(BASE_PATH, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<PodProductCloneBatch> {
    const res = await apiClient.get<ApiResponse<PodProductCloneBatch>>(`${BASE_PATH}/${id}`);
    return res.data.data;
  },

  /** Chạy lại MỌI shop FAILED của lượt (SUCCESS / SKIPPED không bị đụng). */
  async retryFailed(id: string): Promise<PodProductCloneBatch> {
    const res = await apiClient.post<ApiResponse<PodProductCloneBatch>>(`${BASE_PATH}/${id}/retry`);
    return res.data.data;
  },

  /** Chạy lại MỘT shop FAILED. */
  async retryItem(id: string, itemId: string): Promise<PodProductCloneBatch> {
    const res = await apiClient.post<ApiResponse<PodProductCloneBatch>>(`${BASE_PATH}/${id}/items/${itemId}/retry`);
    return res.data.data;
  },
};
