/**
 * Hằng số module POD — Template Engine (Sprint 3).
 *
 * 🔴 KHÔNG có category / attribute / brand / warehouse nào được khai báo ở đây.
 * Toàn bộ dữ liệu đó đến từ TikTok qua Sprint 2 (bảng cache) — file này chỉ chứa
 * giới hạn kỹ thuật, danh sách trắng token và whitelist cột sắp xếp.
 */

import { PodListingPayloadStatus, PodListingReviewStatus } from '@prisma/client';

/** Trần số tổ hợp sinh từ một SKU Template (chống nổ tổ hợp: 5 trục × 10 giá trị = 100k). */
export const POD_SKU_TEMPLATE_MAX_ITEMS = 500;

/** Số trục biến thể tối đa (Color, Size, Style…). */
export const POD_SKU_TEMPLATE_MAX_VARIANTS = 5;

/** Số giá trị tối đa của MỘT trục. */
export const POD_SKU_TEMPLATE_MAX_VALUES_PER_VARIANT = 100;

/** Trần số draft sinh trong MỘT lần bấm — tránh một cú bấm khoá DB hàng phút. */
export const POD_DRAFT_GENERATE_MAX_ITEMS = 200;

/**
 * Số ảnh tối đa trong MỘT bộ ảnh mẫu.
 *
 * TikTok chỉ nhận 9 ảnh cho một listing, nhưng bộ ảnh mẫu được phép chứa nhiều hơn: người
 * vận hành thường giữ sẵn vài mockup/lifestyle rồi chọn ra khi dựng listing.
 */
export const POD_IMAGE_TEMPLATE_MAX_ITEMS = 30;

/** Số ảnh tối đa cho một lần bulk upload. */
export const POD_IMAGE_TEMPLATE_MAX_UPLOAD = 20;

/**
 * Định dạng ảnh nhận vào bộ ảnh mẫu.
 *
 * Hẹp hơn Storage Module (vốn nhận cả PDF/PSD cho file thiết kế): một tấm mockup PDF thì
 * listing không hiển thị được, chặn sớm vẫn hơn để lộ lỗi lúc publish.
 */
export const POD_IMAGE_TEMPLATE_ALLOWED_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

/**
 * Số giá trị TỰ NHẬP tối đa cho một thuộc tính danh mục.
 *
 * Người vận hành thêm vài cỡ lạ ("30x40", "Oversized") mà TikTok chưa có sẵn. Cần tới 50 giá
 * trị tự nhập cho một thuộc tính thì vấn đề nằm ở chỗ khác — danh mục chọn sai, hoặc dữ liệu
 * danh mục cần đồng bộ lại.
 */
export const POD_ATTRIBUTE_MAX_CUSTOM_VALUES = 50;

/** Số dòng quy tắc chọn sản phẩm tối đa của một Listing Template. */
export const POD_LISTING_TEMPLATE_MAX_SCOPES = 50;

/**
 * Số sản phẩm tối đa chạy thử trong MỘT lần Dry Run.
 *
 * Dry Run là để **chứng minh template chạy được**, không phải để sinh listing — chạy thử
 * 20 sản phẩm đại diện đã đủ thấy template thiếu gì; chạy 10.000 sản phẩm chỉ để xem
 * trước là tự khoá API hàng phút.
 */
export const POD_TEMPLATE_DRY_RUN_MAX_PRODUCTS = 20;

/** Số dòng tối đa của một file Import SKU (.xlsx). */
export const POD_SKU_IMPORT_MAX_ROWS = POD_SKU_TEMPLATE_MAX_ITEMS;

/** Kích thước tối đa của một gói template khi Import (JSON). */
export const POD_TEMPLATE_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Token HỆ THỐNG được phép dùng trong Description Template.
 *
 * 🔴 DANH SÁCH TRẮNG: token ngoài danh sách này VÀ ngoài các token do người dùng khai báo
 * ở `pod_description_template_tokens` sẽ được giữ nguyên (không thay). Tuyệt đối KHÔNG
 * eval biểu thức người dùng nhập — đây là dữ liệu chạy trên server đa tenant.
 *
 * Token do người dùng tự đặt (`MATERIAL`, `CARE`, `SHIPPING`…) nằm trong DATABASE, nên
 * thêm token mới KHÔNG cần sửa mã — đó là phần "mở rộng được" của Token Engine.
 */
export const POD_TEMPLATE_TOKENS = [
  'PRODUCT.TITLE',
  'PRODUCT.DESCRIPTION',
  'PRODUCT.SELLER_SKU',
  'PRODUCT.CATEGORY',
  'PRODUCT.BRAND',
  'SHOP.NAME',
  'TEMPLATE.NAME',
  'VARIANT.NAME',
] as const;
export type PodTemplateToken = (typeof POD_TEMPLATE_TOKENS)[number];

/** Mã token do người dùng đặt: CHỮ IN, số và gạch dưới — khớp `{{MATERIAL}}`, `{{SIZE_CHART}}`. */
export const POD_TEMPLATE_TOKEN_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Số token tự đặt tối đa cho một Description Template. */
export const POD_DESCRIPTION_TEMPLATE_MAX_TOKENS = 50;

/** Biến được phép dùng trong công thức giá (`markupType = FORMULA`). */
export const POD_PRICING_FORMULA_VARIABLES = ['cost', 'shipping', 'base', 'markup'] as const;

/** Độ dài tối đa của công thức giá — khớp `pod_pricing_strategies.formula`. */
export const POD_PRICING_FORMULA_MAX_LENGTH = 500;

/** Trường sắp xếp cho các danh sách template (whitelist chống injection qua orderBy). */
export const POD_TEMPLATE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'displayOrder',
] as const;
export type PodTemplateSortField = (typeof POD_TEMPLATE_SORT_FIELDS)[number];

/** Trường sắp xếp cho danh sách Draft Listing. */
export const POD_DRAFT_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'status'] as const;
export type PodDraftSortField = (typeof POD_DRAFT_SORT_FIELDS)[number];

/** Sáu loại template — dùng chung cho Import/Export và định tuyến. */
export const POD_TEMPLATE_KINDS = [
  'CATEGORY',
  'SKU',
  'DESCRIPTION',
  'IMAGE',
  'PRICING',
  'LISTING',
] as const;
export type PodTemplateKind = (typeof POD_TEMPLATE_KINDS)[number];

/** Phiên bản định dạng gói Import/Export — file cũ vẫn đọc được khi định dạng đổi. */
export const POD_TEMPLATE_BUNDLE_VERSION = 1;

// ---------------------------------------------------------------------------
// Sprint 4 — Bulk Listing Engine
// ---------------------------------------------------------------------------

/**
 * Số item chạy SONG SONG trong một Listing Job.
 *
 * 5 là con số của yêu cầu sprint và cũng là mức an toàn với rate limit của TikTok: mỗi item
 * là 1 lần Create Product + tối đa 9 lần Upload Image, nên 5 luồng đã là ~50 request đang
 * bay. Đẩy cao hơn chỉ đổi lỗi "chậm" lấy lỗi 429.
 */
export const POD_LISTING_JOB_CONCURRENCY = 5;

/** Số lần THỬ LẠI một item (không tính lần đầu). */
export const POD_LISTING_JOB_MAX_RETRIES = 3;

/** Backoff giữa các lần thử lại: base · 2^n, chặn trên bởi MAX. */
export const POD_LISTING_RETRY_BASE_DELAY_MS = 2_000;
export const POD_LISTING_RETRY_MAX_DELAY_MS = 60_000;

/** Trần số item của MỘT job — một cú bấm không được biến thành hàng giờ chạy nền. */
export const POD_LISTING_JOB_MAX_ITEMS = 2_000;

/**
 * Mỗi vòng nhận về `concurrency × hệ số này` item.
 *
 * Nhận đúng bằng concurrency thì mỗi vòng là một hàng rào: 4 luồng xong sớm phải đứng chờ
 * luồng chậm nhất. Nhận cả lô lớn hơn thì luồng nào rảnh tự lấy việc tiếp trong lô, chỉ
 * đồng bộ ở ranh giới lô.
 */
export const POD_LISTING_JOB_BATCH_FACTOR = 10;

/**
 * Số ảnh tối đa gửi kèm một sản phẩm TikTok.
 *
 * TikTok chỉ nhận 9 ảnh chính; bộ ảnh mẫu được phép nhiều hơn (người vận hành giữ sẵn
 * nhiều mockup) nên phải cắt tại đây theo đúng thứ tự đã sắp, thay vì để TikTok từ chối cả
 * sản phẩm vì tấm thứ 10.
 */
export const POD_LISTING_MAX_IMAGES = 9;

/**
 * Chu kỳ quét lại các job còn dang dở sau khi tiến trình khởi động lại.
 *
 * Queue chạy trong tiến trình (không Redis/BullMQ — hệ thống chưa có worker riêng), nên
 * trạng thái thật nằm ở DATABASE: restart giữa chừng thì item đang PROCESSING/RETRYING vẫn
 * còn nguyên và được nhặt lại ở lần quét kế tiếp.
 */
export const POD_LISTING_SWEEP_INTERVAL_MS = 30_000;

/**
 * Một item bị coi là "mồ côi" nếu đang PROCESSING quá lâu — tiến trình đã chết giữa chừng.
 * Ngưỡng phải lớn hơn thời gian xử lý thật của một item (upload 9 ảnh + create product).
 */
export const POD_LISTING_STALE_ITEM_MS = 10 * 60_000;

/**
 * Số sản phẩm gần nhất được quét khi rút `warehouse_id` từ dữ liệu đã đồng bộ (nguồn dự
 * phòng lúc app chưa có scope Logistics). Một shop hiếm khi có quá vài kho, nên quét vài
 * trăm sản phẩm gần nhất là đủ; quét cả chục nghìn chỉ để tìm lại cùng một id là lãng phí.
 */
export const POD_WAREHOUSE_DERIVE_SAMPLE = 200;

/**
 * Ảnh của Draft Listing là **URL do người dùng nhập** — server phải tự đi tải về rồi mới đẩy
 * lên sàn. Ba hàng rào bên dưới là bắt buộc cho việc đó.
 */
export const POD_IMAGE_FETCH_TIMEOUT_MS = 15_000;
export const POD_IMAGE_FETCH_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 🔴 Chặn SSRF: URL trỏ vào localhost hoặc dải IP nội bộ thì KHÔNG tải.
 *
 * Không có hàng rào này, một dòng Excel ghi `http://169.254.169.254/latest/meta-data/` là đủ
 * để bắt máy chủ tự đọc metadata của chính nó rồi gửi lên TikTok.
 */
export const POD_PRIVATE_HOST_PATTERN =
  /^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?fd)/i;

/** Trường sắp xếp cho danh sách Listing Job. */
export const POD_LISTING_JOB_SORT_FIELDS = [
  'createdAt',
  'finishedAt',
  'name',
  'status',
  'totalItems',
] as const;
export type PodListingJobSortField = (typeof POD_LISTING_JOB_SORT_FIELDS)[number];

/**
 * Mã lỗi của cổng VALIDATE — item mang một trong các mã này thì **không gửi request nào**
 * lên TikTok (yêu cầu sprint: thiếu Category/Brand/Warehouse/Attribute/Images/SKU/Price/Stock
 * ⇒ không gửi).
 */
export const POD_LISTING_BLOCKER_CODES = {
  MISSING_CATEGORY: 'LISTING_MISSING_CATEGORY',
  MISSING_BRAND: 'LISTING_MISSING_BRAND',
  MISSING_WAREHOUSE: 'LISTING_MISSING_WAREHOUSE',
  MISSING_ATTRIBUTE: 'LISTING_MISSING_ATTRIBUTE',
  MISSING_IMAGE: 'LISTING_MISSING_IMAGE',
  MISSING_SKU: 'LISTING_MISSING_SKU',
  MISSING_PRICE: 'LISTING_MISSING_PRICE',
  MISSING_STOCK: 'LISTING_MISSING_STOCK',
  MISSING_TITLE: 'LISTING_MISSING_TITLE',
  MISSING_DESCRIPTION: 'LISTING_MISSING_DESCRIPTION',
  MISSING_PACKAGE: 'LISTING_MISSING_PACKAGE',
} as const;

/** Mã lỗi validate của draft — frontend dịch sang thông điệp người dùng. */
export const POD_DRAFT_ISSUE_CODES = {
  MISSING_CATEGORY: 'DRAFT_MISSING_CATEGORY',
  MISSING_REQUIRED_ATTRIBUTE: 'DRAFT_MISSING_REQUIRED_ATTRIBUTE',
  MISSING_IMAGE: 'DRAFT_MISSING_IMAGE',
  MISSING_VARIANT: 'DRAFT_MISSING_VARIANT',
  MISSING_PRICE: 'DRAFT_MISSING_PRICE',
  MISSING_WAREHOUSE: 'DRAFT_MISSING_WAREHOUSE',
  MISSING_PACKAGE: 'DRAFT_MISSING_PACKAGE',
  MISSING_DESCRIPTION: 'DRAFT_MISSING_DESCRIPTION',
  MARKET_MISMATCH: 'DRAFT_MARKET_MISMATCH',
} as const;

// ---------------------------------------------------------------------------
// Sprint 5 — Publish Draft & Review Status
// ---------------------------------------------------------------------------

/**
 * Trạng thái Draft ĐƯỢC PHÉP publish.
 *
 * 🔴 Đúng yêu cầu sprint: "chỉ publish Draft ở LOCAL_DRAFT_CREATED hoặc TIKTOK_DRAFT_CREATED,
 * không publish Draft lỗi". Ánh xạ sang vòng đời của hệ thống:
 *   DRAFT / READY → Draft mới nằm ở database (local)
 *   TIKTOK_DRAFT  → Draft đã có trên sàn
 *
 * Cố ý KHÔNG có `FAILED` (draft lỗi), `PUBLISHING` (đang chạy — publish chồng lên nhau là
 * cách nhanh nhất để tạo sản phẩm trùng), `PUBLISHED` (đã gửi rồi), `ARCHIVED`.
 */
export const POD_PUBLISHABLE_PAYLOAD_STATUSES: readonly PodListingPayloadStatus[] = [
  PodListingPayloadStatus.DRAFT,
  PodListingPayloadStatus.READY,
  PodListingPayloadStatus.TIKTOK_DRAFT,
];

/**
 * Trạng thái duyệt CÒN CHUYỂN TIẾP — scheduler chỉ hỏi lại những listing này.
 *
 * `ACTIVE` và `OFFLINE` vẫn nằm trong danh sách: sản phẩm đang bán có thể bị sàn gỡ, sản
 * phẩm đã tắt có thể được bật lại. Chỉ `DELETED` là hết đường, và listing chưa có trạng thái
 * nào (`NULL`) thì cũng phải hỏi — đó là những cái vừa publish xong.
 */
export const POD_REVIEW_PENDING_STATUSES: readonly PodListingReviewStatus[] = [
  PodListingReviewStatus.UNDER_REVIEW,
  PodListingReviewStatus.APPROVED,
  PodListingReviewStatus.REJECTED,
  PodListingReviewStatus.ACTIVE,
  PodListingReviewStatus.OFFLINE,
];

/**
 * Số listing đọc lại trạng thái duyệt trong MỘT tick của scheduler.
 *
 * Mỗi listing là một lần Get Product. 200 listing/5 phút ≈ 0,7 request/giây cho toàn hệ
 * thống — đủ để một lô 1.000 sản phẩm cập nhật xong trong ~25 phút mà không đụng rate limit,
 * và ưu tiên cái lâu chưa hỏi nhất nên không bao giờ có listing bị bỏ quên vĩnh viễn.
 */
export const POD_REVIEW_SYNC_BATCH = 200;

/** Số lời gọi Get Product chạy song song khi đồng bộ trạng thái duyệt. */
export const POD_REVIEW_SYNC_CONCURRENCY = 5;

/**
 * Khoảng nghỉ tối thiểu giữa hai lần hỏi lại MỘT listing.
 *
 * Scheduler chạy 5 phút/lần theo yêu cầu sprint; ngưỡng này ngăn một lô nhỏ bị hỏi lại liên
 * tục mỗi tick trong khi lô lớn phía sau chưa tới lượt.
 */
export const POD_REVIEW_MIN_RECHECK_MS = 5 * 60_000;

/** Mã lỗi của cổng VALIDATE riêng cho bước Publish. */
export const POD_PUBLISH_BLOCKER_CODES = {
  MISSING_TIKTOK_DRAFT: 'PUBLISH_MISSING_TIKTOK_DRAFT',
  NOT_PUBLISHABLE: 'PUBLISH_NOT_PUBLISHABLE',
} as const;
