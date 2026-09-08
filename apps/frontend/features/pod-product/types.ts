import type { Paginated, PaginationParams } from '@/types/api';

/**
 * Trạng thái sản phẩm phía TikTok được để dạng CHUỖI TỰ DO (không phải union).
 *
 * 🔴 TikTok bổ sung giá trị mới bất cứ lúc nào (ACTIVATE, DRAFT, DEACTIVATED, FREEZE…).
 * Khoá cứng danh sách ở frontend sẽ khiến sản phẩm mang trạng thái mới bị hiển thị sai
 * hoặc bị lọc mất; danh sách trạng thái thật lấy từ endpoint `filters`.
 */
export type PodProductStatus = string;

export interface PodProductListItem {
  id: string;
  tiktokProductId: string;
  title: string | null;
  status: PodProductStatus | null;
  auditStatus: string | null;
  thumbnailUrl: string | null;
  categoryName: string | null;
  brandName: string | null;
  skuCount: number;
  totalInventory: number;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
  shopName: string | null;
  accountName: string | null;
  tiktokUpdatedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface PodProductVariant {
  id: string;
  tiktokSkuId: string;
  sellerSku: string | null;
  variantName: string | null;
  salePrice: string | null;
  listPrice: string | null;
  currency: string | null;
  inventoryTotal: number;
  status: string | null;
  imageUrl: string | null;
}

export interface PodProductImage {
  id: string;
  url: string | null;
  thumbUrl: string | null;
  uri: string | null;
  /** NULL = ảnh chính của sản phẩm; có giá trị = ảnh của một biến thể. */
  variantId: string | null;
  sortOrder: number;
}

export interface PodProductVideo {
  id: string;
  url: string | null;
  coverUrl: string | null;
  format: string | null;
}

export interface PodProductAttribute {
  id: string;
  tiktokAttributeId: string;
  name: string | null;
  values: string[];
}

export interface PodProductDetail extends PodProductListItem {
  description: string | null;
  categoryPath: string | null;
  packageWeight: string | null;
  weightUnit: string | null;
  packageDimensions: string | null;
  productTags: string[];
  salesRegions: string[];
  variants: PodProductVariant[];
  images: PodProductImage[];
  videos: PodProductVideo[];
  attributes: PodProductAttribute[];
}

export type PodProductListResult = Paginated<PodProductListItem>;

export const POD_PRODUCT_SORT_FIELDS = [
  'createdAt',
  'title',
  'status',
  'skuCount',
  'minPrice',
  'totalInventory',
  'tiktokUpdatedAt',
  'lastSyncedAt',
] as const;
export type PodProductSortField = (typeof POD_PRODUCT_SORT_FIELDS)[number];

export interface PodProductQuery extends PaginationParams {
  /** Khớp Tên sản phẩm · TikTok Product ID · Seller SKU. */
  search?: string;
  accountId?: string;
  shopId?: string;
  status?: string;
  categoryId?: string;
  brandId?: string;
  sortBy?: PodProductSortField;
  sortOrder?: 'asc' | 'desc';
}

/** Giá trị cho các dropdown lọc — chỉ gồm thứ ĐANG có sản phẩm. */
export interface PodProductFilterOptions {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  statuses: string[];
  shops: Array<{ id: string; name: string }>;
}

export interface PodProductSyncPayload {
  shopId?: string;
  accountId?: string;
  /** Quét lại toàn bộ, bỏ qua watermark — tốn quota TikTok. */
  full?: boolean;
}

/** Một shop chạy hỏng — giữ nguyên văn lỗi TikTok để hiện cho người vận hành. */
export interface PodProductSyncShopError {
  shopId: string;
  shopName: string;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface PodProductSyncResult {
  shopsProcessed: number;
  shopsFailed: number;
  /** Số shop bị bỏ qua vì đang có lượt đồng bộ khác chạy. */
  shopsBusy: number;
  /** Số sản phẩm ĐANG BÁN (ACTIVATE) TikTok trả về. */
  productsFetched: number;
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  productsFailed: number;
  /** Số sản phẩm bị đánh dấu ngừng bán (chỉ ở lượt quét toàn bộ). */
  productsDeactivated: number;
  errors: PodProductSyncShopError[];
  historyIds: string[];
}

export interface PodProductSyncHistoryItem {
  id: string;
  scope: string;
  trigger: string;
  status: string;
  shopName: string | null;
  accountName: string | null;
  productsFetched: number;
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  productsFailed: number;
  /** Số sản phẩm bị đánh dấu ngừng bán trong lượt (chỉ ở lượt quét toàn bộ). */
  productsDeactivated: number;
  apiCalls: number;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export type PodProductSyncHistoryResult = Paginated<PodProductSyncHistoryItem>;
