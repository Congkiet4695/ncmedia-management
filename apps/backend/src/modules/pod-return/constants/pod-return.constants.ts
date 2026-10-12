import { PodReturnStatusGroup } from '@prisma/client';

/**
 * Hằng số module Return Orders (TikTok Return & Refund).
 *
 * 🔴 Danh sách trạng thái / loại yêu cầu lấy từ mô tả trường `return_status` / `return_type` của
 * Search Returns (`vendor/tiktok-shop-sdk/model/returnRefund/V202602/SearchReturnsResponseDataReturnOrders.ts`,
 * sinh từ tài liệu Partner Center). Trạng thái lạ ⇒ nhóm OTHER, raw status vẫn được lưu — không đoán.
 */

/** `return_status` ⇒ nhóm hiển thị nội bộ. */
export const RETURN_STATUS_GROUP: Readonly<Record<string, PodReturnStatusGroup>> = {
  RETURN_OR_REFUND_REQUEST_PENDING: PodReturnStatusGroup.PENDING,
  REPLACEMENT_REQUEST_PENDING: PodReturnStatusGroup.PENDING,
  // Đã duyệt — chờ người mua gửi hàng / seller nhận hàng / TikTok chi tiền.
  AWAITING_BUYER_SHIP: PodReturnStatusGroup.PROCESSING,
  BUYER_SHIPPED_ITEM: PodReturnStatusGroup.PROCESSING,
  // "approved. The buyer WILL be refunded" — chưa phải đã hoàn.
  RETURN_OR_REFUND_REQUEST_SUCCESS: PodReturnStatusGroup.PROCESSING,
  RETURN_OR_REFUND_REQUEST_COMPLETE: PodReturnStatusGroup.COMPLETED,
  REPLACEMENT_REQUEST_REFUND_SUCCESS: PodReturnStatusGroup.COMPLETED,
  REPLACEMENT_REQUEST_COMPLETE: PodReturnStatusGroup.COMPLETED,
  REFUND_OR_RETURN_REQUEST_REJECT: PodReturnStatusGroup.REJECTED,
  REPLACEMENT_REQUEST_REJECT: PodReturnStatusGroup.REJECTED,
  REJECT_RECEIVE_PACKAGE: PodReturnStatusGroup.REJECTED,
  RETURN_OR_REFUND_REQUEST_CANCEL: PodReturnStatusGroup.CANCELLED,
  REPLACEMENT_REQUEST_CANCEL: PodReturnStatusGroup.CANCELLED,
};

/**
 * Trạng thái TikTok xác nhận người mua ĐÃ được hoàn tiền:
 *  - `RETURN_OR_REFUND_REQUEST_COMPLETE`: "processed successfully. The buyer has been refunded."
 *  - `REPLACEMENT_REQUEST_REFUND_SUCCESS`: yêu cầu đổi hàng được giải quyết bằng hoàn tiền.
 * `REPLACEMENT_REQUEST_COMPLETE` (TikTok tạo đơn thay thế) KHÔNG phải hoàn tiền.
 */
export const RETURN_REFUNDED_STATUSES: ReadonlySet<string> = new Set([
  'RETURN_OR_REFUND_REQUEST_COMPLETE',
  'REPLACEMENT_REQUEST_REFUND_SUCCESS',
]);

/** `return_type` đã biết — chỉ để gợi ý bộ lọc; giá trị khác vẫn lưu và lọc được. */
export const RETURN_TYPES = ['REFUND', 'RETURN_AND_REFUND', 'REPLACEMENT', 'EXCHANGE'] as const;

export const POD_RETURN_PERMISSIONS = {
  READ: 'pod.tiktok.return.read',
  SYNC: 'pod.tiktok.return.sync',
} as const;

/** Khoá phân tán: một shop chỉ có MỘT lượt đồng bộ Return tại một thời điểm (cron + thủ công). */
export const POD_RETURN_SYNC_SHOP_LOCK_PREFIX = 'pod:tiktok:return-sync:shop:';
/** Khoá của cả lượt cron (nhiều instance API cùng chạy scheduler). */
export const POD_RETURN_SYNC_GLOBAL_LOCK = 'pod:tiktok:return-sync:global';

/** Mã lỗi ghi vào trạng thái đồng bộ / trả cho giao diện. */
export const POD_RETURN_SYNC_ERROR_CODES = {
  /** TikTok 105005 — app / shop chưa được cấp scope `seller.return_refund.basic`. */
  SCOPE_MISSING: 'RETURN_SCOPE_MISSING',
  /** Token hết hạn / cần uỷ quyền lại. */
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  SHOP_NOT_FOUND: 'SHOP_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  TIKTOK_UNAVAILABLE: 'TIKTOK_UNAVAILABLE',
  /** Chạm trần số trang — watermark KHÔNG tiến, lượt sau đọc tiếp. */
  PAGE_LIMIT: 'PAGE_LIMIT',
  ALREADY_RUNNING: 'ALREADY_RUNNING',
  UNKNOWN: 'UNKNOWN',
} as const;
export type PodReturnSyncErrorCode = (typeof POD_RETURN_SYNC_ERROR_CODES)[keyof typeof POD_RETURN_SYNC_ERROR_CODES];

/** Số yêu cầu ghi trong MỘT transaction (mỗi yêu cầu kèm dòng hàng + sự kiện thông báo). */
export const POD_RETURN_WRITE_CHUNK = 25;

/** Lịch sử đọc gần đây hơn mốc này và yêu cầu chưa đổi ⇒ dùng bản đã lưu, không gọi lại TikTok. */
export const POD_RETURN_HISTORY_FRESH_MS = 10 * 60_000;

/** Trang Return Orders trên frontend — link trong thông báo Telegram. */
export const POD_RETURN_ORDERS_PATH = '/dashboard/pod/returns';

export const POD_RETURN_SORT_FIELDS = ['requestedAt', 'tiktokUpdatedAt', 'refundTotal'] as const;
export type PodReturnSortField = (typeof POD_RETURN_SORT_FIELDS)[number];
