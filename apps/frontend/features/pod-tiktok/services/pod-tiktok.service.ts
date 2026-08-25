import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  CompleteTiktokOAuthPayload,
  PodTiktokOAuthCompleteResult,
  PodTiktokAccount,
  PodTiktokAccountListResult,
  PodTiktokAccountQuery,
  PodSellerOption,
  PodTiktokAuthorizeUrl,
  PodTiktokLinkResult,
  StartTiktokAuthorizationPayload,
} from '../types';

const BASE_PATH = '/pod/tiktok/accounts';
/** Endpoint CÔNG KHAI — trang kết quả chạy khi người dùng có thể chưa đăng nhập. */
const LINK_RESULT_PATH = '/tiktok/link-result';
const OAUTH_COMPLETE_PATH = '/tiktok/oauth/complete';

function clean<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

export const podTiktokService = {
  async list(query: PodTiktokAccountQuery): Promise<PodTiktokAccountListResult> {
    const res = await apiClient.get<ApiResponse<PodTiktokAccountListResult>>(BASE_PATH, {
      params: clean(query as Record<string, unknown>),
    });
    return res.data.data;
  },

  async get(id: string): Promise<PodTiktokAccount> {
    const res = await apiClient.get<ApiResponse<PodTiktokAccount>>(`${BASE_PATH}/${id}`);
    return res.data.data;
  },

  /**
   * Tạo Authorization URL: backend sinh `state`, lưu server-side kèm Account Name rồi trả
   * link đầy đủ để người dùng copy. Sau khi Seller Approve, backend tự hoàn tất — frontend
   * KHÔNG bao giờ đụng tới Authorization Code.
   */
  async startAuthorization(
    payload: StartTiktokAuthorizationPayload,
  ): Promise<PodTiktokAuthorizeUrl> {
    const res = await apiClient.post<ApiResponse<PodTiktokAuthorizeUrl>>(
      `${BASE_PATH}/authorize-url`,
      clean(payload as unknown as Record<string, unknown>),
    );
    return res.data.data;
  },

  /**
   * Hoàn tất uỷ quyền: đẩy `code` + `state` TikTok vừa trả về xuống backend.
   *
   * 🔴 Frontend KHÔNG xử lý OAuth — không đổi token, không đọc `code`, không lưu nó ở đâu.
   * Toàn bộ nghiệp vụ (validate state, exchange token, lấy shop, lưu account) ở backend.
   */
  async completeOAuth(
    payload: CompleteTiktokOAuthPayload,
  ): Promise<PodTiktokOAuthCompleteResult> {
    const res = await apiClient.post<ApiResponse<PodTiktokOAuthCompleteResult>>(
      OAUTH_COMPLETE_PATH,
      clean(payload as unknown as Record<string, unknown>),
    );
    return res.data.data;
  },

  /** Tóm tắt kết quả uỷ quyền cho trang công khai (chỉ tên shop, region, thời điểm). */
  async linkResult(ref: string): Promise<PodTiktokLinkResult> {
    const res = await apiClient.get<ApiResponse<PodTiktokLinkResult>>(LINK_RESULT_PATH, {
      params: { ref },
    });
    return res.data.data;
  },

  async unlink(id: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`${BASE_PATH}/${id}`);
  },

  /** Danh sách Seller có thể phân công (Employee ACTIVE + Role EMPLOYEE). */
  async sellerOptions(search?: string): Promise<PodSellerOption[]> {
    const res = await apiClient.get<ApiResponse<PodSellerOption[]>>(`${BASE_PATH}/sellers`, {
      params: clean({ search }),
    });
    return res.data.data;
  },

  /** Phân công Seller phụ trách. `sellerId = null` để bỏ phân công. */
  /** Gán / bỏ gán nhà cung cấp fulfillment cho một kết nối. */
  async assignFulfillmentProvider(
    id: string,
    fulfillmentAccountId: string | null,
  ): Promise<PodTiktokAccount> {
    const res = await apiClient.patch<ApiResponse<PodTiktokAccount>>(
      `${BASE_PATH}/${id}/fulfillment-provider`,
      { fulfillmentAccountId },
    );
    return res.data.data;
  },

  /**
   * Đặt kho mặc định cho MỘT shop (Warehouse Mapping).
   *
   * 🔴 Kho thuộc về shop, không thuộc về sản phẩm — Draft Product không gắn kho, kho chỉ
   * được quyết lúc Publish.
   */
  async setShopWarehouse(
    accountId: string,
    shopId: string,
    warehouseId: string | null,
  ): Promise<PodTiktokAccount> {
    const res = await apiClient.patch<ApiResponse<PodTiktokAccount>>(
      `${BASE_PATH}/${accountId}/shops/${shopId}/warehouse`,
      { warehouseId },
    );
    return res.data.data;
  },

  async assignSeller(id: string, sellerId: string | null): Promise<PodTiktokAccount> {
    const res = await apiClient.patch<ApiResponse<PodTiktokAccount>>(
      `${BASE_PATH}/${id}/seller`,
      { sellerId },
    );
    return res.data.data;
  },
};
