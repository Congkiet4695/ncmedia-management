import type { PodDesign, PodDesignPlacement } from '@/features/pod-tiktok/order-types';

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

// ---------------------------------------------------------------------------
// Product Mapping — SẢN PHẨM POD
//
// 🔴 Danh tính là **Product ID + Seller SKU**. Đây là nơi Design, Fulfillment SKU, Provider
// và Base Cost cùng sống; đơn hàng chỉ ĐỌC qua đây và không giữ bản sao nào.
// ---------------------------------------------------------------------------

export type ProductMappingStatus = 'ACTIVE' | 'INACTIVE';

/**
 * Tình trạng design do BACKEND tính.
 *
 * Không tự suy ra ở frontend: luật "có mặt trước là đủ, mặt sau tuỳ chọn" cũng là luật quyết
 * định nút Fulfill sáng hay mờ. Hai bản sao của một luật sẽ trôi lệch, và triệu chứng là
 * bảng báo "sẵn sàng" trong khi đơn vẫn bị chặn.
 */
export type ProductMappingDesignStatus = 'READY' | 'MISSING_FRONT' | 'MISSING_ALL';

export interface ProductMapping {
  id: string;
  /** Nửa đầu khoá nghiệp vụ. NULL = bản ghi cũ chưa đủ khoá, không ghép được đơn nào. */
  tiktokProductId: string | null;
  /** Nửa sau khoá nghiệp vụ. */
  sellerSku: string | null;
  /** Tham chiếu, KHÔNG tham gia ghép đơn. */
  tiktokSkuId: string | null;
  /** Fulfillment SKU — giá trị THỰC SỰ gửi đi khi tạo đơn. */
  providerSku: string;
  /** Giá vốn nhà cung cấp. NULL = chưa khai. */
  baseCost: number | null;
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
  /** File in của sản phẩm — nguồn sự thật duy nhất, mọi đơn cùng khoá đọc chính danh sách này. */
  designs: PodDesign[];
  designStatus: ProductMappingDesignStatus;
  updatedByName: string | null;
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

// ---------------------------------------------------------------------------
// Danh mục nhà cung cấp — ĐỌC TỪ DATABASE
//
// 🔴 Giao diện KHÔNG gọi Mango nữa. Dữ liệu do Sync Job ghi xuống, nên mọi phản hồi đều kèm
// `lastSyncedAt` — người dùng phải biết mình đang nhìn dữ liệu cũ tới đâu.
//
// 🔴 `id` là khoá NỘI BỘ (uuid), `externalXxxId` mới là khoá phía nhà cung cấp. Gửi nhầm cái
// nọ thay cái kia là lỗi thầm lặng khó tìm nhất ở đây.
// ---------------------------------------------------------------------------

/** Một danh mục (nhóm sản phẩm) phía nhà cung cấp. */
export interface ProviderCatalogue {
  id: string;
  externalCatalogueId: string;
  name: string;
  lastSyncedAt: string | null;
}

/** Sản phẩm trong danh mục nhà cung cấp. */
export interface ProviderCatalogProduct {
  id: string;
  externalProductId: string;
  sku: string | null;
  name: string;
  catalogueId: string | null;
  catalogName: string | null;
  basePrice: string | null;
  currency: string | null;
  imageUrl: string | null;
  isActive: boolean;
  /** Số biến thể ĐÃ ĐỒNG BỘ — con số có thật ở bước chọn tiếp theo. */
  variationsCount: number | null;
}

/** Vị trí in được thao tác ở giao diện hiện tại. */
export type MappingDesignPlacement = PodDesignPlacement;

/**
 * Khoá nghiệp vụ của một sản phẩm POD — địa chỉ để lưu/đọc Design.
 *
 * 🔴 KHÔNG phải id của Product Mapping. Design và Product Mapping là hai nghiệp vụ độc lập:
 * sản phẩm chưa ánh xạ vẫn upload design được.
 */
export interface ProductDesignKey {
  tiktokProductId: string;
  sellerSku: string;
}

export interface ProviderCatalogVariation {
  id: string;
  externalVariantId: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  price: string | null;
  isAvailable: boolean;
}

export interface CatalogProductQuery {
  page?: number;
  limit?: number;
  search?: string;
  catalogueId?: string;
}

export interface PaginatedCatalogProducts {
  items: ProviderCatalogProduct[];
  meta: { total: number; page: number; limit: number; totalPages: number };
  lastSyncedAt: string | null;
}

/** Kết quả một lượt đồng bộ danh mục. */
export interface CatalogSyncResult {
  accountId: string;
  provider: FulfillmentProviderType;
  catalogues: number;
  products: number;
  variants: number;
  archivedCatalogues: number;
  archivedProducts: number;
  archivedVariants: number;
  apiCalls: number;
  durationMs: number;
  /** false = có lượt đọc bị cụt; xem `warnings`. */
  complete: boolean;
  warnings: string[];
}

/** Tình trạng bản sao danh mục của một tài khoản. */
export interface CatalogStatus {
  catalogues: number;
  products: number;
  variants: number;
  lastSyncedAt: string | null;
}

/** Kết quả một lượt rà ánh xạ tự động. */
export interface AutoMapResult {
  scanned: number;
  autoMapped: number;
  needManual: number;
  notFound: number;
  skipped: number;
}

export interface ProductMappingQuery {
  page?: number;
  limit?: number;
  /** Tìm trong Product ID, Seller SKU, Fulfillment SKU và tên sản phẩm nhà cung cấp. */
  search?: string;
  accountId?: string;
  status?: ProductMappingStatus;
  /** MISSING = chưa có mặt trước ⇒ mọi đơn của sản phẩm này đang bị chặn gửi sản xuất. */
  designStatus?: 'READY' | 'MISSING';
}

export interface UpsertProductMappingInput {
  /**
   * Tài khoản nhà cung cấp sẽ sản xuất sản phẩm này.
   * 🔴 Phải gửi khi tổ chức có nhiều tài khoản cùng nhà cung cấp — bỏ trống thì backend lấy
   * tài khoản mặc định và ánh xạ có thể gắn nhầm tài khoản so với đơn.
   */
  accountId?: string;
  /** 🔴 Bắt buộc — một nửa khoá nghiệp vụ. */
  tiktokProductId: string;
  /** 🔴 Bắt buộc — nửa còn lại. */
  sellerSku: string;
  /** Tham chiếu, không tham gia ghép đơn. */
  tiktokSkuId?: string;
  providerSku: string;
  baseCost?: number;
  providerProductId?: string;
  providerVariantId?: string;
  providerProductName?: string;
  providerVariantName?: string;
  providerColor?: string;
  providerSize?: string;
  isActive?: boolean;
  note?: string;
}
