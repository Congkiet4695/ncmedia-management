import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  PodOrder,
  PodOrderListResult,
  PodOrderQuery,
  PodOrderStats,
  PodSyncLogListResult,
  PodSyncLogQuery,
  SyncTriggerResult,
  TriggerSyncPayload,
} from '../order-types';

const BASE_PATH = '/pod/tiktok';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

export const podOrderService = {
  async list(query: PodOrderQuery): Promise<PodOrderListResult> {
    const res = await apiClient.get<ApiResponse<PodOrderListResult>>(`${BASE_PATH}/orders`, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<PodOrder> {
    const res = await apiClient.get<ApiResponse<PodOrder>>(`${BASE_PATH}/orders/${id}`);
    return res.data.data;
  },

  /**
   * Thống kê theo trạng thái.
   *
   * 🔴 Gửi CÙNG bộ tham số lọc với `list()`. Bỏ `page`/`limit`/`sortBy` vì phép đếm không
   * quan tâm — và giữ chúng lại sẽ làm cache key đổi vô ích mỗi lần người dùng sang trang.
   */
  async stats(query: PodOrderQuery = {}): Promise<PodOrderStats> {
    const { page: _page, limit: _limit, sortBy: _sortBy, sortOrder: _sortOrder, ...filters } = query;
    const res = await apiClient.get<ApiResponse<PodOrderStats>>(`${BASE_PATH}/orders/stats`, {
      params: clean(filters as Record<string, unknown>),
    });
    return res.data.data;
  },

  /** Đồng bộ thủ công. Bỏ trống `shopId` = đồng bộ toàn bộ shop của tổ chức. */
  async triggerSync(payload: TriggerSyncPayload = {}): Promise<SyncTriggerResult> {
    const res = await apiClient.post<ApiResponse<SyncTriggerResult>>(
      `${BASE_PATH}/orders/sync`,
      clean(payload as Record<string, unknown>),
    );
    return res.data.data;
  },

  async syncLogs(query: PodSyncLogQuery): Promise<PodSyncLogListResult> {
    const res = await apiClient.get<ApiResponse<PodSyncLogListResult>>(`${BASE_PATH}/sync-logs`, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },
};
