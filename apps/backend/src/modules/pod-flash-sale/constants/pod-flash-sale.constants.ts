import { PodFlashSaleStatus } from '@prisma/client';
import {
  TIKTOK_ACTIVITY_MAX_QUANTITY,
  TIKTOK_ACTIVITY_MIN_QUANTITY,
  TIKTOK_ACTIVITY_STATUS,
  TIKTOK_ACTIVITY_UNLIMITED_QUANTITY,
  type TiktokActivityStatus,
} from '../../tiktok-sdk/tiktok-sdk.constants';

/**
 * Hằng số của module Flash Sale.
 *
 * 🔴 Không có chuỗi ma thuật nào ngoài file này: mọi giới hạn, mọi phép ánh xạ trạng thái,
 * mọi mã lỗi nghiệp vụ đều khai báo ở đây để validator, service, scheduler và bộ dựng
 * payload cùng đọc MỘT nguồn.
 */

// ---------------------------------------------------------------------------
// Sàn
// ---------------------------------------------------------------------------

/** Giá trị cột `provider`. Hôm nay chỉ có TikTok — thêm sàn khác không phải migration enum. */
export const POD_FLASH_SALE_PROVIDER_TIKTOK = 'TIKTOK';

// ---------------------------------------------------------------------------
// Giới hạn số lượng mua (dùng lại đúng dải của TikTok, không tự định nghĩa dải khác)
// ---------------------------------------------------------------------------

export const FLASH_SALE_UNLIMITED = TIKTOK_ACTIVITY_UNLIMITED_QUANTITY;
export const FLASH_SALE_MIN_QUANTITY = TIKTOK_ACTIVITY_MIN_QUANTITY;
export const FLASH_SALE_MAX_QUANTITY = TIKTOK_ACTIVITY_MAX_QUANTITY;

// ---------------------------------------------------------------------------
// Giá
// ---------------------------------------------------------------------------

/**
 * Giá deal thấp nhất được phép gửi lên sàn.
 *
 * 🔴 TikTok **không công bố** một ngưỡng giá tuyệt đối dùng chung cho mọi thị trường; điều
 * chắc chắn là giá phải dương và đơn vị tiền nhỏ nhất của các thị trường hệ thống đang phục
 * vụ là 0.01. Đặt sàn ở đây để hệ thống báo lỗi RÕ RÀNG trước khi gọi API, thay vì nhận về
 * một mã lỗi khó hiểu của TikTok. Thị trường có quy định riêng ⇒ chỉnh đúng hằng số này.
 */
export const FLASH_SALE_MIN_PRICE = 0.01;

/**
 * % giảm hợp lệ: `(0, 100)`.
 *
 * Giảm 0% là không phải khuyến mãi (và TikTok từ chối vì giá deal = giá gốc); giảm 100% là
 * bán 0 đồng — cả hai đều bị chặn ở validator lẫn CHECK constraint của database.
 */
export const FLASH_SALE_MIN_DISCOUNT_PERCENT = 0;
export const FLASH_SALE_MAX_DISCOUNT_PERCENT = 100;

/** Số chữ số thập phân của giá tiền gửi lên sàn. */
export const FLASH_SALE_PRICE_SCALE = 2;
/** Số chữ số thập phân của % giảm (khớp `Decimal(7,4)` trong schema). */
export const FLASH_SALE_DISCOUNT_SCALE = 4;

// ---------------------------------------------------------------------------
// Thời gian
// ---------------------------------------------------------------------------

/**
 * Khoảng đệm tối thiểu giữa "bây giờ" và `startAt` khi PUBLISH.
 *
 * TikTok yêu cầu `begin_time` phải lớn hơn thời điểm hiện tại. Bấm Publish đúng vào giây
 * bắt đầu thì request đến nơi đã trễ ⇒ lỗi. Một phút đệm đủ cho độ trễ mạng lẫn lệch đồng
 * hồ giữa máy chủ và TikTok.
 */
export const FLASH_SALE_MIN_LEAD_SECONDS = 60;

/** Thời lượng tối thiểu của một đợt — dưới mức này gần như chắc chắn là nhập nhầm. */
export const FLASH_SALE_MIN_DURATION_MINUTES = 15;

// ---------------------------------------------------------------------------
// Kích thước
// ---------------------------------------------------------------------------

/** Số dòng tối đa của MỘT đợt Flash Sale (bằng trần một lần gọi của TikTok). */
export const FLASH_SALE_MAX_ITEMS = 300;
/** Số sản phẩm tối đa được thêm trong MỘT lần bấm "Add Products". */
export const FLASH_SALE_MAX_ADD_PER_CALL = 100;
/** Số dòng tối đa của một lần Batch Update / Batch Delete. */
export const FLASH_SALE_MAX_BATCH_ITEMS = 300;

// ---------------------------------------------------------------------------
// Sắp xếp
// ---------------------------------------------------------------------------

export const FLASH_SALE_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'status',
  'startAt',
  'endAt',
  'itemCount',
] as const;
export type PodFlashSaleSortField = (typeof FLASH_SALE_SORT_FIELDS)[number];

export const FLASH_SALE_TEMPLATE_SORT_FIELDS = ['createdAt', 'updatedAt', 'name'] as const;
export type PodFlashSaleTemplateSortField = (typeof FLASH_SALE_TEMPLATE_SORT_FIELDS)[number];

// ---------------------------------------------------------------------------
// Ánh xạ trạng thái TikTok ⇄ hệ thống
// ---------------------------------------------------------------------------

/**
 * Trạng thái phía TikTok ⇒ trạng thái trong hệ thống.
 *
 * 🔴 Đây là NƠI DUY NHẤT hai vòng đời gặp nhau. `NOT_START` và `ONGOING` cùng quy về
 * `RUNNING` vì với người vận hành, cả hai đều có nghĩa "đã lên sàn, không phải làm gì nữa";
 * phân biệt sớm/muộn đã có cột `startAt`. `DRAFT` phía TikTok quy về `READY` chứ không phải
 * `DRAFT` nội bộ: hoạt động ĐÃ tồn tại trên sàn, chỉ là chưa có sản phẩm — lùi nó về DRAFT
 * sẽ khiến người dùng tưởng chưa publish và bấm Publish lần nữa.
 */
export const TIKTOK_TO_FLASH_SALE_STATUS: Record<TiktokActivityStatus, PodFlashSaleStatus> = {
  [TIKTOK_ACTIVITY_STATUS.DRAFT]: PodFlashSaleStatus.READY,
  [TIKTOK_ACTIVITY_STATUS.NOT_START]: PodFlashSaleStatus.RUNNING,
  [TIKTOK_ACTIVITY_STATUS.ONGOING]: PodFlashSaleStatus.RUNNING,
  [TIKTOK_ACTIVITY_STATUS.EXPIRED]: PodFlashSaleStatus.ENDED,
  [TIKTOK_ACTIVITY_STATUS.DEACTIVATED]: PodFlashSaleStatus.CANCELLED,
  // Nền tảng chấm dứt hoạt động (vi phạm chính sách) — với người vận hành đây là THẤT BẠI
  // cần xử lý, không phải "đã kết thúc bình thường".
  [TIKTOK_ACTIVITY_STATUS.NOT_EFFECTIVE]: PodFlashSaleStatus.FAILED,
};

/** Trạng thái mà người dùng còn được SỬA (tên, giờ, sản phẩm, giá). */
export const FLASH_SALE_EDITABLE_STATUSES: PodFlashSaleStatus[] = [
  PodFlashSaleStatus.DRAFT,
  PodFlashSaleStatus.READY,
  PodFlashSaleStatus.FAILED,
];

/** Trạng thái cho phép bấm Publish (hoặc Retry Publish). */
export const FLASH_SALE_PUBLISHABLE_STATUSES: PodFlashSaleStatus[] = [
  PodFlashSaleStatus.DRAFT,
  PodFlashSaleStatus.READY,
  PodFlashSaleStatus.FAILED,
];

/** Trạng thái cho phép bấm Cancel. */
export const FLASH_SALE_CANCELLABLE_STATUSES: PodFlashSaleStatus[] = [
  PodFlashSaleStatus.DRAFT,
  PodFlashSaleStatus.READY,
  PodFlashSaleStatus.RUNNING,
  PodFlashSaleStatus.FAILED,
];

/**
 * Trạng thái mà giao diện phải TỰ LÀM MỚI (30 giây/lần theo yêu cầu sprint).
 *
 * Khai báo ở backend và trả kèm response để frontend không tự đoán — đổi luật chỉ sửa ở đây.
 */
export const FLASH_SALE_LIVE_STATUSES: PodFlashSaleStatus[] = [
  PodFlashSaleStatus.PUBLISHING,
  PodFlashSaleStatus.RUNNING,
];

/** Trạng thái mà scheduler cần hỏi lại TikTok. */
export const FLASH_SALE_SYNCABLE_STATUSES: PodFlashSaleStatus[] = [
  PodFlashSaleStatus.PUBLISHING,
  PodFlashSaleStatus.RUNNING,
];

/**
 * Số đợt sale được hỏi lại TikTok trong MỘT lượt scheduler.
 *
 * 🔴 Trần cứng, không phải tuỳ chọn: mỗi đợt là một lượt gọi Get Activity, và quota TikTok
 * cấp theo App × Shop dùng chung cho mọi tổ chức. Phần dư được xử lý ở lượt sau — chậm hơn
 * thì chấp nhận được, bị sàn giới hạn tần suất thì không.
 */
export const FLASH_SALE_SYNC_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Mã lỗi kiểm tra (validation) — frontend dịch sang thông điệp người dùng
// ---------------------------------------------------------------------------

export const FLASH_SALE_ISSUE_CODES = {
  NO_ITEMS: 'FLASH_SALE_NO_ITEMS',
  TIME_RANGE_INVALID: 'FLASH_SALE_TIME_RANGE_INVALID',
  START_IN_PAST: 'FLASH_SALE_START_IN_PAST',
  DURATION_TOO_SHORT: 'FLASH_SALE_DURATION_TOO_SHORT',
  NAME_TOO_LONG: 'FLASH_SALE_NAME_TOO_LONG',
  PRICE_NOT_POSITIVE: 'FLASH_SALE_PRICE_NOT_POSITIVE',
  PRICE_BELOW_MINIMUM: 'FLASH_SALE_PRICE_BELOW_MINIMUM',
  PRICE_ABOVE_RETAIL: 'FLASH_SALE_PRICE_ABOVE_RETAIL',
  DISCOUNT_OUT_OF_RANGE: 'FLASH_SALE_DISCOUNT_OUT_OF_RANGE',
  LIMIT_OUT_OF_RANGE: 'FLASH_SALE_LIMIT_OUT_OF_RANGE',
  MISSING_PROVIDER_ID: 'FLASH_SALE_MISSING_PROVIDER_ID',
  ITEM_LIMIT_EXCEEDED: 'FLASH_SALE_ITEM_LIMIT_EXCEEDED',
  CURRENCY_MISMATCH: 'FLASH_SALE_CURRENCY_MISMATCH',
  PRODUCT_NOT_ACTIVE: 'FLASH_SALE_PRODUCT_NOT_ACTIVE',
} as const;
export type PodFlashSaleIssueCode =
  (typeof FLASH_SALE_ISSUE_CODES)[keyof typeof FLASH_SALE_ISSUE_CODES];

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

export const FLASH_SALE_PERMISSIONS = {
  READ: 'pod.flashsale.read',
  WRITE: 'pod.flashsale.write',
  PUBLISH: 'pod.flashsale.publish',
} as const;
