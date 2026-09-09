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

/**
 * % giảm MẶC ĐỊNH của một dòng vừa được thêm vào đợt sale.
 *
 * 🔴 Trước đây dòng mới mặc định **0%** — hợp lệ với database nhưng KHÔNG hợp lệ để publish
 * (0% không phải khuyến mãi, xem BR-04). Hệ quả: thêm 600 SKU là sinh ra đúng 600 lỗi
 * "% giảm phải nằm trong khoảng (0, 100)", và người dùng phải sửa tay từng dòng trước khi
 * publish được. Một giá trị mặc định HỢP LỆ khiến đợt sale sẵn sàng ngay sau khi chọn hàng.
 *
 * 🔴 Áp ĐỘC LẬP cho từng SKU, tính từ giá gốc RIÊNG của SKU đó — không phải một giá deal
 * chung lấy theo SKU rẻ nhất. $10 và $20 cùng giảm 10% ra $9.00 và $18.00.
 *
 * Người dùng đổi được từng dòng sau đó (Edit / Batch Update).
 */
export const FLASH_SALE_DEFAULT_DISCOUNT_PERCENT = 10;

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

/**
 * Số dòng tối đa của MỘT đợt Flash Sale.
 *
 * 🔴 **Đây KHÔNG phải trần của TikTok.** Hai con số hoàn toàn khác nhau, trước đây bị nhập
 * làm một và đó chính là lý do hệ thống dừng ở 300:
 *
 * ```
 *   FLASH_SALE_MAX_ITEMS                  = 10.000  ← trần LỰA CHỌN của hệ thống (số này)
 *   TIKTOK_ACTIVITY_MAX_SKUS_PER_CALL     =    300  ← trần MỘT LƯỢT GỌI của TikTok
 * ```
 *
 * TikTok giới hạn 300 mục **cho mỗi request** Update Activity Products, không giới hạn tổng
 * số SKU của một hoạt động khuyến mãi. Nên 10.000 SKU vẫn nằm trong ĐÚNG MỘT hoạt động, chỉ
 * là được gửi lên qua 34 lượt gọi (xem `chunkActivityProducts`). Đặt trần chọn bằng trần gọi
 * là tự bắt người vận hành tạo 34 đợt sale rời rạc cho một chiến dịch duy nhất.
 *
 * Đổi con số này KHÔNG được đổi trần một lượt gọi, và ngược lại.
 */
export const FLASH_SALE_MAX_ITEMS = 10_000;
/** Số dòng tối thiểu để một đợt sale có nghĩa. */
export const FLASH_SALE_MIN_ITEMS = 1;
/**
 * Số dòng tối đa của MỘT request "Add Products".
 *
 * Trần của **kích thước một request HTTP**, không phải trần của đợt sale: chọn 10.000 SKU
 * thì giao diện tự chia thành nhiều lượt gọi. Giữ ở mức vừa phải để một request không phình
 * tới hàng chục MB (mỗi dòng mang giá, giới hạn mua và ba định danh phía sàn).
 */
export const FLASH_SALE_MAX_ADD_PER_CALL = 1_000;
/** Số dòng tối đa của một lần Batch Update / Batch Delete — cùng lý do như trên. */
export const FLASH_SALE_MAX_BATCH_ITEMS = 1_000;

/**
 * Cỡ trang tối đa khi ĐỌC danh sách (dòng sản phẩm, nhật ký).
 *
 * 🔴 Tách khỏi `FLASH_SALE_MAX_ITEMS`. Trước đây cỡ trang dùng chung hằng số với trần số
 * dòng — hai khái niệm không liên quan gì nhau, và khi trần số dòng lên 10.000 thì cỡ trang
 * cũng lên theo, cho phép một request kéo về 10.000 bản ghi. Trần 100 khớp quy ước phân
 * trang của toàn hệ thống (ADR-023, `PAGE_SIZE_OPTIONS` phía frontend).
 */
export const FLASH_SALE_PAGE_SIZE_MAX = 100;

// ---------------------------------------------------------------------------
// Lượt publish chạy nền
// ---------------------------------------------------------------------------

/**
 * Khoá phân tán cho MỘT lượt publish.
 *
 * 🔴 `@nestjs/schedule` chạy trên mọi instance API và người dùng có thể bấm Publish hai lần.
 * Khoá này là thứ bảo đảm đúng MỘT tiến trình đang đẩy sản phẩm của một đợt sale — không
 * có nó, hai tiến trình cùng gửi cùng một lô lên cùng một hoạt động.
 */
export const FLASH_SALE_PUBLISH_LOCK_PREFIX = 'pod:flash-sale:publish:lock:';

/**
 * TTL của khoá publish, và nhịp gia hạn.
 *
 * TTL ngắn hơn tổng thời gian chạy là cố ý: tiến trình chết thì khoá tự hết hạn sau 2 phút
 * và lượt quét nhặt lại được. Tiến trình còn sống thì watchdog gia hạn mỗi 30 giây, nên lượt
 * chạy dài bao lâu cũng không bị mất khoá giữa chừng.
 */
export const FLASH_SALE_PUBLISH_LOCK_TTL_MS = 120_000;
export const FLASH_SALE_PUBLISH_LOCK_RENEW_MS = 30_000;

/**
 * Sau bao lâu một đợt kẹt ở `PUBLISHING` được coi là mồ côi và cho phép chạy lại.
 *
 * Dài hơn TTL khoá rất nhiều: khoá hết hạn chỉ nói "không ai đang giữ", còn mốc này nói
 * "chắc chắn không còn ai chạy". Đặt sát nhau là tự cướp việc của một lượt đang chạy chậm.
 */
export const FLASH_SALE_PUBLISH_STALE_MS = 15 * 60 * 1000;

/** Số đợt publish mồ côi được nhặt lại trong MỘT lượt quét. */
export const FLASH_SALE_PUBLISH_SWEEP_BATCH = 5;

/**
 * Số lần thử lại MỘT lô khi gặp lỗi TẠM THỜI (mạng chập, TikTok 5xx), và nhịp lùi.
 *
 * 🔴 Chỉ áp cho lỗi tạm thời. Lỗi vĩnh viễn (SKU sai, hết hạn uỷ quyền, tham số không hợp lệ)
 * thử lại bao nhiêu lần cũng hỏng — thử lại chỉ làm chậm việc báo lỗi cho người vận hành và
 * đốt thêm quota.
 */
export const FLASH_SALE_BATCH_MAX_RETRIES = 3;
export const FLASH_SALE_BATCH_RETRY_BASE_MS = 1_000;
export const FLASH_SALE_BATCH_RETRY_MAX_MS = 15_000;

/**
 * Thời gian chờ tối đa cho MỘT lượt Update Activity Products.
 *
 * 🔴 SDK của TikTok (thư mục `vendor/`) không đặt timeout cho từng request, và `fetch` của
 * Node cũng không có mặc định. Một lượt gọi treo sẽ giữ khoá publish, chặn cả lượt quét, và
 * đợt sale kẹt ở `PUBLISHING` cho tới khi có người để ý.
 *
 * 🔴 Đây là timeout của MỘT lượt gọi, KHÔNG phải cách chữa timeout của cả lượt publish.
 * Vấn đề đó đã được giải bằng kiến trúc (request HTTP trả về ngay, các lô chạy nền) — nới
 * một con số timeout thật to chỉ đẩy sự cố đi chỗ khác. 60 giây là rộng rãi cho một request
 * mang 300 SKU và vẫn đủ chặt để phát hiện treo.
 *
 * Quá hạn được xếp vào lỗi TẠM THỜI ⇒ đi vào nhánh thử lại có lùi.
 */
export const FLASH_SALE_BATCH_TIMEOUT_MS = 60_000;

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
