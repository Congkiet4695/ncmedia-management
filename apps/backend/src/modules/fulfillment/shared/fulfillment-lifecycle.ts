import { FulfillmentStatus } from '@prisma/client';

/**
 * Vòng đời MỘT lần gửi fulfillment — luật dùng chung cho MỌI nhà cung cấp.
 *
 * 🔴 Trước đây mỗi service (Mango, Sellerwix, FulfillmentService) tự khai một bản
 * `RESUBMITTABLE_STATUSES` / `CANCELLABLE_STATUSES`. Ba bản sao là ba chỗ phải sửa khi luật đổi —
 * và đúng lần đổi này (cho fulfill lại sau khi huỷ) là lúc chúng lệch nhau.
 *
 * ```
 *   DRAFT ─▶ SUBMITTING ─▶ SUBMITTED ─▶ IN_PRODUCTION ─▶ SHIPPED ─▶ DELIVERED
 *     ▲          │              │  ▲
 *     │          ▼              ▼  │ (nhà cung cấp xác nhận huỷ)
 *     │       FAILED ◀──retry  ON_HOLD
 *     │                         │
 *     │                     CANCELLED ──(Fulfill lại)──▶ bản ghi CŨ được LƯU TRỮ,
 *     └───────────────────────────────────────────────── bản ghi MỚI với mã đơn MỚI
 * ```
 */

/**
 * Trạng thái của bản ghi hiện hành cho phép bấm Fulfill.
 *
 * `CANCELLED` = nhà cung cấp đã XÁC NHẬN huỷ ⇒ gửi lại được, nhưng là một LẦN THỬ MỚI (bản ghi
 * mới, mã đơn mới) — xem `isNewAttemptOnSubmit`. Không bao giờ gửi lại trên chính bản ghi đã huỷ:
 * mã đơn cũ đã bị nhà cung cấp "tiêu thụ" (Mango chặn `order_id` trùng).
 */
export const SUBMITTABLE_FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.DRAFT,
  FulfillmentStatus.FAILED,
  FulfillmentStatus.CANCELLED,
];

/**
 * Trạng thái cho phép YÊU CẦU huỷ ở nhà cung cấp. Đây mới là điều kiện CẦN — trạng thái thật
 * phía nhà cung cấp được hỏi lại ngay trước khi gọi huỷ (đơn có thể đã vào sản xuất sau lượt
 * đồng bộ gần nhất).
 */
export const CANCELLABLE_FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.SUBMITTED,
  FulfillmentStatus.ON_HOLD,
];

/**
 * Trạng thái mà một bản ghi fulfillment KHÔNG còn giữ đơn ở xưởng in: chưa gửi, gửi hỏng, đã huỷ,
 * bị từ chối. Bản ghi ở trạng thái KHÁC nghĩa là đơn đang/đã được sản xuất ở nhà cung cấp đó —
 * và chỉ những bản ghi đó mới có giá vốn tính vào lợi nhuận.
 */
export const NON_BLOCKING_FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.DRAFT,
  FulfillmentStatus.FAILED,
  FulfillmentStatus.CANCELLED,
  FulfillmentStatus.REJECTED,
];

/**
 * Khoá phân tán cho MỌI thao tác ghi trạng thái fulfillment của một đơn (gửi / gửi lại / huỷ), dùng
 * chung cho mọi nhà cung cấp. Cùng một khoá ⇒ hai lần huỷ đồng thời, hoặc huỷ trong lúc đang gửi,
 * không thể chạy chồng lên nhau.
 */
export function fulfillmentOrderLockKey(podOrderId: string): string {
  return `fulfillment:fulfill:${podOrderId}`;
}

/** Gửi trên bản ghi này có phải là MỘT LẦN THỬ MỚI (lưu trữ bản ghi cũ, sinh mã đơn mới) không. */
export function isNewAttemptOnSubmit(status: FulfillmentStatus | null | undefined): boolean {
  return status === FulfillmentStatus.CANCELLED;
}

/**
 * Mã đơn gửi sang nhà cung cấp cho lần thử thứ `attempt` (bắt đầu từ 1).
 *
 * - Lần 1: đúng mã gốc — hành vi cũ không đổi (Mango `NC-{tiktokOrderId}`, Sellerwix mã đơn TikTok).
 * - Lần n ≥ 2 (sau khi huỷ): `{mã gốc}-R{n}` — mã mới, tất định theo số lần thử.
 *
 * 🔴 Tất định (không ngẫu nhiên): retry của CÙNG một lần thử phải gửi lại ĐÚNG mã đó để nhà cung
 * cấp chặn trùng / để tra lại được. Chỉ lần thử mới (sau khi huỷ) mới đổi mã.
 *
 * Quá độ dài tối đa ⇒ cắt phần GỐC, luôn giữ hậu tố — cắt hậu tố là quay về mã cũ đã bị tiêu thụ.
 */
export function attemptExternalId(baseId: string, attempt: number, maxLength: number): string {
  if (attempt <= 1) return baseId.length <= maxLength ? baseId : baseId.slice(0, maxLength);
  const suffix = `-R${attempt}`;
  return `${baseId.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`;
}
