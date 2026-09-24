import { env } from '@/lib/env';
import { apiClient } from '@/services/api-client';
import type { ApiResponse, Paginated } from '@/types/api';
import type { PodDesign, PodDesignPlacement } from '@/features/pod-tiktok/order-types';
import type {
  CreateFulfillmentProviderInput,
  FulfillPayload,
  PlatformProvider,
  FulfillmentError,
  FulfillmentProviderAccount,
  FulfillmentProviderOption,
  FulfillmentHistoryEntry,
  FulfillmentOrder,
  FulfillmentOptions,
  FulfillmentState,
  UpdateFulfillmentPayload,
  AutoMapResult,
  CatalogProductQuery,
  CatalogStatus,
  CatalogSyncResult,
  PaginatedCatalogProducts,
  ProductDesignKey,
  ProductMapping,
  ProductMappingQuery,
  ProviderCatalogue,
  ProviderCatalogVariation,
  TestConnectionResult,
  TiktokProductOption,
  UpsertProductMappingInput,
  UpdateFulfillmentProviderInput,
  ShippingLabel,
} from '../types';

const BASE_PATH = '/fulfillment';
/** Khu vực quản trị NỀN TẢNG — tách đường dẫn để không lẫn với API của tổ chức. */
const PLATFORM_PATH = '/platform/fulfillment/providers';

/**
 * API gửi đơn sang xưởng in.
 * Mọi kiểm tra điều kiện đều do BACKEND thực hiện — frontend chỉ hiển thị kết quả,
 * không tự đoán đơn nào gửi được để tránh lệch với luồng gửi thật.
 */
export const fulfillmentService = {
  /**
   * Trạng thái + lý do chưa gửi được của một đơn POD.
   *
   * `providerId` = nhà cung cấp người dùng đang chọn. Trạng thái được tính theo ĐÚNG nhà cung
   * cấp đó (ánh xạ khai cho nhà cung cấp khác sẽ bị chặn), nên màn hình và luồng gửi không
   * bao giờ đánh giá hai nhà cung cấp khác nhau.
   */
  async getState(podOrderId: string, providerId?: string): Promise<FulfillmentState> {
    const res = await apiClient.get<ApiResponse<FulfillmentState>>(
      `${BASE_PATH}/orders/${podOrderId}`,
      providerId ? { params: { providerId } } : undefined,
    );
    return res.data.data;
  },

  async fulfill(podOrderId: string, payload: FulfillPayload = {}): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/fulfill`,
      payload,
    );
    return res.data.data;
  },

  async retry(podOrderId: string, payload: FulfillPayload = {}): Promise<FulfillmentOrder> {
    const res = await apiClient.post<ApiResponse<FulfillmentOrder>>(
      `${BASE_PATH}/orders/${podOrderId}/retry`,
      payload,
    );
    return res.data.data;
  },

  /**
   * Sửa đơn đã gửi (nhãn · ghi chú · phương thức vận chuyển).
   *
   * 🔴 Đường dẫn theo góc nhìn ĐƠN POD vì đây là endpoint duy nhất của thao tác này
   * (`PATCH /pod/orders/{id}/fulfillment`). Nhà cung cấp tính lại chi phí, nên response đã mang
   * giá vốn mới.
   */
  async updateFulfillment(
    podOrderId: string,
    payload: UpdateFulfillmentPayload,
  ): Promise<FulfillmentOrder> {
    const res = await apiClient.patch<ApiResponse<FulfillmentOrder>>(
      `/pod/orders/${podOrderId}/fulfillment`,
      payload,
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

  /** Lấy nhãn vận chuyển của đơn từ TikTok (tái dùng gói đã có — xem tài liệu backend). */
  async tiktokLabel(podOrderId: string): Promise<ShippingLabel> {
    const res = await apiClient.post<ApiResponse<ShippingLabel>>(
      `/pod/orders/${podOrderId}/fulfillment/tiktok-label`,
    );
    return res.data.data;
  },

  /** Lưu nhãn người vận hành tự dán — PERSIST, không chỉ giữ ở form. */
  async saveShippingLabel(podOrderId: string, labelUrl: string): Promise<ShippingLabel> {
    const res = await apiClient.put<ApiResponse<ShippingLabel>>(
      `/pod/orders/${podOrderId}/fulfillment/label`,
      { labelUrl },
    );
    return res.data.data;
  },

  /** Gỡ nhãn khỏi đơn. */
  async clearShippingLabel(podOrderId: string): Promise<void> {
    await apiClient.delete(`/pod/orders/${podOrderId}/fulfillment/label`);
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
/**
 * Nhà cung cấp fulfillment ở cấp NỀN TẢNG — chỉ Super Admin gọi được (backend chặn bằng
 * `SuperAdminGuard` + quyền `platform.fulfillment.*`).
 */
export const platformFulfillmentService = {
  async list(): Promise<PlatformProvider[]> {
    const res = await apiClient.get<ApiResponse<PlatformProvider[]>>(PLATFORM_PATH);
    return res.data.data;
  },

  /** Bật/tắt chế độ dùng chung cho mọi tổ chức. */
  async setGlobal(id: string, isGlobal: boolean): Promise<FulfillmentProviderAccount> {
    const res = await apiClient.patch<ApiResponse<FulfillmentProviderAccount>>(
      `${PLATFORM_PATH}/${id}/global`,
      { isGlobal },
    );
    return res.data.data;
  },

  /** Đồng bộ danh mục về MỘT bản dùng chung. Tác vụ dài — giao diện phải hiện trạng thái. */
  async syncCatalog(id: string): Promise<CatalogSyncResult> {
    const res = await apiClient.post<ApiResponse<CatalogSyncResult>>(
      `${PLATFORM_PATH}/${id}/catalog/sync`,
      undefined,
      // Đồng bộ danh mục vài nghìn sản phẩm chạy lâu hơn hẳn một request thường.
      { timeout: env.uploadTimeoutMs },
    );
    return res.data.data;
  },
};

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

  // -------------------------------------------------------------------------
  // Danh mục nhà cung cấp — ĐỌC TỪ DATABASE
  //
  // 🔴 Không endpoint nào ở đây gọi Mango lúc người dùng bấm. Dữ liệu do Sync Job ghi xuống;
  // muốn mới thì gọi `syncCatalog` (một tác vụ DÀI với danh mục lớn).
  // -------------------------------------------------------------------------

  /**
   * Lựa chọn cấu hình của một nhà cung cấp (shipping · facility · speed · carrier ·
   * production config · production line · vị trí in · lưu ý).
   *
   * 🔴 Giao diện KHÔNG giữ bản sao nào của các danh sách này — xem `FulfillmentOptionsService`.
   */
  async options(accountId: string): Promise<FulfillmentOptions> {
    const res = await apiClient.get<ApiResponse<FulfillmentOptions>>(
      `${BASE_PATH}/accounts/${accountId}/options`,
    );
    return res.data.data;
  },

  async catalogues(accountId: string): Promise<ProviderCatalogue[]> {
    const res = await apiClient.get<ApiResponse<ProviderCatalogue[]>>(
      `${BASE_PATH}/accounts/${accountId}/catalog/catalogues`,
    );
    return res.data.data;
  },

  async catalogProducts(
    accountId: string,
    query: CatalogProductQuery = {},
  ): Promise<PaginatedCatalogProducts> {
    const res = await apiClient.get<ApiResponse<PaginatedCatalogProducts>>(
      `${BASE_PATH}/accounts/${accountId}/catalog/products`,
      { params: query },
    );
    return res.data.data;
  },

  /** `productId` là khoá NỘI BỘ (uuid) lấy từ `catalogProducts`, không phải id của Mango. */
  async catalogVariations(
    accountId: string,
    productId: string,
  ): Promise<ProviderCatalogVariation[]> {
    const res = await apiClient.get<ApiResponse<ProviderCatalogVariation[]>>(
      `${BASE_PATH}/accounts/${accountId}/catalog/products/${productId}/variations`,
    );
    return res.data.data;
  },

  async catalogStatus(accountId: string): Promise<CatalogStatus> {
    const res = await apiClient.get<ApiResponse<CatalogStatus>>(
      `${BASE_PATH}/accounts/${accountId}/catalog/status`,
    );
    return res.data.data;
  },

  /** Kéo danh mục từ nhà cung cấp về Database. Tác vụ DÀI — giao diện phải hiện tiến trình. */
  async syncCatalog(accountId: string): Promise<CatalogSyncResult> {
    const res = await apiClient.post<ApiResponse<CatalogSyncResult>>(
      `${BASE_PATH}/accounts/${accountId}/catalog/sync`,
    );
    return res.data.data;
  },

  /** Rà ánh xạ tự động cho mọi sản phẩm chưa ánh xạ của tổ chức. */
  async autoResolve(): Promise<AutoMapResult> {
    const res = await apiClient.post<ApiResponse<AutoMapResult>>(
      `${BASE_PATH}/mappings/auto-resolve`,
    );
    return res.data.data;
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

  // -------------------------------------------------------------------------
  // Design — thuộc về SẢN PHẨM (Product ID + Seller SKU), không thuộc đơn hàng
  //
  // 🔴 Khoá là (Product ID + Seller SKU) và ĐỘC LẬP với Product Mapping — sản phẩm chưa ánh
  // xạ vẫn upload design được. Upload / Replace / Delete tác động lên SẢN PHẨM, nên mọi đơn
  // mang cùng cặp khoá — kể cả đơn ngày mai mới đồng bộ về — đọc được kết quả ngay ở lần tải
  // kế tiếp. Không có bước sao chép nào.
  //
  // Cặp khoá đi qua query string (không phải path) vì Seller SKU do người bán tự đặt và có
  // thể chứa dấu `/`, khoảng trắng, unicode.
  // -------------------------------------------------------------------------

  async listDesigns(key: ProductDesignKey): Promise<PodDesign[]> {
    const res = await apiClient.get<ApiResponse<PodDesign[]>>(`${BASE_PATH}/product-designs`, {
      params: key,
    });
    return res.data.data;
  },

  /**
   * Upload / thay thế design tại MỘT vị trí in.
   *
   * 🔴 KHÔNG cần sản phẩm đã có Product Mapping. Chỉ đụng đúng vị trí được gửi lên: thay
   * Front thì Back giữ nguyên, và không bao giờ bắt gửi cả hai cùng lúc.
   *
   * Dùng multipart — KHÔNG đặt Content-Type thủ công để axios tự thêm boundary.
   */
  async uploadDesign(
    key: ProductDesignKey,
    placement: PodDesignPlacement,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<PodDesign> {
    const form = new FormData();
    form.append('file', file);
    const res = await apiClient.post<ApiResponse<PodDesign>>(
      `${BASE_PATH}/product-designs/${placement}`,
      form,
      {
        params: key,
        headers: { 'Content-Type': undefined },
        // Ảnh design 100MB trên mạng chậm mất vài phút — xem `env.uploadTimeoutMs`.
        timeout: env.uploadTimeoutMs,
        onUploadProgress: (event) => {
          if (!onProgress || !event.total) return;
          onProgress(Math.round((event.loaded * 100) / event.total));
        },
      },
    );
    return res.data.data;
  },

  /** Xoá design tại MỘT vị trí in. KHÔNG đụng Product Mapping, KHÔNG đụng đơn hàng. */
  async deleteDesign(key: ProductDesignKey, placement: PodDesignPlacement): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`${BASE_PATH}/product-designs/${placement}`, {
      params: key,
    });
  },
};
