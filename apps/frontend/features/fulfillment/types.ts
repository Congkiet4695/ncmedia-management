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
  /** Tài khoản DÙNG CHUNG toàn nền tảng — tổ chức đọc được nhưng không sửa/xoá được. */
  isGlobal: boolean;
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
  /**
   * Giá vốn dòng hàng.
   *
   * 🔴 Sau khi gửi đơn, đây là số NHÀ CUNG CẤP báo về (Create Order / Get Order Detail) — KHÔNG
   * phải số tự tính ở giao diện. NULL = nhà cung cấp chưa báo giá cho dòng này.
   */
  baseCost: number | null;
  providerItemId: string | null;
}

/**
 * Tuỳ chọn gửi đơn — đúng các lựa chọn MangoTee nhận (không tự chế giá trị).
 * Bỏ trống ⇒ backend dùng mặc định của tài khoản nhà cung cấp.
 */
export const FULFILL_SHIPPING_METHODS = [
  'standard',
  'priority',
  'express',
  'global',
  'by_tiktok',
  'by_seller',
  'dhl_parcel_ground',
  'dhl_parcel_expedited',
] as const;
export type FulfillShippingMethod = (typeof FULFILL_SHIPPING_METHODS)[number];

export const FULFILL_FACILITIES = ['AUTO', 'TX', 'SJ', 'VA'] as const;
export const FULFILL_SPEED_TYPES = ['rush', 'expedite'] as const;
export const FULFILL_PREFERRED_CARRIERS = ['auto', 'usps'] as const;

export interface FulfillPayload {
  /**
   * Nhà cung cấp người dùng CHỌN cho lần gửi này (`fulfillment_accounts.id`).
   *
   * 🔴 Đây là nguồn ưu tiên số một ở backend; bỏ trống mới lùi về nhà cung cấp gán cho kết
   * nối TikTok (dữ liệu cũ) hoặc nhà cung cấp duy nhất khả dụng.
   */
  fulfillmentAccountId?: string;
  shippingMethod?: FulfillShippingMethod;
  facility?: (typeof FULFILL_FACILITIES)[number];
  speedType?: (typeof FULFILL_SPEED_TYPES)[number];
  preferredCarrier?: (typeof FULFILL_PREFERRED_CARRIERS)[number];
  isScanLabel?: boolean;
  labelUrl?: string;
  note?: string;
}

/** Sửa đơn ĐÃ gửi mà chưa vào sản xuất — nhà cung cấp tính lại chi phí. */
export interface UpdateFulfillmentPayload {
  labelUrl?: string;
  note?: string;
  shippingMethod?: FulfillShippingMethod;
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
  facility: string | null;
  speedType: string | null;
  subtotal: number | null;
  shippingFee: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  /** Đơn đã gửi nhưng còn dòng chưa có giá vốn — lượt đồng bộ kế tiếp sẽ điền. */
  baseCostPending: boolean;
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
/** Một lựa chọn cho ô chọn: giá trị gửi lên + nhãn hiển thị. */
export interface FulfillmentOption {
  value: string;
  label: string;
}

/** Vị trí in hệ thống hỗ trợ, kèm khoá tương ứng phía nhà cung cấp. */
export interface PrintLocationOption {
  placement: PodDesignPlacement;
  providerKey: string;
}

/**
 * Lựa chọn cấu hình của MỘT tài khoản nhà cung cấp.
 *
 * 🔴 Giao diện không giữ bản sao nào của các danh sách này: thêm nhà cung cấp thứ hai chỉ cần
 * backend trả khác đi, không phải build lại web.
 */
export interface FulfillmentOptions {
  provider: FulfillmentProviderType;
  accountId: string;
  notice: string | null;
  shippingMethods: FulfillmentOption[];
  facilities: FulfillmentOption[];
  speedTypes: FulfillmentOption[];
  preferredCarriers: FulfillmentOption[];
  productionConfigs: FulfillmentOption[];
  productionLines: FulfillmentOption[];
  printLocations: PrintLocationOption[];
  warnings: string[];
}

/**
 * Khối trên màn hình Fulfill mà lỗi thuộc về — BACKEND quyết định (xem readiness service),
 * giao diện chỉ hiển thị đúng chỗ.
 */
export type FulfillmentIssueSection =
  | 'ORDER'
  | 'PROVIDER'
  | 'ADDRESS'
  /** Khối "Thiết lập Fulfill" — ô nhãn vận chuyển và nút lấy nhãn từ TikTok. */
  | 'SHIPPING'
  | 'MAPPING'
  | 'DESIGN';

export interface FulfillmentIssue {
  section: FulfillmentIssueSection;
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

/**
 * Một dòng hàng của đơn kèm ÁNH XẠ ĐÃ GHÉP (backend ghép, theo `Product ID + Seller SKU`).
 *
 * 🔴 Giao diện KHÔNG tự ghép nữa: trước đây nó tải một trang ánh xạ của cả tổ chức rồi tự
 * dò — tổ chức có nhiều ánh xạ hơn một trang là màn hình báo "chưa ánh xạ" cho sản phẩm đã
 * ánh xạ, rồi lưu đè và đâm vào ràng buộc UNIQUE của database.
 */
export interface FulfillmentStateItem {
  podOrderItemId: string;
  tiktokProductId: string | null;
  sellerSku: string | null;
  mapping: ProductMapping | null;
}

/**
 * Nhãn vận chuyển đang gắn với đơn — **đọc từ database**.
 *
 * 🔴 Không phải state của form: đây là thứ backend dùng để quyết định đơn có gửi được không,
 * nên giao diện phải hiển thị đúng nó chứ không phải giá trị người dùng đang gõ dở.
 */
export interface ShippingLabel {
  labelUrl: string;
  source: 'TIKTOK' | 'MANUAL';
  packageId: string | null;
  trackingNumber: string | null;
  shippingServiceName: string | null;
  obtainedAt: string | null;
  /** Lần lấy vừa rồi dùng LẠI gói đã có (không tạo gói mới). */
  reusedPackage?: boolean;
}

/** Một nhà cung cấp tổ chức được chọn khi gửi đơn. */
export interface FulfillmentAvailableProvider {
  id: string;
  name: string;
  provider: FulfillmentProviderType;
  isActive: boolean;
  /** Tài khoản DÙNG CHUNG do Super Admin khai — mọi tổ chức đọc cùng một danh mục. */
  isGlobal: boolean;
  /** Đang là nhà cung cấp gán sẵn cho kết nối TikTok của đơn (dữ liệu cũ). */
  isAssignedToAccount: boolean;
}

/** Nhà cung cấp nhìn từ khu vực quản trị NỀN TẢNG. */
export interface PlatformProvider {
  id: string;
  name: string;
  provider: FulfillmentProviderType;
  isActive: boolean;
  isGlobal: boolean;
  ownerOrganizationName: string | null;
  catalogues: number;
  products: number;
  variants: number;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  lastSyncAt: string | null;
}

export interface FulfillmentState {
  fulfillment: FulfillmentOrder | null;
  ready: boolean;
  issues: FulfillmentIssue[];
  canFulfill: boolean;
  canCancel: boolean;
  /** Nhà cung cấp gán cho kết nối TikTok của đơn. NULL = chưa cấu hình. */
  provider: FulfillmentStateProvider | null;
  /** Từng dòng hàng kèm ánh xạ đang áp dụng. */
  items: FulfillmentStateItem[];
  /**
   * Nhà cung cấp tổ chức được chọn cho đơn này (riêng của tổ chức + dùng chung, đang ACTIVE).
   *
   * 🔴 Giao diện dựng ô chọn từ đây — KHÔNG suy ra nhà cung cấp từ TikTok Account nữa.
   */
  availableProviders: FulfillmentAvailableProvider[];
  /** Nhãn vận chuyển đã lưu của đơn. `null` = chưa có. */
  shippingLabel: ShippingLabel | null;
  /**
   * `ADDRESS` = có địa chỉ người nhận đọc được ⇒ gửi như thường lệ.
   * `LABEL`   = địa chỉ không đọc được ⇒ đơn đi theo nhãn vận chuyển.
   */
  shippingMode: 'ADDRESS' | 'LABEL';
  /**
   * TikTok đang che thông tin người nhận ở những lần đồng bộ gần đây.
   *
   * 🔴 KHÔNG đồng nghĩa "không gửi được": hệ thống có thể vẫn giữ bản sao địa chỉ chụp trước
   * khi TikTok che. Điều kiện gửi do `canFulfill` + `issues` quyết định, không phải cờ này.
   */
  recipientMasked: boolean;
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
  /** ID line sản xuất của nhà cung cấp gắn cho sản phẩm này. NULL = dùng mặc định tài khoản. */
  productionLine: string | null;
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
  /** Tìm GẦN ĐÚNG trên toàn bộ danh mục (tên · SKU · id nhà cung cấp) — phía server. */
  search?: string;
  catalogueId?: string;
  /**
   * Tra CHÍNH XÁC một sản phẩm theo id phía nhà cung cấp.
   *
   * Dùng để dựng lại ô chọn của cấu hình đã lưu: sản phẩm đó gần như không bao giờ nằm ở
   * trang đầu, mà tải cả danh mục về chỉ để tìm một dòng thì không chấp nhận được.
   */
  externalProductId?: string;
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
  /** `production_config` của nhà cung cấp (vd default | large). */
  productionConfig?: string;
  /** ID line sản xuất (`GET /production-lines` → `items[].id`), KHÔNG phải tên hiển thị. */
  productionLine?: string;
  isActive?: boolean;
  note?: string;
}
