import { FulfillmentStatus, type FulfillmentOrder } from '@prisma/client';
import {
  FulfillmentClientError,
  FulfillmentErrorClass,
} from '../exceptions/fulfillment.exceptions';

/**
 * Luật đối soát "nhà cung cấp đã nhận đơn hay chưa" — DÙNG CHUNG cho mọi nhà cung cấp.
 *
 * ```
 *   tạo đơn  ─ timeout / 5xx ─▶ tra theo mã tham chiếu ─┬─ có   ⇒ liên kết (SUBMITTED)
 *                                                       ├─ 404  ⇒ FAILED (gửi lại an toàn)
 *                                                       └─ lỗi  ⇒ giữ SUBMITTING, chờ đối soát
 *   đồng bộ  ─ SUBMITTING cũ / FAILED đã có mã đơn ─▶ tra lại ⇒ khôi phục trạng thái thật
 * ```
 */

/** Lỗi khi TẠO đơn mà request có thể ĐÃ tới nhà cung cấp. */
export const CREATE_AMBIGUOUS_ERROR_CLASSES: readonly FulfillmentErrorClass[] = [
  FulfillmentErrorClass.NETWORK,
  FulfillmentErrorClass.SERVER,
];

/**
 * Trạng thái local mà dữ liệu nhà cung cấp được phép KHÔI PHỤC: đơn đang chờ đối soát, hoặc bị đánh
 * FAILED trong khi nhà cung cấp thực ra đã có đơn (lỗi local / lỗi đồng bộ cũ hạ sai trạng thái).
 */
export const RECONCILABLE_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.SUBMITTING,
  FulfillmentStatus.FAILED,
];

/**
 * Bản ghi FAILED có mã nhà cung cấp chỉ được đối soát trong khoảng này kể từ mốc gửi. Quá hạn mà nhà cung
 * cấp vẫn không trả được đơn ⇒ dừng hỏi (không đốt hạn mức API mãi cho một đơn đã mất ở phía họ).
 */
export const RECONCILE_FAILED_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * Hỏi lại một bản ghi FAILED (đối soát) mà vẫn lỗi ⇒ KHÔNG ghi nhật ký / error log mỗi lượt (5 phút một lần
 * sẽ phủ kín timeline). Trạng thái FAILED vẫn đúng; chỉ log có cấu trúc.
 */
export function isQuietReconcileFailure(record: Pick<FulfillmentOrder, 'status'>): boolean {
  return record.status === FulfillmentStatus.FAILED;
}

/** SUBMITTING lâu hơn ngưỡng này ⇒ tiến trình gửi đã chết / không biết kết quả ⇒ đưa vào đối soát. */
export const RECONCILE_SUBMITTING_AFTER_MS = 2 * 60_000;

/** Lần gửi chờ đối soát mà nhà cung cấp trả 404 ⇒ request CHƯA từng tới nơi. */
export function isNeverArrived(
  record: Pick<FulfillmentOrder, 'status' | 'providerOrderId'>,
  error: unknown,
): boolean {
  return (
    record.status === FulfillmentStatus.SUBMITTING &&
    !record.providerOrderId &&
    error instanceof FulfillmentClientError &&
    error.errorClass === FulfillmentErrorClass.NOT_FOUND
  );
}

export function isRateLimited(error: unknown): boolean {
  return (
    error instanceof FulfillmentClientError && error.errorClass === FulfillmentErrorClass.RATE_LIMIT
  );
}
