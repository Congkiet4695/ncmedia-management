import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  PodDesign,
  PodDesignPlacement,
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

  async stats(): Promise<PodOrderStats> {
    const res = await apiClient.get<ApiResponse<PodOrderStats>>(`${BASE_PATH}/orders/stats`);
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
  // --- Design in cho từng sản phẩm ---

  async listDesigns(orderItemId: string): Promise<PodDesign[]> {
    const res = await apiClient.get<ApiResponse<PodDesign[]>>(
      `${BASE_PATH}/order-items/${orderItemId}/designs`,
    );
    return res.data.data;
  },

  /**
   * Upload / thay thế design tại một vị trí in.
   * Dùng multipart — KHÔNG đặt Content-Type thủ công để axios tự thêm boundary.
   */
  async uploadDesign(
    orderItemId: string,
    placement: PodDesignPlacement,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<PodDesign> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiClient.post<ApiResponse<PodDesign>>(
      `${BASE_PATH}/order-items/${orderItemId}/designs/${placement}`,
      form,
      {
        headers: { 'Content-Type': undefined },
        onUploadProgress: (event) => {
          if (!onProgress || !event.total) return;
          onProgress(Math.round((event.loaded * 100) / event.total));
        },
      },
    );
    return res.data.data;
  },

  async deleteDesign(orderItemId: string, placement: PodDesignPlacement): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(
      `${BASE_PATH}/order-items/${orderItemId}/designs/${placement}`,
    );
  },
};
