import { apiClient } from '@/services/api-client';
import type { ApiResponse, Paginated } from '@/types/api';
import type {
  CreateFulfillmentProviderInput,
  FulfillmentError,
  FulfillmentProviderAccount,
  FulfillmentProviderOption,
  FulfillmentHistoryEntry,
  FulfillmentOrder,
  FulfillmentState,
  ProductMapping,
  ProductMappingQuery,
  ProviderCatalogProduct,
  ProviderCatalogVariation,
  TestConnectionResult,
  TiktokProductOption,
  UpsertProductMappingInput,
  UpdateFulfillmentProviderInput,
} from '../types';

const BASE_PATH = '/fulfillment';

/**
 * API gửi đơn sang xưởng in.
 * Mọi kiểm tra điều kiện đều do BACKEND thực hiện — frontend chỉ hiển thị kết quả,
 * không tự đoán đơn nào gửi được để tránh lệch với luồng gửi thật.
 */
export const fulfillmentService = {
  /** Trạng thái + lý do chưa gửi được của một đơn POD. */
  async getState(podOrderId: string): Promise<FulfillmentState> {
    const res = await apiClient.get<ApiResponse<FulfillmentState>>(
      `${BASE_PATH}/orders/${podOrderId}`,
    );
    return res.data.data;
  },

  async fulfill(podOrderId: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/fulfill`,
    );
    return res.data.data;
  },

  async retry(podOrderId: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/retry`,
    );
    return res.data.data;
  },

  async sync(podOrderId: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/sync`,
    );
    return res.data.data;
  },

  async cancel(podOrderId: string, reason?: string): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/cancel`,
      reason ? { reason } : {},
    );
    return res.data.data;
  },

  async history(podOrderId: string): Promise<FulfillmentHistoryEntry[]> {
    const res = await apiClient.get<ApiResponse<FulfillmentHistoryEntry[]>>(
      `${BASE_PATH}/orders/${podOrderId}/history`,
    );
    return res.data.data;
  },

  async errors(podOrderId: string): Promise<FulfillmentError[]> {
    const res = await apiClient.get<ApiResponse<FulfillmentError[]>>(
      `${BASE_PATH}/orders/${podOrderId}/errors`,
    );
    return res.data.data;
  },
};

/**
 * API quản trị nhà cung cấp fulfillment.
 *
 * 🔴 Không endpoint nào ở đây trả về API key. Backend chỉ trả `apiKeyHint` (4 ký tự cuối),
 * nên frontend KHÔNG có cách nào hiển thị hoặc gửi lại khoá cũ — muốn đổi thì nhập khoá mới.
 */
export const fulfillmentProviderService = {
  async list(): Promise<FulfillmentProviderAccount[]> {
    const res = await apiClient.get<ApiResponse<FulfillmentProviderAccount[]>>(
      `${BASE_PATH}/accounts`,
    );
    return res.data.data;
  },

  /** Danh sách rút gọn (chỉ ACTIVE) cho dropdown ở màn hình TikTok Account. */
  async options(): Promise<FulfillmentProviderOption[]> {
    const res = await apiClient.get<ApiResponse<FulfillmentProviderOption[]>>(
      `${BASE_PATH}/provider-options`,
    );
    return res.data.data;
  },

  async create(input: CreateFulfillmentProviderInput): Promise<FulfillmentProviderAccount> {
    const res = await apiClient.post<ApiResponse<FulfillmentProviderAccount>>(
      `${BASE_PATH}/accounts`,
      input,
    );
    return res.data.data;
  },

  async update(
    id: string,
    input: UpdateFulfillmentProviderInput,
  ): Promise<FulfillmentProviderAccount> {
    const res = await apiClient.patch<ApiResponse<FulfillmentProviderAccount>>(
      `${BASE_PATH}/accounts/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<{ unlinkedTiktokAccounts: number }> {
    const res = await apiClient.delete<ApiResponse<{ unlinkedTiktokAccounts: number }>>(
      `${BASE_PATH}/accounts/${id}`,
    );
    return res.data.data;
  },

  async testConnection(id: string): Promise<TestConnectionResult> {
    const res = await apiClient.post<ApiResponse<TestConnectionResult>>(
      `${BASE_PATH}/accounts/${id}/test-connection`,
    );
    return res.data.data;
  },
};

/**
 * API ánh xạ sản phẩm.
 *
 * Danh mục sản phẩm/biến thể KHÔNG nằm ở frontend — luôn đọc qua backend, backend đọc
 * trực tiếp từ API nhà cung cấp và cache 5 phút. Không có danh sách cứng ở đâu cả.
 */
export const productMappingService = {
  async list(query: ProductMappingQuery): Promise<Paginated<ProductMapping>> {
    const res = await apiClient.get<ApiResponse<Paginated<ProductMapping>>>(
      `${BASE_PATH}/mappings/paged`,
      { params: query },
    );
    return res.data.data;
  },

  /** SKU TikTok có thể ánh xạ, kèm cờ `mapped`. */
  async tiktokProducts(accountId: string, search?: string): Promise<TiktokProductOption[]> {
    const res = await apiClient.get<ApiResponse<TiktokProductOption[]>>(
      `${BASE_PATH}/mappings/tiktok-products`,
      { params: { accountId, search } },
    );
    return res.data.data;
  },

  async catalogProducts(accountId: string, search?: string): Promise<ProviderCatalogProduct[]> {
    const res = await apiClient.get<ApiResponse<ProviderCatalogProduct[]>>(
      `${BASE_PATH}/accounts/${accountId}/catalog/products`,
      { params: { search } },
    );
    return res.data.data;
  },

  async catalogVariations(
    accountId: string,
    productId: string,
  ): Promise<ProviderCatalogVariation[]> {
    const res = await apiClient.get<ApiResponse<ProviderCatalogVariation[]>>(
      `${BASE_PATH}/accounts/${accountId}/catalog/products/${encodeURIComponent(productId)}/variations`,
    );
    return res.data.data;
  },

  async refreshCatalog(accountId: string): Promise<void> {
    await apiClient.post(`${BASE_PATH}/accounts/${accountId}/catalog/refresh`);
  },

  async create(input: UpsertProductMappingInput): Promise<ProductMapping> {
    const res = await apiClient.post<ApiResponse<ProductMapping>>(`${BASE_PATH}/mappings`, input);
    return res.data.data;
  },

  async update(id: string, input: UpsertProductMappingInput): Promise<ProductMapping> {
    const res = await apiClient.patch<ApiResponse<ProductMapping>>(
      `${BASE_PATH}/mappings/${id}`,
      input,
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/mappings/${id}`);
  },
};
