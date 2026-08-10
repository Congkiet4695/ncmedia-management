import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  PodPayoutAccountListResult,
  PodPayoutBreakdownQuery,
  PodPayoutFilter,
  PodPayoutSellerListResult,
  PodPayoutSummary,
  PodPayoutSyncResult,
  TriggerPayoutSyncPayload,
} from '../payout-types';

const BASE_PATH = '/pod/tiktok/payout';

/** Bỏ tham số rỗng để không gửi query thừa lên backend. */
function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

/**
 * Báo cáo Payout TikTok — chỉ ĐỌC (trừ endpoint đồng bộ).
 * Mọi phép lọc/aggregate do backend thực hiện; frontend không tự tính lại số liệu.
 */
export const podPayoutService = {
  async summary(filter: PodPayoutFilter): Promise<PodPayoutSummary> {
    const res = await apiClient.get<ApiResponse<PodPayoutSummary>>(`${BASE_PATH}/summary`, {
      params: clean(filter as Record<string, unknown>),
    });
    return res.data.data;
  },

  async sellers(query: PodPayoutBreakdownQuery): Promise<PodPayoutSellerListResult> {
    const res = await apiClient.get<ApiResponse<PodPayoutSellerListResult>>(
      `${BASE_PATH}/sellers`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  async accounts(query: PodPayoutBreakdownQuery): Promise<PodPayoutAccountListResult> {
    const res = await apiClient.get<ApiResponse<PodPayoutAccountListResult>>(
      `${BASE_PATH}/accounts`,
      { params: clean(query as Record<string, unknown>) },
    );
    return res.data.data;
  },

  async triggerSync(payload: TriggerPayoutSyncPayload = {}): Promise<PodPayoutSyncResult> {
    const res = await apiClient.post<ApiResponse<PodPayoutSyncResult>>(
      `${BASE_PATH}/sync`,
      clean(payload as Record<string, unknown>),
    );
    return res.data.data;
  },
};
