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
/** Số dòng tối đa của một đợt (trần một lần gọi của TikTok). */
export const FLASH_SALE_MAX_ITEMS = 300;

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
  items: PodFlashSaleItem[];
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
  status: PodFlashSaleStatus;
  providerFlashSaleId: string | null;
  publishedItems: number;
  skippedItems: number;
  errorCode: string | null;
  errorMessage: string | null;
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
