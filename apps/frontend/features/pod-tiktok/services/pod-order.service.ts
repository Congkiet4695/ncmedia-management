import { env } from '@/lib/env';
import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  SelectedOrdersSyncResult,
  PodOrder,
  PodOrderListResult,
  PodOrderQuery,
  PodOrderStats,
  PodShopSyncStatus,
  PodShopSyncType,
  SyncTriggerResult,
  TriggerSyncPayload,
} from '../order-types';

const BASE_PATH = '/pod/tiktok';

const SYNC_STATUS_PATH: Record<PodShopSyncType, string> = {
  ORDER: `${BASE_PATH}/sync-status`,
  PRODUCT: '/pod/products/sync-status',
  RETURN: `${BASE_PATH}/returns/sync-status`,
};

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

export const podOrderService = {
  /** Cập nhật Design Amount (USD, ≥ 0) — backend tính lại lợi nhuận và trả đơn đã cập nhật. */
  async updateDesignAmount(id: string, designAmount: number): Promise<PodOrder> {
    const res = await apiClient.patch<ApiResponse<PodOrder>>(`${BASE_PATH}/orders/${id}/design-amount`, {
      designAmount,
    });
    return res.data.data;
  },

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
    const {
      page: _page,
      limit: _limit,
      sortBy: _sortBy,
      sortOrder: _sortOrder,
      ...filters
    } = query;
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

  /**
   * **Sync Orders** cho các đơn đang chọn — backend kéo lại từng đơn từ TikTok (Get Order Detail),
   * kiểm tổ chức + phạm vi shop, chạy có trần song song, trả kết quả TỪNG đơn (thành công một phần).
   *
   * Timeout riêng (`env.syncTimeoutMs`) thay vì 15s mặc định: một lượt có thể chạm nhiều shop, mỗi
   * shop là lời gọi TikTok có retry/backoff; backend tự dừng nhận shop mới trước mốc này.
   */
  async syncSelected(orderIds: string[]): Promise<SelectedOrdersSyncResult> {
    const res = await apiClient.post<ApiResponse<SelectedOrdersSyncResult>>(
      `${BASE_PATH}/orders/sync-selected`,
      { orderIds },
      { timeout: env.syncTimeoutMs },
    );
    return res.data.data;
  },

  /**
   * Latest Sync Status — tối đa MỘT dòng mỗi shop (trong phạm vi người dùng), nên không phân trang.
   * Đơn và sản phẩm dùng chung một dạng dữ liệu, khác endpoint (khác quyền đọc).
   */
  async syncStatus(syncType: PodShopSyncType, shopId?: string): Promise<PodShopSyncStatus[]> {
    const res = await apiClient.get<ApiResponse<{ items: PodShopSyncStatus[] }>>(
      SYNC_STATUS_PATH[syncType],
      { params: clean({ shopId }) },
    );
    return res.data.data.items;
  },
};
