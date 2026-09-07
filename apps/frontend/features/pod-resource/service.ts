import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  PodResourceStatus,
  PodResourceSyncLog,
  PodResourceSyncResult,
  PodResourceType,
} from './types';

const BASE = '/pod/resources';

/** Tài nguyên → đường dẫn sync. Thêm tài nguyên mới chỉ là thêm một dòng ở đây. */
const SYNC_PATH: Record<PodResourceType, string> = {
  WAREHOUSE: `${BASE}/warehouses/sync`,
};

/**
 * API Resource Sync — tài nguyên **của tổ chức** (kho hàng).
 *
 * 🔴 Danh mục / thương hiệu / thuộc tính đã chuyển sang `features/pod-master-data`: chúng
 * là dữ liệu master toàn cục và chỉ Super Admin đồng bộ. Ba endpoint sync cũ ở đây đã bị
 * gỡ khỏi backend — gọi lại sẽ nhận 404.
 *
 * Mọi màn hình khác (Categories, Brands, Warehouses, Template) chỉ ĐỌC dữ liệu đã có trong
 * database — không màn hình nào gọi thẳng TikTok, kể cả khi mở dropdown.
 */
export const podResourceService = {
  async status(): Promise<PodResourceStatus[]> {
    const res = await apiClient.get<ApiResponse<PodResourceStatus[]>>(`${BASE}/status`);
    return res.data.data;
  },

  async logs(
    params: { resource?: PodResourceType; jobId?: string; limit?: number } = {},
  ): Promise<PodResourceSyncLog[]> {
    const res = await apiClient.get<ApiResponse<PodResourceSyncLog[]>>(`${BASE}/logs`, { params });
    return res.data.data;
  },

  async sync(
    resource: PodResourceType,
    payload: { shopId?: string } = {},
  ): Promise<PodResourceSyncResult> {
    const res = await apiClient.post<ApiResponse<PodResourceSyncResult>>(
      SYNC_PATH[resource],
      payload,
    );
    return res.data.data;
  },
};
