import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  PodProductDetail,
  PodProductFilterOptions,
  PodProductListResult,
  PodProductQuery,
  PodProductSyncHistoryResult,
  PodProductSyncPayload,
  PodProductSyncResult,
} from '../types';

const BASE_PATH = '/pod/products';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<T>;
}

/**
 * Gọi API module Product.
 *
 * 🔴 Sprint 2 chỉ có ĐỌC + ĐỒNG BỘ: không có `create`/`update`/`delete`/`publish`.
 * Sản phẩm là bản sao từ TikTok — mọi thay đổi phải thực hiện trên Seller Center.
 */
export const podProductService = {
  async list(query: PodProductQuery): Promise<PodProductListResult> {
    const res = await apiClient.get<ApiResponse<PodProductListResult>>(BASE_PATH, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<PodProductDetail> {
    const res = await apiClient.get<ApiResponse<PodProductDetail>>(`${BASE_PATH}/${id}`);
    return res.data.data;
  },

  async filters(): Promise<PodProductFilterOptions> {
    const res = await apiClient.get<ApiResponse<PodProductFilterOptions>>(`${BASE_PATH}/filters`);
    return res.data.data;
  },

  /** Sync Now — đồng bộ tăng dần, hoặc toàn bộ khi `full = true`. */
  async sync(payload: PodProductSyncPayload = {}): Promise<PodProductSyncResult> {
    const res = await apiClient.post<ApiResponse<PodProductSyncResult>>(
      `${BASE_PATH}/sync`,
      clean(payload as Record<string, unknown>),
    );
    return res.data.data;
  },

  /** Đồng bộ lại đúng một sản phẩm (màn hình chi tiết). */
  async resync(id: string): Promise<PodProductDetail> {
    const res = await apiClient.post<ApiResponse<PodProductDetail>>(`${BASE_PATH}/${id}/sync`);
    return res.data.data;
  },

  async syncHistory(params: {
    page?: number;
    limit?: number;
    shopId?: string;
  }): Promise<PodProductSyncHistoryResult> {
    const res = await apiClient.get<ApiResponse<PodProductSyncHistoryResult>>(
      `${BASE_PATH}/sync-history`,
      { params: clean(params as Record<string, unknown>) },
    );
    return res.data.data;
  },
};
