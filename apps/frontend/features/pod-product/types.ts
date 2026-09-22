import type { Paginated, PaginationParams } from '@/types/api';

/**
 * Trạng thái sản phẩm phía TikTok được để dạng CHUỖI TỰ DO (không phải union).
 *
 * 🔴 TikTok bổ sung giá trị mới bất cứ lúc nào (ACTIVATE, DRAFT, DEACTIVATED, FREEZE…).
 * Khoá cứng danh sách ở frontend sẽ khiến sản phẩm mang trạng thái mới bị hiển thị sai
 * hoặc bị lọc mất; danh sách trạng thái thật lấy từ endpoint `filters`.
 */
export type PodProductStatus = string;

/** Một ảnh trong dải thumbnail của dòng danh sách (bản rút gọn của `PodProductImage`). */
export interface PodProductListImage {
  url: string | null;
  thumbUrl: string | null;
}

export interface PodProductListItem {
  id: string;
  tiktokProductId: string;
  title: string | null;
  status: PodProductStatus | null;
  auditStatus: string | null;
  thumbnailUrl: string | null;
  /**
   * Vài ảnh CHÍNH đầu tiên (backend đã cắt). Số ảnh thật nằm ở `imageCount` — phần chênh
   * lệch được hiển thị bằng chỉ báo `+N`, KHÔNG gọi thêm API để lấy nốt.
   */
  mainImages: PodProductListImage[];
  imageCount: number;
  categoryName: string | null;
  brandName: string | null;
  skuCount: number;
  totalInventory: number;
  minPrice: string | null;
  maxPrice: string | null;
  currency: string | null;
  /** Seller SKU của biến thể đầu tiên — mã đại diện, `skuCount` cho biết còn bao nhiêu nữa. */
  sellerSku: string | null;
  /**
   * Hạng chất lượng listing do TikTok chấm: `POOR` | `FAIR` | `GOOD`.
   *
   * 🔴 Để dạng chuỗi tự do và KHÔNG tính lại ở frontend — đây là số liệu của sàn, chỉ có ở
   * thị trường US. `null` = TikTok không trả về (thị trường khác, hoặc chưa đồng bộ lại).
   */
  listingQualityTier: string | null;
  /** Shop sở hữu sản phẩm (UUID nội bộ) — dialog Nhân bản loại shop này khỏi danh sách đích. */
  shopId: string;
  shopName: string | null;
  /** Mã shop hiển thị ở Seller Center — người vận hành đối soát bằng mã này. */
  shopCode: string | null;
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

/** Bảng size của sản phẩm — ảnh tải lên HOẶC bảng size mẫu của TikTok. */
export interface PodProductSizeChart {
  /** `uri` phía TikTok — thứ duy nhất gửi lại được khi sửa. */
  uri: string | null;
  /** Link xem. Có hạn dùng, KHÔNG dùng để so sánh. */
  url: string | null;
  templateId: string | null;
}

export interface PodProductDetail extends PodProductListItem {
  description: string | null;
  categoryPath: string | null;
  /** `category_id` phía TikTok — dùng để biết một Category Template có cùng danh mục không. */
  tiktokCategoryId: string | null;
  tiktokBrandId: string | null;
  searchTerms: string[];
  highlights: string[];
  sizeChart: PodProductSizeChart | null;
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

/**
 * Lọc theo Flash Sale trong khoảng thời gian (bộ chọn sản phẩm cho đợt sale):
 * RUNNING = có đợt đang lên sàn giao với khoảng chọn · NOT_RUNNING = không có.
 */
export const POD_PRODUCT_FLASH_SALE_FILTERS = ['ALL', 'RUNNING', 'NOT_RUNNING'] as const;
export type PodProductFlashSaleFilter = (typeof POD_PRODUCT_FLASH_SALE_FILTERS)[number];

export interface PodProductQuery extends PaginationParams {
  /** Khớp Tên sản phẩm · TikTok Product ID · Seller SKU. */
  search?: string;
  accountId?: string;
  shopId?: string;
  status?: string;
  categoryId?: string;
  brandId?: string;
  flashSale?: PodProductFlashSaleFilter;
  /** Mốc ISO/UTC — đã quy đổi từ giờ treo tường theo múi giờ của đợt sale. */
  flashSaleFrom?: string;
  flashSaleTo?: string;
  /** Đợt sale đang mở — không tính chính nó. */
  excludeFlashSaleId?: string;
  sortBy?: PodProductSortField;
  sortOrder?: 'asc' | 'desc';
}

/** Giá trị cho các dropdown lọc — chỉ gồm thứ ĐANG có sản phẩm. */
export interface PodProductFilterOptions {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  statuses: string[];
  /**
   * 🔴 `connectionName` là NHÃN hiển thị (tên kết nối do người vận hành đặt), `name` là tên
   * gian hàng TikTok trả về. Dropdown chọn shop dùng `connectionName`; `id` vẫn là giá trị
   * gửi lên server. Xem `shopOptionLabel`.
   */
  shops: Array<{ id: string; name: string; connectionName: string; region?: string | null }>;
}

/** Một dòng SKU cần sửa. `tiktokSkuId` là cách TikTok biết sửa biến thể nào. */
export interface UpdatePodProductSku {
  tiktokSkuId: string;
  sellerSku?: string;
  salePrice?: string;
  listPrice?: string;
  quantity?: number;
  /** Kho nhận tồn kho mới. Thiếu ⇒ backend BỎ QUA phần tồn kho, không đoán. */
  warehouseId?: string;
}

/**
 * Sửa sản phẩm đang bán — ánh xạ sang **Partial Edit Product** của TikTok.
 *
 * 🔴 Trường vắng mặt = KHÔNG đụng tới; chuỗi rỗng mới là "xoá". Form chỉ gửi những gì người
 * dùng thật sự sửa, và backend còn diff thêm một lần nữa với dữ liệu đã đồng bộ.
 *
 * 🔴 KHÔNG có `categoryId`: TikTok không cho đổi danh mục của sản phẩm đã tạo.
 */
/** Một tấm ảnh gửi lên khi sửa: ảnh TikTok đã có (`uri`) hoặc file vừa tải lên (`fileId`). */
export interface UpdatePodProductImage {
  uri?: string;
  fileId?: string;
}

export interface UpdatePodProductPayload {
  title?: string;
  description?: string;
  searchTerms?: string[];
  highlights?: string[];
  brandId?: string;
  package?: {
    weight?: string;
    weightUnit?: string;
    length?: string;
    width?: string;
    height?: string;
    dimensionUnit?: string;
  };
  /**
   * Bộ ảnh sản phẩm SAU khi sửa — đầy đủ và đúng thứ tự, tấm đầu là ảnh đại diện.
   *
   * 🔴 TikTok THAY cả bộ ảnh bằng mảng này. Đây không phải danh sách ảnh thêm vào: gửi 2 tấm
   * cho sản phẩm đang có 7 tấm là xoá 5 tấm còn lại.
   */
  mainImages?: UpdatePodProductImage[];
  /** Bảng size mới. Chỉ gửi khi người dùng thật sự chọn tấm khác. */
  sizeChart?: { fileId?: string; uri?: string; templateId?: string };
  /** Video mới — file trong Storage Module, backend đẩy lên TikTok để lấy `id`. */
  video?: { fileId: string };
  skus?: UpdatePodProductSku[];
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

/**
 * Một dòng SKU trong bộ chọn Flash Sale (`GET /pod/products/variants`).
 *
 * 🔴 Hẹp có chủ đích: bộ chọn có thể hiển thị hàng nghìn dòng, mỗi cột thừa là băng thông
 * thật. Không mang `inventory`, `salesAttributes` hay kích thước.
 */
export interface PodProductVariantOption {
  id: string;
  productId: string;
  productTitle: string | null;
  variantName: string | null;
  sellerSku: string | null;
  tiktokSkuId: string;
  /** Giá gốc backend sẽ dùng để tính giá deal: `salePrice`, lùi về `listPrice`. */
  originalPrice: number | null;
  currency: string | null;
  imageUrl: string | null;
  status: string | null;
}

export interface PodProductVariantQuery {
  page?: number;
  limit?: number;
  search?: string;
  shopId?: string;
  productId?: string;
}

export interface PodProductVariantListResult {
  items: PodProductVariantOption[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Kết quả xoá sản phẩm — `id` để gỡ đúng dòng khỏi bảng. */
export interface PodProductDeleteResult {
  id: string;
  tiktokProductId: string;
  deletedOnTiktok: boolean;
}

/**
 * Nhân bản MỘT sản phẩm sang NHIỀU shop.
 *
 * 🔴 Chỉ có danh sách shop đích. Sản phẩm nguồn nằm trên URL; `organizationId` / người gọi /
 * shop nguồn do backend lấy từ JWT + bản ghi — client không gửi và backend không tin.
 */
export interface CloneProductPayload {
  targetShopIds: string[];
}

// ---------------------------------------------------------------------------
// Clone Products / Clone History
// ---------------------------------------------------------------------------

/**
 * Trạng thái TỔNG của một lượt nhân bản — backend ĐẾM TỪ từng shop đích: SUCCESS (mọi shop),
 * PARTIAL (có SUCCESS lẫn không), FAILED (không SUCCESS, có hỏng), SKIPPED (mọi shop đã có sản
 * phẩm — không phải lỗi), PROCESSING / PENDING.
 */
export const POD_PRODUCT_CLONE_STATUSES = ['PENDING', 'PROCESSING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED'] as const;
export type PodProductCloneStatus = (typeof POD_PRODUCT_CLONE_STATUSES)[number];

/** Trạng thái của MỘT shop đích (= Listing Job Item). */
export type PodProductCloneTargetStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'RETRYING'
  | 'SUCCESS'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED';

export interface PodProductCloneShop {
  id: string;
  name: string;
  region: string | null;
  connectionName: string;
}

export interface PodProductCloneTarget {
  id: string;
  shop: PodProductCloneShop;
  status: PodProductCloneTargetStatus;
  remoteProductId: string | null;
  /** Product Mapping (`pod_listing_payloads`): sản phẩm đích trên TikTok. */
  tiktokProductId: string | null;
  tiktokDraftId: string | null;
  reviewStatus: string | null;
  payloadId: string | null;
  error: string | null;
  errorCode: string | null;
  /** Dòng log ERROR gần nhất của shop (mã TikTok, request id…) — chỉ có ở màn chi tiết. */
  errorDetail: Record<string, unknown> | null;
  retryCount: number;
  nextAttemptAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodProductCloneBatch {
  id: string;
  name: string;
  status: PodProductCloneStatus;
  jobStatus: string;
  market: string;
  product: { id: string; title: string | null; tiktokProductId: string; thumbnailUrl: string | null } | null;
  sourceShop: PodProductCloneShop | null;
  counts: { total: number; success: number; failed: number; skipped: number; processing: number; pending: number; cancelled: number };
  progress: { completed: number; total: number };
  running: boolean;
  createdBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  targets: PodProductCloneTarget[];
}

export interface PodProductCloneQuery extends PaginationParams {
  search?: string;
  sourceShopId?: string;
  targetShopId?: string;
  status?: PodProductCloneStatus;
  createdBy?: string;
  from?: string;
  to?: string;
}

export interface PodProductCloneListResult extends Paginated<PodProductCloneBatch> {
  /** Người đã tạo lượt trong tổ chức — chỉ Admin nhận (bộ lọc "Người tạo"). */
  creators: Array<{ id: string; name: string }>;
}
