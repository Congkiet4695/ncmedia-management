/**
 * Hằng số của Listing Session (một lượt đăng hàng: cấu hình → import → review → lên sàn).
 *
 * 🔴 Không có tên cột nào được viết cứng ở nơi khác: bảng ánh xạ dưới đây là nguồn duy nhất
 * quyết định "cột nào trong file là cột gì", và cũng chính nó sinh ra file mẫu để tải về.
 */

/** Kích thước file import tối đa. */
export const POD_SESSION_IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Số dòng tối đa của một file — chặn một file 200k dòng khoá cả tiến trình. */
export const POD_SESSION_IMPORT_MAX_ROWS = 5_000;

/** Số Draft Product tối đa trong một session. */
export const POD_SESSION_MAX_PRODUCTS = 1_000;

/** Định dạng file nhận vào. */
export const POD_SESSION_IMPORT_EXTENSIONS = ['.xlsx', '.csv'] as const;

/** Số ảnh gốc tối đa của một sản phẩm — đúng bằng số cột URL trong file. */
export const POD_SESSION_IMPORT_MAX_IMAGES = 10;

/** Cột tiêu đề. */
export const POD_SESSION_TITLE_COLUMN = 'title';

/**
 * 🔴 Định dạng file import: **ĐÚNG 11 CỘT**, không hơn.
 *
 * ```
 * title | URL1 | URL2 | ... | URL10
 * ```
 *
 * Mỗi dòng là MỘT sản phẩm; `URL1..URL10` là danh sách ảnh gốc, ô trống được bỏ qua.
 *
 * Không có cột nào khác — không mô tả, không biến thể, không giá, không danh mục. Toàn bộ
 * phần đó được dựng từ bộ template của session lúc Start Listing, nên file chỉ cần mang
 * đúng thứ mà template KHÔNG biết: tên sản phẩm và ảnh của nó.
 *
 * So khớp tên cột bỏ qua hoa thường và khoảng trắng thừa ("URL 1", "url1" đều khớp).
 */
export const POD_SESSION_IMPORT_COLUMNS: string[] = [
  POD_SESSION_TITLE_COLUMN,
  ...Array.from({ length: POD_SESSION_IMPORT_MAX_IMAGES }, (_, index) => `URL${index + 1}`),
];

/** Trường sắp xếp cho danh sách session (whitelist chống injection qua orderBy). */
export const POD_SESSION_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'status'] as const;
export type PodSessionSortField = (typeof POD_SESSION_SORT_FIELDS)[number];

/** Trường sắp xếp cho danh sách Draft Product trong session. */
export const POD_SESSION_PRODUCT_SORT_FIELDS = [
  'importOrder',
  'createdAt',
  'title',
  'status',
] as const;
export type PodSessionProductSortField = (typeof POD_SESSION_PRODUCT_SORT_FIELDS)[number];

/**
 * Mã lỗi của cổng validate — frontend dịch sang thông điệp người dùng.
 *
 * Session/Draft Product mang mã mức ERROR nào trong đây thì **không được Start Listing**.
 */
export const POD_SESSION_VALIDATION_CODES = {
  /** Cấu hình của cả lượt */
  NO_SHOP: 'SESSION_NO_SHOP',
  NO_CATEGORY_TEMPLATE: 'SESSION_NO_CATEGORY_TEMPLATE',
  /** 🔴 Biến thể CHỈ đến từ SKU Template — file import không mang biến thể nào. */
  NO_SKU_TEMPLATE: 'SESSION_NO_SKU_TEMPLATE',
  NO_PRODUCT: 'SESSION_NO_PRODUCT',
  /** Từng Draft Product */
  MISSING_TITLE: 'PRODUCT_MISSING_TITLE',
  MISSING_IMAGE: 'PRODUCT_MISSING_IMAGE',
  ALREADY_UPLOADED: 'PRODUCT_ALREADY_UPLOADED',
  RESOLVE_FAILED: 'PRODUCT_RESOLVE_FAILED',
} as const;

/** Sàn mặc định của một session (bảng `platforms` là dữ liệu global đã seed). */
export const POD_DEFAULT_PLATFORM_CODE = 'TIKTOK_SHOP';
