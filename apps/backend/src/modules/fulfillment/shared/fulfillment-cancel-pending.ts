import { FulfillmentEventType, FulfillmentStatus } from '@prisma/client';
import { CANCELLABLE_FULFILLMENT_STATUSES } from './fulfillment-lifecycle';

/**
 * **Đang chờ huỷ** — biểu diễn bằng dữ liệu SẴN CÓ, không thêm trạng thái/cột mới.
 *
 * 🔴 Vì sao cần: Sellerwix huỷ BẤT ĐỒNG BỘ. `POST /v1/order/:id/cancel` có thể chỉ trả
 * `{"message": "Order cancellation request has been sent and is being processed"}` — nhận yêu cầu,
 * CHƯA huỷ. Trong khoảng đó bản ghi vẫn SUBMITTED / ON_HOLD (đúng trạng thái thật phía nhà cung cấp),
 * nên chỉ nhìn `status` thì nút huỷ vẫn bật và người dùng gửi yêu cầu huỷ lần hai.
 *
 * Nguồn sự thật là nhật ký (`fulfillment_histories`) mà luồng huỷ vốn đã ghi:
 *   - `CANCEL_REQUEST`  — ghi NGAY TRƯỚC lời gọi huỷ (chưa có kết quả: đang gửi / không rõ kết cục)
 *   - `CANCEL_SUCCESS`  — nhà cung cấp đã NHẬN yêu cầu (chưa chắc đã huỷ)
 *   - `CANCEL_FAILED`   — nhà cung cấp từ chối / lỗi ⇒ được thử lại
 * cộng `provider_status = "cancel processing"` khi Sellerwix tự báo đang xử lý huỷ.
 *
 * Kết thúc chờ: bản ghi rời trạng thái huỷ được (CANCELLED khi nhà cung cấp xác nhận, hoặc đã vào
 * sản xuất). Có hạn để một yêu cầu bị nhà cung cấp "nuốt" không khoá nút huỷ vĩnh viễn.
 */

/** Trạng thái phía Sellerwix nghĩa là "đang xử lý huỷ" (`fulfillments[].status`). */
export const CANCEL_PROCESSING_PROVIDER_STATUS = 'cancel processing';

/** Các sự kiện tạo nên dòng thời gian huỷ của một bản ghi. */
export const CANCEL_TIMELINE_EVENTS: readonly FulfillmentEventType[] = [
  FulfillmentEventType.CANCEL_REQUEST,
  FulfillmentEventType.CANCEL_SUCCESS,
  FulfillmentEventType.CANCEL_FAILED,
];

/**
 * Nhà cung cấp đã NHẬN yêu cầu huỷ nhưng chưa xác nhận ⇒ coi là đang chờ trong khoảng này. Hết hạn mà
 * vẫn chưa huỷ (nhà cung cấp không xử lý) ⇒ cho gửi lại — người vận hành cần một đường thoát.
 */
export const CANCEL_ACCEPTED_PENDING_MS = 24 * 60 * 60_000;

/**
 * Đã ghi `CANCEL_REQUEST` mà chưa có kết quả ⇒ lời gọi đang chạy (hoặc tiến trình chết giữa chừng).
 * Lâu hơn timeout xấu nhất của một lượt huỷ (GET + POST + điều tiết + thử lại) nhưng ngắn để một lượt
 * chết giữa chừng không khoá lâu.
 */
export const CANCEL_IN_FLIGHT_MS = 10 * 60_000;

export interface CancelTimelineEvent {
  eventType: FulfillmentEventType;
  createdAt: Date;
}

/**
 * Bản ghi có đang chờ nhà cung cấp xác nhận huỷ không.
 *
 * @param latest Sự kiện huỷ GẦN NHẤT của bản ghi (một trong `CANCEL_TIMELINE_EVENTS`), hoặc `null`.
 */
export function isCancelPending(
  record: { status: FulfillmentStatus; providerStatus: string | null },
  latest: CancelTimelineEvent | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!CANCELLABLE_FULFILLMENT_STATUSES.includes(record.status)) return false;
  if (record.providerStatus?.toLowerCase().includes(CANCEL_PROCESSING_PROVIDER_STATUS)) return true;
  if (!latest) return false;
  const age = now.getTime() - latest.createdAt.getTime();
  if (latest.eventType === FulfillmentEventType.CANCEL_SUCCESS) return age < CANCEL_ACCEPTED_PENDING_MS;
  if (latest.eventType === FulfillmentEventType.CANCEL_REQUEST) return age < CANCEL_IN_FLIGHT_MS;
  return false;
}
