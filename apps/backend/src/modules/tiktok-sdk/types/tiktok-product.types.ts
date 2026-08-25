/**
 * Kiểu dữ liệu Product mà LỚP BỌC phơi ra cho phần còn lại của hệ thống.
 *
 * 🔴 Vì sao khai báo lại thay vì tái xuất kiểu của SDK: đây chính là ranh giới chống
 * rò rỉ (ACL — 02-system-architecture P1). Module nghiệp vụ chỉ thấy các kiểu ở đây;
 * SDK đổi tên lớp/đổi version thì chỉ wrapper phải sửa, không lan ra ngoài.
 *
 * Mọi trường đều để `optional` đúng như SDK khai báo — TikTok có thể bỏ trống bất kỳ
 * trường nào tuỳ trạng thái sản phẩm và thị trường. Tầng mapper chịu trách nhiệm
 * chuẩn hoá, KHÔNG được giả định trường luôn tồn tại.
 */

/** Ảnh sản phẩm (`main_images[]`, `sales_attributes[].sku_img`). */
export interface TiktokProductImage {
  uri?: string;
  urls?: string[];
  thumbUrls?: string[];
  width?: number;
  height?: number;
}

/** Video sản phẩm (`video`). */
export interface TiktokProductVideo {
  id?: string;
  url?: string;
  coverUrl?: string;
  format?: string;
  width?: number;
  height?: number;
  size?: number;
}

/** Thuộc tính bán hàng của SKU — chính là "Variant" theo cách gọi thông thường. */
export interface TiktokSalesAttribute {
  id?: string;
  name?: string;
  valueId?: string;
  valueName?: string;
  skuImg?: TiktokProductImage;
}

/** Tồn kho theo kho hàng (`skus[].inventory[]`). */
export interface TiktokSkuInventory {
  warehouseId?: string;
  quantity?: number;
  backorderQuantity?: number;
  handlingTime?: number;
}

/** Giá của SKU (`skus[].price`) — TikTok trả về dạng CHUỖI, không parse ở tầng này. */
export interface TiktokSkuPrice {
  currency?: string;
  salePrice?: string;
  taxExclusivePrice?: string;
  unitPrice?: string;
}

/** Giá niêm yết (`skus[].list_price`). */
export interface TiktokSkuListPrice {
  amount?: string;
  currency?: string;
}

/** Kích thước/khối lượng riêng của SKU. */
export interface TiktokDimension {
  length?: string;
  width?: string;
  height?: string;
  unit?: string;
}

export interface TiktokWeight {
  value?: string;
  unit?: string;
}

/** Một SKU của sản phẩm. */
export interface TiktokProductSku {
  id?: string;
  sellerSku?: string;
  externalSkuId?: string;
  skuUnitCount?: string;
  price?: TiktokSkuPrice;
  listPrice?: TiktokSkuListPrice;
  inventory?: TiktokSkuInventory[];
  salesAttributes?: TiktokSalesAttribute[];
  skuDimensions?: TiktokDimension;
  skuWeight?: TiktokWeight;
  /** `status_info.status` — trạng thái riêng của SKU. */
  statusInfo?: { status?: string; deactivationSource?: string };
}

/** Thương hiệu gắn với sản phẩm. */
export interface TiktokProductBrand {
  id?: string;
  name?: string;
}

/** Một mắt xích trong chuỗi danh mục (`category_chains[]`). */
export interface TiktokCategoryChainNode {
  id?: string;
  parentId?: string;
  localName?: string;
  isLeaf?: boolean;
}

/** Thuộc tính sản phẩm theo danh mục (`product_attributes[]`). */
export interface TiktokProductAttribute {
  id?: string;
  name?: string;
  values?: Array<{ id?: string; name?: string }>;
}

/** Kết quả kiểm duyệt (`audit`). */
export interface TiktokProductAudit {
  status?: string;
  preApprovedReasons?: string[];
}

/**
 * Lý do TRƯỢT duyệt (`audit_failed_reasons[]`).
 *
 * `reasons` là lý do ngắn, `suggestions` là hướng dẫn sửa — Sprint 5 gộp cả hai vào
 * `pod_listing_payloads.review_reason` để người vận hành đọc được ngay trên màn hình mà
 * không phải mở Seller Center.
 */
export interface TiktokProductAuditFailedReason {
  listingPlatform?: string;
  position?: string;
  reasons?: string[];
  suggestions?: string[];
}

/** Bản TÓM TẮT trả về từ Search Products — KHÔNG có ảnh/mô tả/thuộc tính. */
export interface TiktokProductSummary {
  id?: string;
  title?: string;
  status?: string;
  createTime?: number;
  updateTime?: number;
  skus?: TiktokProductSku[];
  salesRegions?: string[];
  productTags?: string[];
  listingQualityTier?: string;
  audit?: TiktokProductAudit;
  hasDraft?: boolean;
  isNotForSale?: boolean;
}

/** Bản ĐẦY ĐỦ trả về từ Get Product. */
export interface TiktokProductDetail extends TiktokProductSummary {
  description?: string;
  brand?: TiktokProductBrand;
  categoryChains?: TiktokCategoryChainNode[];
  productAttributes?: TiktokProductAttribute[];
  mainImages?: TiktokProductImage[];
  video?: TiktokProductVideo;
  packageDimensions?: TiktokDimension;
  packageWeight?: TiktokWeight;
  externalProductId?: string;
  isCodAllowed?: boolean;
  isPreOwned?: boolean;
  minimumOrderQuantity?: number;
  shippingInsuranceRequirement?: string;
  productTypes?: string[];
  /** Cấu hình POD (chỉ thị trường US) — Sprint sau dùng, sync sẵn để không mất dữ liệu. */
  podInfo?: unknown;
  /**
   * Trạng thái bán hàng THUẦN (không gộp audit): INITIAL / DRAFT / ACTIVATE /
   * SELLER_DEACTIVATED / PLATFORM_DEACTIVATED / FREEZE / DELETED.
   */
  productStatus?: string;
  /** Lý do trượt duyệt — chỉ có khi `status = FAILED`. */
  auditFailedReasons?: TiktokProductAuditFailedReason[];
}

/** Bộ lọc của Search Products — đúng các trường SDK khai báo, không tự thêm. */
export interface TiktokProductSearchFilter {
  status?: string;
  sellerSkus?: string[];
  skuIds?: string[];
  createTimeGe?: number;
  createTimeLe?: number;
  /** 🔴 Chìa khoá của Incremental Sync: chỉ lấy sản phẩm đổi sau mốc này (Unix giây). */
  updateTimeGe?: number;
  updateTimeLe?: number;
  listingQualityTiers?: string[];
  listingPlatforms?: string[];
  auditStatus?: string[];
  categoryVersion?: string;
  locale?: string;
}

/** Một node danh mục từ Get Categories. */
export interface TiktokCategoryNode {
  id?: string;
  parentId?: string;
  localName?: string;
  isLeaf?: boolean;
  permissionStatuses?: string[];
}

/** Thương hiệu từ Get Brands. */
export interface TiktokBrand {
  id?: string;
  name?: string;
  authorizedStatus?: string;
  brandStatus?: string;
}

/** Thuộc tính của một danh mục từ Get Category Attributes. */
export interface TiktokCategoryAttribute {
  id?: string;
  name?: string;
  type?: string;
  /**
   * ⚠️ Tên trường của TikTok là `is_requried` — **sai chính tả ngay trong API gốc**
   * và SDK giữ nguyên thành `isRequried`. Không "sửa cho đúng" thành `isRequired`:
   * đọc sai tên là mất luôn thông tin trường nào bắt buộc.
   */
  isRequried?: boolean;
  isMultipleSelection?: boolean;
  isCustomizable?: boolean;
  valueDataFormat?: string;
  values?: Array<{ id?: string; name?: string; iconUrl?: string }>;
}

// ---------------------------------------------------------------------------
// Ghi dữ liệu lên TikTok — Upload Product Image & Create Product
// ---------------------------------------------------------------------------

/** Ảnh vừa tải lên TikTok. `uri` là thứ Create Product cần, `url` chỉ để xem lại. */
export interface TiktokUploadedImage {
  uri?: string;
  url?: string;
  width?: number;
  height?: number;
  useCase?: string;
}

/** Một biến thể trong request Create Product. */
export interface TiktokCreateProductSku {
  sellerSku?: string;
  /** Giá bán — `amount` là giá thực bán, `salePrice` là giá khuyến mãi (nếu có). */
  price?: { amount?: string; currency?: string; salePrice?: string };
  /** Giá gốc gạch ngang. */
  listPrice?: { amount?: string; currency?: string };
  inventory?: Array<{ warehouseId?: string; quantity?: number }>;
  salesAttributes?: Array<{
    id?: string;
    name?: string;
    valueId?: string;
    valueName?: string;
    skuImg?: { uri?: string };
  }>;
  identifierCode?: { code?: string; type?: string };
}

/**
 * Thân request Create Product — chỉ những trường hệ thống thực sự gửi.
 *
 * Cố ý KHÔNG khai báo lại toàn bộ 30+ trường của SDK: trường nào chưa dùng thì thêm khi
 * cần, để hợp đồng này đọc được như một danh sách "hệ thống gửi đúng chừng này".
 */
export interface TiktokCreateProductRequest {
  title?: string;
  description?: string;
  categoryId?: string;
  categoryVersion?: string;
  brandId?: string;
  /** `AS_DRAFT` (Sprint 4) hoặc `LISTING`. */
  saveMode?: string;
  /** Chống tạo trùng khi client thử lại — TikTok trả về đúng sản phẩm đã tạo. */
  idempotencyKey?: string;
  mainImages?: Array<{ uri?: string }>;
  packageWeight?: { value?: string; unit?: string };
  packageDimensions?: { length?: string; width?: string; height?: string; unit?: string };
  productAttributes?: Array<{ id?: string; values?: Array<{ id?: string; name?: string }> }>;
  skus?: TiktokCreateProductSku[];
  sizeChart?: { image?: { uri?: string } };
  video?: { id?: string };
  isCodAllowed?: boolean;
  minimumOrderQuantity?: number;
}

/** Kết quả Create Product. */
export interface TiktokCreateProductResult {
  productId?: string;
  skus?: Array<{ id?: string; sellerSku?: string; salesAttributes?: Array<{ id?: string }> }>;
  warnings?: Array<{ message?: string }>;
}

/**
 * Thân request Edit Product — **cách duy nhất publish một Draft đã có** trên TikTok.
 *
 * 🔴 Edit Product là FULL EDIT: trường nào không gửi sẽ bị ghi đè thành rỗng. Vì thế nó
 * dùng lại đúng shape của Create Product (trừ `idempotencyKey`, thứ chỉ có ý nghĩa lúc tạo)
 * — hệ thống gửi lại NGUYÊN payload đã tạo ra Draft, không gửi một tập con.
 */
export type TiktokEditProductRequest = Omit<TiktokCreateProductRequest, 'idempotencyKey'>;

/** Kết quả Edit Product — kèm `audit` để biết ngay sản phẩm đã vào hàng chờ duyệt chưa. */
export interface TiktokEditProductResult {
  productId?: string;
  skus?: Array<{ id?: string; sellerSku?: string; salesAttributes?: Array<{ id?: string }> }>;
  warnings?: Array<{ message?: string }>;
  audit?: TiktokProductAudit;
}
