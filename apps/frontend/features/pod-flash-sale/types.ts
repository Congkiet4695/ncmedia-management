import type { Paginated, PaginationParams } from '@/types/api';

/**
 * Hợp đồng dữ liệu của module **Flash Sale** — khớp 1:1 với DTO của backend
 * (`apps/backend/src/modules/pod-flash-sale/dto/`).
 *
 * 🔴 Mọi giá tiền là **CHUỖI**, không phải `number`. Backend trả `Decimal` dưới dạng chuỗi
 * để không mất độ chính xác; chỉ đổi sang số ở đúng bước tính toán tại chỗ, không bao giờ
 * lưu lại dạng số rồi gửi ngược lên.
 */

export const POD_FLASH_SALE_STATUSES = [
  'DRAFT',
  'READY',
  'PUBLISHING',
  'RUNNING',
  'ENDED',
  'FAILED',
  'CANCELLED',
] as const;
export type PodFlashSaleStatus = (typeof POD_FLASH_SALE_STATUSES)[number];

export const POD_FLASH_SALE_ITEM_STATUSES = [
  'PENDING',
  'READY',
  'PUBLISHED',
  'FAILED',
  'REMOVED',
] as const;
export type PodFlashSaleItemStatus = (typeof POD_FLASH_SALE_ITEM_STATUSES)[number];

export type PodFlashSaleProductLevel = 'PRODUCT' | 'VARIATION';

/** `-1` = không giới hạn. Dùng hằng số thay vì rải số ma thuật khắp giao diện. */
export const FLASH_SALE_UNLIMITED = -1;
/** Dải giới hạn mua TikTok cho phép, ngoài giá trị `-1`. */
export const FLASH_SALE_MIN_QUANTITY = 1;
export const FLASH_SALE_MAX_QUANTITY = 99;
/** TikTok giới hạn `title` 50 ký tự và yêu cầu duy nhất trong shop. */
export const FLASH_SALE_MAX_NAME_LENGTH = 50;
/**
 * Số dòng tối đa của MỘT đợt Flash Sale — trần LỰA CHỌN của hệ thống.
 *
 * 🔴 **Không phải trần của TikTok.** TikTok giới hạn 300 mục cho mỗi *request* Update
 * Activity Products, không giới hạn tổng số SKU của một hoạt động khuyến mãi. Backend chia
 * 10.000 SKU thành 34 lượt gọi và gắn tất cả vào CÙNG MỘT hoạt động — nên giao diện không
 * được chặn ở 300. Con số 300 không xuất hiện ở frontend, và không nên xuất hiện.
 *
 * Giữ khớp với `FLASH_SALE_MAX_ITEMS` phía backend (nơi kiểm tra có thẩm quyền).
 */
export const FLASH_SALE_MAX_ITEMS = 10_000;
/** Số dòng tối thiểu để bấm Publish. */
export const FLASH_SALE_MIN_ITEMS = 1;
/**
 * Số dòng tối đa gửi trong MỘT request "Add Products".
 *
 * Trần kích thước request, không phải trần lựa chọn: chọn nhiều hơn thì giao diện tự chia
 * thành nhiều lượt gọi (xem `addItemsInChunks`).
 */
export const FLASH_SALE_MAX_ADD_PER_CALL = 1_000;

export interface PodFlashSaleShopRef {
  id: string;
  name: string;
  region: string;
}

export interface PodFlashSaleUserRef {
  id: string;
  fullName: string;
}

export interface PodFlashSaleListItem {
  id: string;
  name: string;
  description: string | null;
  status: PodFlashSaleStatus;
  productLevel: PodFlashSaleProductLevel;
  provider: string;
  providerFlashSaleId: string | null;
  providerStatus: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  itemCount: number;
  shop: PodFlashSaleShopRef;
  accountId: string;
  accountName: string | null;
  createdByUser: PodFlashSaleUserRef | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryCount: number;
  publishedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Đợt này có cần tự làm mới không (PUBLISHING / RUNNING).
   *
   * 🔴 Do BACKEND quyết định và trả kèm, không phải frontend tự đoán từ `status`. Đổi luật
   * chỉ sửa một chỗ, và hai tầng không bao giờ lệch nhau.
   */
  live: boolean;
}

export interface PodFlashSaleItem {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string | null;
  variantName: string | null;
  imageUrl: string | null;
  skuId: string | null;
  providerProductId: string | null;
  providerVariantId: string | null;
  providerSkuId: string | null;
  originalPrice: string;
  flashSalePrice: string;
  discountPercent: string;
  currency: string | null;
  totalPurchaseLimit: number;
  customerPurchaseLimit: number;
  status: PodFlashSaleItemStatus;
  errorCode: string | null;
  error: string | null;
  sortOrder: number;
}

export interface PodFlashSaleIssue {
  level: 'ERROR' | 'WARNING';
  code: string;
  field: string;
  message: string;
  itemId?: string | null;
}

export interface PodFlashSaleValidation {
  flashSaleId: string;
  ok: boolean;
  issues: PodFlashSaleIssue[];
  readyItems: number;
}

export interface PodFlashSaleItemCounts {
  TOTAL: number;
  PENDING: number;
  READY: number;
  PUBLISHED: number;
  FAILED: number;
  REMOVED: number;
}

export interface PodFlashSaleDetail extends PodFlashSaleListItem {
  /**
   * 🔴 Chỉ ID sản phẩm, KHÔNG kèm dòng. Bảng sản phẩm đọc từ endpoint phân trang riêng
   * (`useFlashSaleProducts`); trả cả 10.000 dòng ở đây là vài MB cho mỗi lần tải màn hình
   * và cho mỗi lần ghi.
   */
  productIds: string[];
  currency: string | null;
  counts: PodFlashSaleItemCounts;
  validation: PodFlashSaleValidation;
  editable: boolean;
  publishable: boolean;
  cancellable: boolean;
}

export interface PodFlashSaleLog {
  id: string;
  action: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
  request: unknown;
  response: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  attempt: number;
  createdAt: string;
}

export interface PodFlashSaleTemplateItem {
  productId: string | null;
  variantId: string | null;
  skuId: string | null;
  providerProductId: string | null;
  providerVariantId: string | null;
  productTitle: string | null;
  variantName: string | null;
  flashSalePrice: string | null;
  discountPercent: string;
  totalPurchaseLimit: number;
  customerPurchaseLimit: number;
}

export interface PodFlashSaleTemplate {
  id: string;
  name: string;
  description: string | null;
  accountId: string;
  shop: PodFlashSaleShopRef;
  productLevel: PodFlashSaleProductLevel;
  itemCount: number;
  items: PodFlashSaleTemplateItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PodFlashSalePublishResult {
  flashSaleId: string;
  /** `PUBLISHING` = hoạt động đã tạo, các lô đang được gửi nền. Theo dõi qua publish-status. */
  status: PodFlashSaleStatus;
  /** `activity_id` — có NGAY, mọi lô đều gắn vào đúng id này. */
  providerFlashSaleId: string | null;
  publishedItems: number;
  skippedItems: number;
  errorCode: string | null;
  errorMessage: string | null;
  totalItems: number;
  /** Mỗi lô là MỘT request tới TikTok, tối đa 300 SKU. */
  totalBatches: number;
  doneBatches: number;
}

// ---------------------------------------------------------------------------
// Payload gửi lên
// ---------------------------------------------------------------------------

export interface PodFlashSaleQuery extends PaginationParams {
  search?: string;
  status?: PodFlashSaleStatus | '';
  shopId?: string;
  accountId?: string;
  startFrom?: string;
  startTo?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'status' | 'startAt' | 'endAt' | 'itemCount';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateFlashSalePayload {
  shopId: string;
  name: string;
  description?: string;
  startAt: string;
  endAt: string;
  timezone?: string;
  productLevel?: PodFlashSaleProductLevel;
  templateId?: string;
}

export interface UpdateFlashSalePayload {
  name?: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  timezone?: string;
  productLevel?: PodFlashSaleProductLevel;
}

export interface DuplicateFlashSalePayload {
  name?: string;
  startAt?: string;
  endAt?: string;
  shopId?: string;
}

export interface AddFlashSaleItemPayload {
  productId: string;
  variantId?: string;
  flashSalePrice?: number;
  discountPercent?: number;
  totalPurchaseLimit?: number;
  customerPurchaseLimit?: number;
}

export interface UpdateFlashSaleItemPayload {
  flashSalePrice?: number;
  discountPercent?: number;
  totalPurchaseLimit?: number;
  customerPurchaseLimit?: number;
}

export interface BatchUpdateFlashSaleItemsPayload extends UpdateFlashSaleItemPayload {
  itemIds: string[];
}

export interface SaveFlashSaleTemplatePayload {
  name: string;
  description?: string;
}

export interface ApplyFlashSaleTemplatePayload {
  name: string;
  startAt: string;
  endAt: string;
  timezone?: string;
  shopId?: string;
}

export interface PodFlashSaleTemplateQuery extends PaginationParams {
  search?: string;
  shopId?: string;
  accountId?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export type PodFlashSaleListResult = Paginated<PodFlashSaleListItem>;
export type PodFlashSaleLogResult = Paginated<PodFlashSaleLog>;
export type PodFlashSaleTemplateResult = Paginated<PodFlashSaleTemplate>;

/**
 * Tiến độ lượt publish — trả bởi `GET /pod/flash-sales/:id/publish-status`.
 *
 * 🔴 Đây là SỰ THẬT của backend, không phải thanh tiến trình tự chạy ở trình duyệt.
 * `doneBatches/totalBatches` là số lô đã thực sự được TikTok nhận.
 */
export interface PodFlashSalePublishStatus {
  flashSaleId: string;
  status: PodFlashSaleStatus;
  providerFlashSaleId: string | null;
  /** Còn đang chạy ⇒ tiếp tục hỏi lại. */
  live: boolean;
  totalItems: number | null;
  totalBatches: number | null;
  doneBatches: number | null;
  currentBatch: number | null;
  /** Khác null ⇒ đợt sale KHÔNG hoàn tất, còn lô chưa gửi. */
  failedBatch: number | null;
  publishedItems: number;
  pendingItems: number;
  errorCode: string | null;
  errorMessage: string | null;
  errorRequestId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * MỘT sản phẩm trong đợt sale, kèm các dòng SKU của nó.
 *
 * 🔴 Đây là ĐƠN VỊ PHÂN TRANG của bảng sản phẩm. Sản phẩm là thứ người vận hành thêm vào và
 * gỡ ra; SKU chỉ là chi tiết bên trong. Phân trang theo SKU sẽ cắt đôi một sản phẩm giữa hai
 * trang — "Black / S" ở trang 1, "Black / M" ở trang 2.
 */
export interface PodFlashSaleProductGroup {
  productId: string;
  productTitle: string | null;
  providerProductId: string | null;
  imageUrl: string | null;
  /** Mức VARIATION: mọi SKU. Mức PRODUCT: đúng MỘT dòng (`variantId = null`). */
  items: PodFlashSaleItem[];
  itemCount: number;
}

export interface PodFlashSaleProductQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface PodFlashSaleProductResult {
  items: PodFlashSaleProductGroup[];
  /** 🔴 `total` là số SẢN PHẨM, không phải số SKU. */
  meta: { total: number; page: number; limit: number; totalPages: number };
  /** Tổng số dòng SKU của cả đợt sale (mọi trang). */
  totalItems: number;
}
