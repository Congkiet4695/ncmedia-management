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
} as const;

/** `page_size` của Search Products. Tài liệu cho tối đa 100; dùng mức cao nhất để ít call. */
export const TIKTOK_PRODUCT_SEARCH_PAGE_SIZE = 100;

/** `page_size` của Get Brands. */
export const TIKTOK_BRAND_PAGE_SIZE = 100;

/**
 * Trần số trang cho MỘT lần quét — lưới an toàn chống vòng lặp vô hạn khi TikTok trả
 * `next_page_token` lặp. Chạm trần ⇒ ghi cảnh báo, KHÔNG âm thầm cắt dữ liệu.
 */
export const TIKTOK_PRODUCT_MAX_PAGES_PER_RUN = 200;

/** Content-Type bắt buộc của mọi call (SDK yêu cầu truyền tường minh). */
export const TIKTOK_SDK_CONTENT_TYPE = 'application/json';

/** Số lần thử lại tối đa cho một call SDK (chỉ áp dụng nhóm lỗi tạm thời). */
export const TIKTOK_SDK_MAX_RETRY = 3;

/** Tham số backoff — công thức chính thức: max(retry_after, min(base·2^n + jitter, cap)). */
export const TIKTOK_SDK_BASE_DELAY_MS = 1_000;
export const TIKTOK_SDK_MAX_DELAY_MS = 60_000;
export const TIKTOK_SDK_MAX_JITTER_MS = 500;
