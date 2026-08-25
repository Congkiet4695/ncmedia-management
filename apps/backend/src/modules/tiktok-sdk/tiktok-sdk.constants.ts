/**
 * Hằng số của lớp bọc SDK TikTok.
 *
 * ⚠️ KHÔNG có endpoint/path nào ở đây — toàn bộ path do SDK chính thức nắm giữ
 * (`vendor/tiktok-shop-sdk`). Đây chính là mục tiêu "không hardcode endpoint":
 * đổi version API = đổi lớp API của SDK được gọi trong wrapper, không sửa chuỗi URL.
 */

/**
 * Version SDK dùng cho từng nhóm nghiệp vụ Product.
 *
 * 🔴 TikTok gán version **theo từng API**, không đồng nhất (01-tiktok-documentation-summary §4.4).
 * Bảng này là NƠI DUY NHẤT quyết định dùng version nào — nâng version chỉ sửa ở đây.
 */
export const TIKTOK_PRODUCT_API_VERSIONS = {
  /** Search Products — bản mới nhất SDK cung cấp (có `updateTimeGe` cho sync tăng dần). */
  searchProducts: 'ProductV202502Api',
  /** Get Product (chi tiết) — bản 202309 là bản duy nhất SDK có cho endpoint này. */
  getProduct: 'ProductV202309Api',
  /** Categories / Attributes / Brands / Inventory / Prerequisites. */
  catalog: 'ProductV202309Api',
  /** Upload Product Image — SDK chỉ có bản 202309. */
  uploadImage: 'ProductV202309Api',
  /** Create Product — SDK chỉ có bản 202309. */
  createProduct: 'ProductV202309Api',
  /**
   * Edit Product — dùng để **PUBLISH một Draft đã có** (`save_mode = LISTING`).
   *
   * 🔴 TikTok KHÔNG có endpoint "publish product" cho sản phẩm local: bản 202309 lẫn bản
   * 202509 của SDK đều chỉ có Edit / Partial Edit, và chính `save_mode` quyết định sản phẩm
   * nằm ở Draft hay vào hàng chờ duyệt. Chọn 202309 (không phải 202509) để dùng đúng bản đã
   * tạo Draft — gửi cùng một thân request qua hai version khác nhau là tự chuốc lệch trường.
   */
  editProduct: 'ProductV202309Api',
} as const;

/** `page_size` của Search Products. Tài liệu cho tối đa 100; dùng mức cao nhất để ít call. */
export const TIKTOK_PRODUCT_SEARCH_PAGE_SIZE = 100;

/** `page_size` của Get Brands. */
export const TIKTOK_BRAND_PAGE_SIZE = 100;

/**
 * Phiên bản cây danh mục dùng khi gọi Get Categories / Get Category Attributes.
 *
 * 🔴 Bắt buộc là `v2`: shop bán đa vùng ("all-region") bị TikTok từ chối thẳng nếu dùng v1 —
 * `12052217 Parameter 'category_version' is invalid because all-region shops must use V2
 * categories`. Bỏ trống tham số này cũng bị coi là v1, nên phải truyền tường minh.
 */
export const TIKTOK_CATEGORY_VERSION = 'v2';

/**
 * Trần số trang cho MỘT lần quét — lưới an toàn chống vòng lặp vô hạn khi TikTok trả
 * `next_page_token` lặp. Chạm trần ⇒ ghi cảnh báo, KHÔNG âm thầm cắt dữ liệu.
 */
export const TIKTOK_PRODUCT_MAX_PAGES_PER_RUN = 200;

/**
 * `use_case` của Upload Product Image — quyết định TikTok kiểm ảnh theo bộ quy tắc nào
 * (ảnh chính bắt buộc vuông và ≥ 300px, ảnh mô tả thì không).
 */
export const TIKTOK_IMAGE_USE_CASE = {
  MAIN_IMAGE: 'MAIN_IMAGE',
  ATTRIBUTE_IMAGE: 'ATTRIBUTE_IMAGE',
  DESCRIPTION_IMAGE: 'DESCRIPTION_IMAGE',
  CERTIFICATION_IMAGE: 'CERTIFICATION_IMAGE',
  SIZE_CHART_IMAGE: 'SIZE_CHART_IMAGE',
} as const;
export type TiktokImageUseCase = (typeof TIKTOK_IMAGE_USE_CASE)[keyof typeof TIKTOK_IMAGE_USE_CASE];

/**
 * `save_mode` của Create Product / Edit Product.
 *
 * 🔴 Đây là công tắc DUY NHẤT phân biệt hai sprint: `AS_DRAFT` để sản phẩm nằm im trong mục
 * Draft của Seller Center (Sprint 4), `LISTING` để đưa nó vào hàng chờ duyệt (Sprint 5).
 * `createProduct()` mặc định `AS_DRAFT` và `publishProduct()` luôn gửi `LISTING` — không có
 * đường nào khác đặt giá trị này, nên không ai publish nhầm vì quên một tham số.
 */
export const TIKTOK_PRODUCT_SAVE_MODE = {
  AS_DRAFT: 'AS_DRAFT',
  LISTING: 'LISTING',
} as const;
export type TiktokProductSaveMode =
  (typeof TIKTOK_PRODUCT_SAVE_MODE)[keyof typeof TIKTOK_PRODUCT_SAVE_MODE];

/** Content-Type bắt buộc của mọi call (SDK yêu cầu truyền tường minh). */
export const TIKTOK_SDK_CONTENT_TYPE = 'application/json';

/** Số lần thử lại tối đa cho một call SDK (chỉ áp dụng nhóm lỗi tạm thời). */
export const TIKTOK_SDK_MAX_RETRY = 3;

/** Tham số backoff — công thức chính thức: max(retry_after, min(base·2^n + jitter, cap)). */
export const TIKTOK_SDK_BASE_DELAY_MS = 1_000;
export const TIKTOK_SDK_MAX_DELAY_MS = 60_000;
export const TIKTOK_SDK_MAX_JITTER_MS = 500;

// ---------------------------------------------------------------------------
// Sprint 5 — Publish & Review Status
// ---------------------------------------------------------------------------

/**
 * `status` của sản phẩm phía TikTok (Get Product) — trạng thái ĐÃ GỘP cả audit.
 *
 * Nguồn: mô tả trường `status` trong `GetProductResponseData` của SDK. Khai báo lại thành
 * hằng để không rải chuỗi ma thuật khắp tầng nghiệp vụ.
 */
export const TIKTOK_PRODUCT_STATUS = {
  INITIAL: 'INITIAL',
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  ACTIVATE: 'ACTIVATE',
  SELLER_DEACTIVATED: 'SELLER_DEACTIVATED',
  PLATFORM_DEACTIVATED: 'PLATFORM_DEACTIVATED',
  FREEZE: 'FREEZE',
  DELETED: 'DELETED',
  SCHEDULED: 'SCHEDULED',
} as const;

/** `audit.status` — kết quả kiểm duyệt, tách khỏi trạng thái bán hàng. */
export const TIKTOK_AUDIT_STATUS = {
  NONE: 'NONE',
  AUDITING: 'AUDITING',
  FAILED: 'FAILED',
  PRE_APPROVED: 'PRE_APPROVED',
  APPROVED: 'APPROVED',
} as const;
