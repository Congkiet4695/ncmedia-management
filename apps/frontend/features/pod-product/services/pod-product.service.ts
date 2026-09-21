import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type { PodListingJob } from '@/features/pod-listing/types';
import type {
  CloneProductPayload,
  PodProductDeleteResult,
  PodProductVariantListResult,
  PodProductVariantQuery,
  PodProductDetail,
  PodProductFilterOptions,
  PodProductListResult,
  PodProductQuery,
  UpdatePodProductPayload,
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
 * ĐỌC + ĐỒNG BỘ + SỬA (`update`) + NGỪNG BÁN (`deactivate`) + XOÁ (`remove`) + NHÂN BẢN
 * (`clone` — sang nhiều shop, trả về Listing Job để theo dõi tiến độ). Mọi thao tác ghi đều
 * đi lên TikTok trước; sàn từ chối thì backend không đổi gì và trả lỗi nguyên văn.
 */
export const podProductService = {
  async list(query: PodProductQuery): Promise<PodProductListResult> {
    const res = await apiClient.get<ApiResponse<PodProductListResult>>(BASE_PATH, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  /**
   * Danh sách SKU có phân trang — nguồn của bộ chọn SKU ở Flash Sale.
   *
   * 🔴 Phân trang ở SERVER. Không có endpoint này thì bộ chọn buộc phải tải sản phẩm kèm
   * toàn bộ biến thể rồi tự cắt — tức là vẫn kéo cả kho về trình duyệt.
   */
  async listVariants(query: PodProductVariantQuery): Promise<PodProductVariantListResult> {
    const res = await apiClient.get<ApiResponse<PodProductVariantListResult>>(
      `${BASE_PATH}/variants`,
      { params: query },
    );
    return res.data.data;
  },

  async get(id: string): Promise<PodProductDetail> {
    const res = await apiClient.get<ApiResponse<PodProductDetail>>(`${BASE_PATH}/${id}`);
    return res.data.data;
  },

  /**
   * Sửa sản phẩm trên sàn. Chỉ gửi trường người dùng đã đổi — backend diff thêm lần nữa.
   *
   * Trả về sản phẩm ĐÃ ĐỒNG BỘ LẠI từ TikTok, không phải thứ vừa gửi đi: sàn có thể chuẩn
   * hoá giá trị (làm tròn giá, cắt tiêu đề).
   */
  async update(id: string, payload: UpdatePodProductPayload): Promise<PodProductDetail> {
    const res = await apiClient.patch<ApiResponse<PodProductDetail>>(`${BASE_PATH}/${id}`, payload);
    return res.data.data;
  },

  /** Ngừng bán trên TikTok (Deactivate Products) rồi đồng bộ lại — trả về sản phẩm như sàn đang có. */
  async deactivate(id: string): Promise<PodProductDetail> {
    const res = await apiClient.post<ApiResponse<PodProductDetail>>(`${BASE_PATH}/${id}/deactivate`);
    return res.data.data;
  },

  /** Xoá khỏi TikTok (Delete Products) rồi xoá mềm bản ghi trong hệ thống. */
  async remove(id: string): Promise<PodProductDeleteResult> {
    const res = await apiClient.delete<ApiResponse<PodProductDeleteResult>>(`${BASE_PATH}/${id}`);
    return res.data.data;
  },

  /**
   * Nhân bản một sản phẩm sang nhiều shop — trả về Listing Job (`type = CLONE`).
   *
   * Tiến độ / kết quả từng shop đọc qua `podListingService.job` + `jobItems` như mọi lượt khác.
   */
  async clone(id: string, payload: CloneProductPayload): Promise<PodListingJob> {
    const res = await apiClient.post<ApiResponse<PodListingJob>>(`${BASE_PATH}/${id}/clone`, payload);
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
