import type { Paginated, PaginationParams } from '@/types/api';

/** Trạng thái đơn của TikTok (Order API overview). */
export const POD_ORDER_STATUSES = [
  'UNPAID',
  'ON_HOLD',
  'AWAITING_SHIPMENT',
  'PARTIALLY_SHIPPING',
  'AWAITING_COLLECTION',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type PodOrderStatus = (typeof POD_ORDER_STATUSES)[number];

export const POD_SYNC_STATUSES = ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
export type PodSyncStatus = (typeof POD_SYNC_STATUSES)[number];

export const POD_SYNC_TRIGGERS = ['CRON', 'MANUAL', 'BACKFILL'] as const;
export type PodSyncTrigger = (typeof POD_SYNC_TRIGGERS)[number];

/** Loại đồng bộ theo shop có trạng thái riêng (một dòng mỗi shop mỗi loại). */
export type PodShopSyncType = 'ORDER' | 'PRODUCT';

/** Vị trí in design. Backend hỗ trợ sẵn 5 vị trí; UI hiện dùng FRONT/BACK. */
export const POD_DESIGN_PLACEMENTS = ['FRONT', 'BACK', 'LEFT', 'RIGHT', 'SLEEVE'] as const;
export type PodDesignPlacement = (typeof POD_DESIGN_PLACEMENTS)[number];

/** Vị trí in đang bật ở giai đoạn này (khớp POD_ACTIVE_PLACEMENTS của backend). */
export const POD_ACTIVE_PLACEMENTS: PodDesignPlacement[] = ['FRONT', 'BACK'];

/** Một file design đã upload cho sản phẩm. */
/** Tiền thu về của đơn — do backend lấy từ TikTok Finance (không tính ở giao diện). */
export interface PodOrderProceeds {
  /** SETTLED: đã quyết toán · ESTIMATED: chưa quyết toán (est_settlement_amount). */
  source: 'SETTLED' | 'ESTIMATED';
  currency: string;
  amount: number;
  revenueAmount: number | null;
  feeTaxAmount: number | null;
  shippingCostAmount: number | null;
  adjustmentAmount: number | null;
  /** Breakdown NGUYÊN VĂN của TikTok (field → số tiền dạng chuỗi, có thể lồng một cấp). */
  revenueBreakdown: FinanceBreakdown | null;
  feeTaxBreakdown: FinanceBreakdown | null;
  shippingCostBreakdown: FinanceBreakdown | null;
  transactionCount: number;
  estimatedSettlement: string | null;
  unsettledReason: string | null;
}

export type FinanceBreakdown = { [field: string]: string | FinanceBreakdown | undefined };

/** Vì sao chưa tính được lợi nhuận (OK = đã tính). */
export type PodOrderFinancialsStatus =
  | 'OK'
  | 'NO_PROCEEDS'
  | 'NO_COST'
  | 'COST_PENDING'
  | 'COST_CURRENCY_UNKNOWN'
  | 'CURRENCY_MISMATCH';

/** Tài chính của đơn cho cột Giá — backend đã tính (profit = proceeds − base cost). */
export interface PodOrderFinancials {
  proceeds: PodOrderProceeds | null;
  /** Base cost = product cost của lần fulfill đang hiệu lực. */
  productCost: number | null;
  productCostConfirmed: boolean;
  costCurrency: string | null;
  fulfilledBy: string | null;
  profit: number | null;
  /** Tỉ lệ (0.25 = 25%) = profit ÷ proceeds. */
  margin: number | null;
  status: PodOrderFinancialsStatus;
}

export interface PodDesign {
  id: string;
  placement: PodDesignPlacement;
  /** UPLOAD: file upload lên kho lưu trữ · URL: URL công khai nhập trực tiếp (không upload lại). */
  source: 'UPLOAD' | 'URL';
  fileUrl: string;
  fileName: string;
  /** NULL với nguồn URL (hệ thống không tải file về). */
  mimeType: string | null;
  fileSize: number | null;
  version: number;
  uploadedAt: string;
  uploadedByName: string | null;
}

/** Preset lọc theo Ngày đặt đơn — backend quy đổi theo múi giờ vận hành. */
export const POD_DATE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'ALL',
  'CUSTOM',
] as const;
export type PodDatePreset = (typeof POD_DATE_PRESETS)[number];

/** Nhãn hiển thị nằm ở `i18n/locales/<lang>/common.json` (khoá `date.preset.*`). */

export type PodItemMappingStatus = 'MAPPED' | 'NEED_MANUAL' | 'MISSING' | 'NO_PROVIDER';

/** Một ứng viên do ánh xạ tự động tìm được — đủ dữ liệu để dialog chọn sẵn. */
export interface PodMappingCandidate {
  productId: string;
  externalProductId: string;
  productName: string;
  variantId: string;
  externalVariantId: string;
  sku: string;
  variantName: string;
  catalogueId: string | null;
  catalogueName: string | null;
}

export interface PodOrderItem {
  id: string;
  tiktokLineItemId: string;
  productId: string | null;
  productName: string | null;
  skuId: string | null;
  skuName: string | null;
  sellerSku: string | null;
  /**
   * `line_items[].sku_image` — ảnh của BIẾN THỂ khách đặt (dữ liệu thô TikTok).
   *
   * ⚠️ KHÔNG dùng làm thumbnail sản phẩm — dùng `productImage`. Giữ lại vì nó tham gia khoá
   * gộp dòng: hai biến thể khác nhau của cùng một sản phẩm phải là hai dòng riêng.
   */
  skuImage: string | null;
  /** **Ảnh CHÍNH của sản phẩm** — nguồn sự thật cho thumbnail. `null` ⇒ hiện ô trống. */
  productImage: string | null;
  /** Ảnh chính cỡ đầy đủ — dùng khi mở bộ xem ảnh. */
  productImageFull: string | null;
  salePrice: number | null;
  originalPrice: number | null;
  currency: string | null;
  displayStatus: string | null;
  packageStatus: string | null;
  packageId: string | null;
  trackingNumber: string | null;
  shippingProviderName: string | null;
  cancelReason: string | null;
  isPodCustomized: boolean;
  podInfoId: string | null;
  /**
   * Product Mapping đã ghép với sản phẩm này.
   *
   * 🔴 Design nay thuộc **Product Mapping**, không thuộc đơn — nên nút Upload/Delete phải gọi
   * vào mapping này. `null` = chưa khai ánh xạ ⇒ hiển thị "thiếu Product Mapping", KHÔNG phải
   * "thiếu design" (hai lỗi khác nhau, hai chỗ sửa khác nhau).
   */
  mappingId: string | null;
  /**
   * Tình trạng ánh xạ — bốn trạng thái dẫn tới bốn hành động khác nhau.
   *
   * `MAPPED`      đã có Product Mapping, không phải làm gì
   * `NEED_MANUAL` máy tìm được NHIỀU ứng viên nên không dám tự chọn ⇒ bấm "Map Product",
   *               danh sách đã lọc sẵn ở `mappingCandidates`
   * `MISSING`     đã rà và không thấy gì (hoặc chưa rà) ⇒ phải khai tay
   * `NO_PROVIDER` kết nối TikTok chưa gán nhà cung cấp, hoặc danh mục chưa đồng bộ lần nào
   *               ⇒ sửa ở màn hình cấu hình nhà cung cấp, KHÔNG phải ở đây
   */
  mappingStatus: PodItemMappingStatus;
  /** Ứng viên máy tìm được. Chỉ có giá trị khi `NEED_MANUAL`. */
  mappingCandidates: PodMappingCandidate[];
  isGift: boolean;
  /** TikTok trả 1 line item = 1 đơn vị sản phẩm nên luôn bằng 1. */
  quantity: number;
  productCategory: string | null;
  designs: PodDesign[];
}

export interface PodOrderPackage {
  id: string;
  tiktokPackageId: string;
}

export interface PodOrderShop {
  id: string;
  /** Tên gian hàng TikTok trả về. */
  name: string;
  /** Tên KẾT NỐI do người vận hành đặt — thông tin định danh chính trên giao diện. */
  connectionName: string;
  tiktokShopId: string;
  region: string;
}

/** Chi tiết đơn. Thông tin người nhận KHÔNG được trả về (PII đã mã hoá phía backend). */
export interface PodOrder {
  id: string;
  tiktokOrderId: string;
  status: PodOrderStatus;
  shop: PodOrderShop;
  accountName: string;
  /**
   * Nhà cung cấp fulfillment gán cho kết nối TikTok của đơn.
   * Dùng để mở dialog "Map Product" với nhà cung cấp điền sẵn — không bắt người dùng đoán.
   * NULL = kết nối chưa gán nhà cung cấp ⇒ không thể khai ánh xạ từ đây.
   */
  fulfillmentAccountId: string | null;
  /** Seller phụ trách — suy ra từ Account sở hữu đơn. */
  sellerId: string | null;
  sellerFullName: string | null;
  sellerEmail: string | null;
  buyerEmail: string | null;
  buyerNickname: string | null;
  buyerMessage: string | null;
  sellerNote: string | null;
  currency: string | null;
  totalAmount: number | null;
  subTotal: number | null;
  shippingFee: number | null;
  tax: number | null;
  sellerDiscount: number | null;
  platformDiscount: number | null;
  fulfillmentType: string | null;
  shippingType: string | null;
  trackingNumber: string | null;
  shippingProvider: string | null;
  cancelReason: string | null;
  cancellationInitiator: string | null;
  isBuyerRequestCancel: boolean;
  orderType: string | null;
  isOnHoldOrder: boolean;
  hasPodItem: boolean;
  recipientMasked: boolean;
  recipientRegionCode: string | null;
  recipientPostalCode: string | null;
  orderedAt: string;
  tiktokUpdatedAt: string;
  paidTime: string | null;
  rtsSlaTime: string | null;
  lastSyncedAt: string;
  syncVersion: number;
  items: PodOrderItem[];
  packages: PodOrderPackage[];
  createdAt: string;
  updatedAt: string;
}

export interface PodOrderListItem {
  id: string;
  tiktokOrderId: string;
  /** Tên KẾT NỐI do người vận hành đặt — thông tin định danh chính. */
  connectionName: string;
  /** Tên gian hàng TikTok trả về — giữ để đối chiếu với Seller Center. */
  shopName: string | null;
  /** Kết nối TikTok sở hữu đơn — dùng để mở thẳng trang kết nối. */
  accountId: string;
  /**
   * Nhà cung cấp fulfillment gán cho kết nối TikTok của đơn.
   * Dùng để mở dialog "Map Product" với nhà cung cấp điền sẵn — không bắt người dùng đoán.
   * NULL = kết nối chưa gán nhà cung cấp ⇒ không thể khai ánh xạ từ đây.
   */
  fulfillmentAccountId: string | null;
  /** Seller phụ trách — suy ra từ Account sở hữu đơn, KHÔNG lưu trên đơn. */
  sellerId: string | null;
  sellerFullName: string | null;
  sellerEmail: string | null;
  buyer: string | null;
  status: PodOrderStatus;
  totalAmount: number | null;
  currency: string | null;
  subTotal: number | null;
  shippingFee: number | null;
  tax: number | null;
  sellerDiscount: number | null;
  platformDiscount: number | null;
  financials: PodOrderFinancials;
  orderType: string | null;
  hasPodItem: boolean;
  itemCount: number;
  trackingNumber: string | null;
  createdTime: string;
  updatedTime: string;
  lastSync: string;
  /** Sản phẩm của đơn (kèm design) — hiển thị trực tiếp ở danh sách. */
  items: PodOrderItem[];
}

export type PodOrderListResult = Paginated<PodOrderListItem>;

export interface PodOrderQuery extends PaginationParams {
  search?: string;
  datePreset?: PodDatePreset;
  status?: PodOrderStatus;
  shopId?: string;
  accountId?: string;
  orderType?: string;
  hasPodItem?: boolean;
  /**
   * `true` = MỌI sản phẩm trong đơn đã có file in; `false` = còn ít nhất một sản phẩm thiếu.
   *
   * 🔴 Đúng quy tắc mà backend dùng để quyết định đơn có gửi sản xuất được không — không
   * phải "có ít nhất một sản phẩm đã có design". Một đơn 3 sản phẩm mới upload 1 file vẫn là
   * "chưa có design", vì bấm Fulfill sẽ bị từ chối với `DESIGN_MISSING`.
   */
  hasDesign?: boolean;
  /** `false` = chưa đẩy sang xưởng in (chưa có bản ghi, hoặc còn ở DRAFT/FAILED). */
  pushedToFulfillment?: boolean;
  /**
   * ID **Employee** phụ trách. Chỉ người có `pod.shop.all` dùng được — backend trả 403 cho
   * người khác, không phụ thuộc việc giao diện có ẩn ô chọn hay không.
   */
  sellerId?: string;
  orderedFrom?: string;
  orderedTo?: string;
  sortBy?: 'orderedAt' | 'tiktokUpdatedAt' | 'totalAmount' | 'status' | 'lastSyncedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface PodOrderStats {
  total: number;
  byStatus: Record<string, number>;
}

/**
 * Latest Sync Status — trạng thái lần đồng bộ GẦN NHẤT của một shop (không phải lịch sử).
 * `GET /pod/tiktok/sync-status` (đơn) · `GET /pod/products/sync-status` (sản phẩm).
 */
export interface PodShopSyncStatus {
  shopId: string;
  shopName: string | null;
  accountName: string | null;
  syncType: PodShopSyncType;
  trigger: PodSyncTrigger;
  status: PodSyncStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  /** ORDER: số đơn đã xử lý · PRODUCT: số sản phẩm đã lấy về. */
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Chỉ số chẩn đoán riêng từng loại (phase, số trang, số lần gọi API, request id…). */
  details: Record<string, unknown> | null;
  updatedAt: string;
}

/** Payload kích hoạt đồng bộ thủ công. */
export interface TriggerSyncPayload {
  shopId?: string;
  lookbackMinutes?: number;
  force?: boolean;
  /** Kéo lại TOÀN BỘ lịch sử đơn theo create_time. An toàn để chạy lại (không tạo đơn trùng). */
  backfill?: boolean;
}

export interface SyncTriggerResult {
  shopsTotal: number;
  shopsSucceeded: number;
  shopsFailed: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  ordersFailed: number;
  durationMs: number;
  skippedByLock: boolean;
}
