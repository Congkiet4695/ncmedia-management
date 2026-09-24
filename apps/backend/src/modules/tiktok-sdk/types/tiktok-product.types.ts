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
  /** Từ khoá tìm kiếm (ST words) — Get Product CÓ trả về, dùng làm vế so khi sửa. */
  searchTerms?: string[];
  /** Product Highlights. */
  keyProductFeatures?: string[];
  /**
   * Bảng size hiện tại.
   *
   * 🔴 Hai dạng loại trừ nhau: ảnh do người bán tải lên (`image.uri`) hoặc bảng size mẫu của
   * TikTok (`template.id`). Sửa sản phẩm phải biết đang là dạng nào để không gửi nhầm.
   */
  sizeChart?: { image?: TiktokProductImage; template?: { id?: string } };
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

/**
 * Luật của một danh mục từ **Get Category Rules** (`/product/202309/categories/{id}/rules`).
 *
 * Chỉ ánh xạ phần hệ thống dùng. `sizeChart.isSupported = false` nghĩa là (theo tài liệu
 * TikTok) "even if you provide a size chart when creating or editing a product, the size chart
 * will not be saved" — gửi cũng vô ích, và `isRequired = true` thì thiếu là bị từ chối.
 */
export interface TiktokCategoryRules {
  sizeChart: { isSupported: boolean; isRequired: boolean } | null;
  packageDimension: { isRequired: boolean } | null;
  /** Danh sách phí/chứng nhận… để nguyên dạng thô cho log; không suy diễn ở đây. */
  raw: Record<string, unknown>;
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

/**
 * File (video/PDF) vừa tải lên TikTok.
 *
 * 🔴 Create Product nhận video bằng `video: { id }` — **ID**, không phải `uri` như ảnh.
 */
export interface TiktokUploadedFile {
  id?: string;
  url?: string;
  /** TikTok trả về khi file là video — dùng để đối chiếu, không gửi lại. */
  format?: string;
}

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
  /**
   * `external_sku_id` — định danh biến thể phía ta (TikTok: *"used to associate the SKU
   * between TikTok Shop and the external ecommerce platform"*). Ổn định theo
   * (lượt đăng, `seller_sku`), y như `externalProductId` ở mức sản phẩm.
   */
  externalSkuId?: string;
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
  /** Từ khoá tìm kiếm (ST words) — tối đa 15 từ, tổng 250 ký tự. */
  searchTerms?: string[];
  /** Product Highlights — mỗi dòng một ý. */
  keyProductFeatures?: string[];
  categoryId?: string;
  categoryVersion?: string;
  brandId?: string;
  /** `AS_DRAFT` (Sprint 4) hoặc `LISTING`. */
  saveMode?: string;
  /**
   * `idempotency_key` — định danh của **MỘT LẦN GỬI**.
   *
   * 🔴 TikTok: *"Ensure this key is unique within the shop for each request"* (tối đa 128 ký
   * tự, khuyến nghị UUID v4). TikTok ghi nhận key ngay khi nhận request và TỪ CHỐI key đã
   * dùng bằng `12052996 Precondition Required — This operation requires a unique
   * external_id`. Nói cách khác nó là hàng rào chống **xử lý trùng**, KHÔNG phải cơ chế phát
   * lại kết quả cũ: đã gửi đi thì lần sau phải là key khác. Sinh ở
   * `buildTiktokIdempotencyKey`, không bao giờ dẫn xuất từ nội dung payload.
   */
  idempotencyKey?: string;
  /**
   * `external_product_id` — định danh của **MỘT SẢN PHẨM PHÍA TA** (TikTok: *"An external
   * identifier used in an external ecommerce platform. This is used to associate the product
   * between TikTok Shop and the external ecommerce platform. Max length: 999 characters"*).
   *
   * 🔴 Khác hẳn `idempotencyKey`: giá trị này **ỔN ĐỊNH** qua mọi lần thử của cùng một lượt
   * đăng (`pod_listing_payloads.id`) và đi kèm cả ở Edit Product — nhờ đó một sản phẩm trên
   * Seller Center luôn tra ngược được về đúng bản ghi trong hệ thống. Xem
   * `buildExternalProductId`.
   */
  externalProductId?: string;
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

/**
 * Thân request **Partial Edit Product** — `POST /product/202309/products/{id}/partial_edit`.
 *
 * 🔴 Khác `Edit Product` (PUT) ở điểm quyết định: PUT là **thay toàn bộ**, thiếu trường nào
 * là TikTok coi như xoá trường đó. Partial Edit chỉ đụng tới những trường CÓ MẶT trong body.
 * Sửa mỗi tiêu đề mà dùng PUT là mất sạch mô tả, ảnh và bảng giá.
 *
 * 🔴 **KHÔNG có `categoryId`.** TikTok không cho đổi danh mục của sản phẩm đã tạo qua API
 * này — giao diện phải để danh mục ở chế độ chỉ đọc, không được dựng ô chọn rồi âm thầm
 * bỏ qua giá trị người dùng chọn.
 */
export interface TiktokPartialEditProductRequest {
  title?: string;
  description?: string;
  brandId?: string;
  /** Từ khoá tìm kiếm (ST words) — tối đa 15 từ, tổng 250 ký tự. */
  searchTerms?: string[];
  /** Product Highlights — mỗi dòng một ý. */
  keyProductFeatures?: string[];
  /**
   * Ảnh sản phẩm — danh sách **ĐẦY ĐỦ và ĐÚNG THỨ TỰ**, không phải phần thêm vào.
   *
   * 🔴 TikTok THAY cả bộ ảnh bằng mảng này: gửi 2 tấm cho sản phẩm đang có 7 tấm là xoá 5
   * tấm kia. Vì vậy nơi gọi chỉ được đưa vào đây khi thật sự có thay đổi, và khi đưa thì
   * phải đủ cả bộ. Tấm ĐẦU TIÊN là ảnh đại diện — TikTok không có trường riêng cho việc đó.
   */
  mainImages?: Array<{ uri?: string }>;
  /** Ảnh bảng size (`image.uri`) HOẶC bảng size mẫu của TikTok (`template.id`), không cả hai. */
  sizeChart?: { image?: { uri?: string }; template?: { id?: string } };
  /** Video sản phẩm — `id` nhận từ Upload Product File, KHÔNG phải `uri` như ảnh. */
  video?: { id?: string };
  packageWeight?: { value?: string; unit?: string };
  packageDimensions?: { length?: string; width?: string; height?: string; unit?: string };
  productAttributes?: Array<{ id?: string; values?: Array<{ id?: string; name?: string }> }>;
  skus?: TiktokPartialEditSku[];
}

/**
 * Một SKU trong Partial Edit.
 *
 * 🔴 `id` là **TikTok SKU ID** và là BẮT BUỘC: thiếu nó TikTok không biết sửa dòng nào và
 * có thể tạo thêm SKU mới. Đây là lý do luồng sửa chỉ làm việc với SKU đã đồng bộ về.
 */
export interface TiktokPartialEditSku {
  id: string;
  sellerSku?: string;
  price?: { amount?: string; currency?: string };
  listPrice?: { amount?: string; currency?: string };
  inventory?: Array<{ warehouseId?: string; quantity?: number }>;
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
