import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  PodMasterDataOverview,
  PodMasterDataResource,
  PodMasterDataSyncLog,
  PodMasterDataSyncResult,
} from './types';

const BASE = '/pod/master-data';

/**
 * API TikTok Master Data toàn cục.
 *
 * 🔴 `sync` là endpoint DUY NHẤT làm dữ liệu master thay đổi, và backend chỉ cho Super Admin
 * nền tảng gọi. Không màn hình nào của tổ chức được gọi thẳng TikTok, kể cả khi mở dropdown.
 */
export const podMasterDataService = {
  /** Ai cũng đọc được (permission `pod.product.read`) — `canSync` quyết định có hiện nút Sync. */
  async status(): Promise<PodMasterDataOverview> {
    const res = await apiClient.get<ApiResponse<PodMasterDataOverview>>(`${BASE}/status`);
    return res.data.data;
  },

  /** Chỉ Super Admin. Admin tổ chức gọi sẽ nhận 403 từ `SuperAdminGuard`. */
  async logs(
    params: { resource?: PodMasterDataResource; jobId?: string; limit?: number } = {},
  ): Promise<PodMasterDataSyncLog[]> {
    const res = await apiClient.get<ApiResponse<PodMasterDataSyncLog[]>>(`${BASE}/logs`, {
      params,
    });
    return res.data.data;
  },

  /** Chỉ Super Admin. 409 ⇒ đang có lượt khác chạy. */
  async sync(
    payload: { resources?: PodMasterDataResource[]; sourceShopId?: string } = {},
  ): Promise<PodMasterDataSyncResult> {
    const res = await apiClient.post<ApiResponse<PodMasterDataSyncResult>>(`${BASE}/sync`, payload);
    return res.data.data;
  },
};
