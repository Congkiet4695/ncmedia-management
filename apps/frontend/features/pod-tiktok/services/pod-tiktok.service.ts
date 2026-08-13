import { apiClient } from '@/services/api-client';
import type { ApiResponse } from '@/types/api';
import type {
  LinkTiktokAccountPayload,
  PodTiktokAccount,
  PodTiktokAccountListResult,
  PodTiktokAccountQuery,
  PodSellerOption,
  PodTiktokAuthorizeUrl,
  TiktokRegion,
} from '../types';

const BASE_PATH = '/pod/tiktok/accounts';

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

  /** Link Account: đổi Authorization Code → token → lấy shop → lưu DB (backend xử lý). */
  async link(payload: LinkTiktokAccountPayload): Promise<PodTiktokAccount> {
    const res = await apiClient.post<ApiResponse<PodTiktokAccount>>(`${BASE_PATH}/link`, payload);
    return res.data.data;
  },

  /** Lấy link uỷ quyền để Seller mở và lấy Authorization Code. */
  async authorizeUrl(region?: TiktokRegion): Promise<PodTiktokAuthorizeUrl> {
    const res = await apiClient.get<ApiResponse<PodTiktokAuthorizeUrl>>(
      `${BASE_PATH}/authorize-url`,
      { params: clean({ region }) },
    );
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

  async assignSeller(id: string, sellerId: string | null): Promise<PodTiktokAccount> {
    const res = await apiClient.patch<ApiResponse<PodTiktokAccount>>(
      `${BASE_PATH}/${id}/seller`,
      { sellerId },
    );
    return res.data.data;
  },
};
