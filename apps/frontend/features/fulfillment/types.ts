/** Trạng thái nhà cung cấp — dạng đọc được của cờ `isActive` phía backend. */
export type FulfillmentProviderStatus = 'ACTIVE' | 'INACTIVE';

/** Một nhà cung cấp fulfillment đã cấu hình. KHÔNG BAO GIỜ chứa API key. */
export interface FulfillmentProviderAccount {
  id: string;
  provider: FulfillmentProviderType;
  name: string;
  /** 4 ký tự cuối của API key — chỉ để đối chiếu, không dùng lại được. */
  apiKeyHint: string | null;
  baseUrl: string | null;
  status: FulfillmentProviderStatus;
  isActive: boolean;
  isDefault: boolean;
  /** Số kết nối TikTok đang dùng nhà cung cấp này. */
  linkedTiktokAccounts: number;
  lastUsedAt: string | null;
  lastErrorMsg: string | null;
  createdAt: string;
  updatedAt: string;
  /** Chỉ có NGAY SAU khi tạo — chứa secret, hiện một lần rồi thôi. */
  webhookUrl: string | null;
}

/** Mục trong dropdown chọn nhà cung cấp ở màn hình TikTok Account. */
export interface FulfillmentProviderOption {
  id: string;
  name: string;
  provider: FulfillmentProviderType;
}

/** Kết quả Test Connection. */
export interface TestConnectionResult {
  connected: boolean;
  message: string;
  durationMs: number | null;
  productionLineCount: number | null;
}

export interface CreateFulfillmentProviderInput {
  provider: FulfillmentProviderType;
  name: string;
  apiKey: string;
  baseUrl?: string;
  isActive?: boolean;
}

export interface UpdateFulfillmentProviderInput {
  name?: string;
  /** Bỏ trống ⇒ GIỮ NGUYÊN khoá cũ. Chỉ gửi khi người dùng bấm "Replace API Key". */
  apiKey?: string;
  baseUrl?: string;
  isActive?: boolean;
}

/** Nhà cung cấp fulfillment. Hiện chỉ MANGO được implement. */
export const FULFILLMENT_PROVIDERS = ['MANGO', 'PRINTIFY', 'PRINTFUL', 'CUSTOM'] as const;
export type FulfillmentProviderType = (typeof FULFILLMENT_PROVIDERS)[number];

/**
 * Trạng thái fulfillment CHUẨN HOÁ của NCMedia (dùng chung mọi nhà cung cấp).
 * Trạng thái gốc của nhà cung cấp nằm ở `providerStatus`, luôn hiển thị kèm.
 */
export const FULFILLMENT_STATUSES = [
  'DRAFT',
  'SUBMITTING',
  'SUBMITTED',
  'IN_PRODUCTION',
  'ON_HOLD',
  'SHIPPED',
  'DELIVERED',
  'REJECTED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
  'UNKNOWN',
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

/**
 * Nhãn hiển thị của trạng thái nằm ở `i18n/locales/<lang>/fulfillment.json` (khoá `status.*`),
 * không đặt trong file type — nhãn phụ thuộc ngôn ngữ, type thì không.
 */

export interface FulfillmentItem {
  id: string;
  podOrderItemId: string | null;
  providerSku: string;
  quantity: number;
  printFiles: unknown;
  color: string | null;
  size: string | null;
}

export interface FulfillmentOrder {
  id: string;
  podOrderId: string;
  provider: FulfillmentProviderType;
  status: FulfillmentStatus;
  /** Trạng thái NGUYÊN VĂN của nhà cung cấp — hiển thị kèm để đối soát. */
  providerStatus: string | null;
  externalOrderId: string;
  providerOrderId: string | null;
  providerFulfillId: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  labelUrl: string | null;
  shippingMethod: string | null;
  productionLine: string | null;
  total: number | null;
  currency: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  submittedAt: string | null;
  lastSyncedAt: string | null;
  cancelledAt: string | null;
  /** Thời điểm nhà cung cấp báo đã giao xong. Ghi một lần, không đổi sau đó. */
  completedAt: string | null;
  items: FulfillmentItem[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Một lý do khiến đơn chưa gửi được.
 *
 * Với `MAPPING_MISSING`, backend gửi kèm ngữ cảnh SKU để giao diện mở được dialog ánh xạ
 * ngay tại màn hình đơn — không phải đi sang màn hình Product Mapping tìm lại.
 */
export interface FulfillmentIssue {
  code: string;
  message: string;
  podOrderItemId: string | null;
  /** Ngữ cảnh SKU để mở dialog ánh xạ nhanh — chỉ có với MAPPING_MISSING. */
  tiktokProductId?: string | null;
  tiktokSkuId?: string | null;
  sellerSku?: string | null;
  productName?: string | null;
  skuName?: string | null;
  productCategory?: string | null;
}

/** Nhà cung cấp gán cho đơn — hiển thị ở Order Detail. */
export interface FulfillmentStateProvider {
  id: string;
  name: string;
  type: FulfillmentProviderType;
  isActive: boolean;
}

export interface FulfillmentState {
  fulfillment: FulfillmentOrder | null;
  ready: boolean;
  issues: FulfillmentIssue[];
  canFulfill: boolean;
  canCancel: boolean;
  /** Nhà cung cấp gán cho kết nối TikTok của đơn. NULL = chưa cấu hình. */
  provider: FulfillmentStateProvider | null;
}

export interface FulfillmentHistoryEntry {
  id: string;
  eventType: string;
  trigger: string;
  fromStatus: string | null;
  toStatus: string | null;
  providerStatus: string | null;
  success: boolean;
  message: string | null;
  payload: unknown;
  durationMs: number | null;
  requestId: string | null;
  createdAt: string;
}

export interface FulfillmentError {
  id: string;
  operation: string;
  errorClass: string;
  httpStatus: number | null;
  providerCode: string | null;
  message: string;
  validationErrors: unknown;
  retryable: boolean;
  requestId: string | null;
  createdAt: string;
}

export interface FulfillmentAccount {
  id: string;
  provider: FulfillmentProviderType;
  name: string;
  apiKeyHint: string | null;
  isActive: boolean;
  isDefault: boolean;
  defaultProductionLine: string | null;
  defaultShippingMethod: string;
  defaultFacility: string | null;
  /** Chỉ có giá trị NGAY SAU khi tạo — chứa secret, hiện một lần rồi thôi. */
  webhookUrl: string | null;
  providerWebhookId: string | null;
  lastUsedAt: string | null;
  lastErrorMsg: string | null;
  createdAt: string;
}

export interface ProductMapping {
  id: string;
  tiktokProductId: string | null;
  tiktokSkuId: string | null;
  sellerSku: string | null;
  providerSku: string;
  providerProductName: string | null;
  providerColor: string | null;
  providerSize: string | null;
  productionConfig: string | null;
  placementMap: unknown;
  isActive: boolean;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Ánh xạ sản phẩm TikTok ⇄ nhà cung cấp
// ---------------------------------------------------------------------------

export type ProductMappingStatus = 'ACTIVE' | 'INACTIVE';

export interface ProductMapping {
  id: string;
  tiktokProductId: string | null;
  tiktokSkuId: string | null;
  sellerSku: string | null;
  /** SKU bên nhà cung cấp — giá trị THỰC SỰ gửi đi khi tạo đơn. */
  providerSku: string;
  providerProductId: string | null;
  providerVariantId: string | null;
  providerProductName: string | null;
  providerVariantName: string | null;
  providerColor: string | null;
  providerSize: string | null;
  productionConfig: string | null;
  placementMap: unknown;
  isActive: boolean;
  status: ProductMappingStatus;
  /** Tên nhà cung cấp (hiển thị ở bảng). */
  providerName: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Một SKU TikTok có thể ánh xạ (lấy từ các đơn đã đồng bộ). */
export interface TiktokProductOption {
  tiktokProductId: string | null;
  tiktokSkuId: string | null;
  sellerSku: string | null;
  productName: string | null;
  skuName: string | null;
  productCategory: string | null;
  skuImage: string | null;
  /** Đã có ánh xạ chưa — dùng để làm nổi SKU còn thiếu. */
  mapped: boolean;
}

/** Sản phẩm trong danh mục nhà cung cấp (đọc trực tiếp từ API, không hardcode). */
export interface ProviderCatalogProduct {
  id: string;
  sku: string | null;
  name: string;
  catalogName: string | null;
  basePrice: string | null;
  currency: string | null;
  imageUrl: string | null;
  isActive: boolean;
  /** Số biến thể nhà cung cấp báo — cho biết trước quy mô danh sách ở bước sau. */
  variationsCount: number | null;
}

export interface ProviderCatalogVariation {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  price: string | null;
  isAvailable: boolean;
}

export interface ProductMappingQuery {
  page?: number;
  limit?: number;
  search?: string;
  accountId?: string;
  status?: ProductMappingStatus;
}

export interface UpsertProductMappingInput {
  tiktokProductId?: string;
  tiktokSkuId?: string;
  sellerSku?: string;
  providerSku: string;
  providerProductId?: string;
  providerVariantId?: string;
  providerProductName?: string;
  providerVariantName?: string;
  providerColor?: string;
  providerSize?: string;
  isActive?: boolean;
  note?: string;
}
