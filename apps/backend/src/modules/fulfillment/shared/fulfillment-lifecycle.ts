import { FulfillmentProvider, FulfillmentSource, FulfillmentStatus } from '@prisma/client';

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

/**
 * Bản ghi do Admin đánh dấu đã fulfill bằng Import Excel — KHÔNG tồn tại ở nhà cung cấp.
 *
 * 🔴 Mọi thao tác gọi API nhà cung cấp trên bản ghi (đồng bộ, huỷ, sửa) phải hỏi hàm này trước: hỏi nhà cung
 * cấp về một đơn họ chưa từng nhận sẽ nhận 404 và hạ bản ghi xuống FAILED — xoá mất thao tác của Admin.
 */
export function isManualImportRecord(record: { source?: FulfillmentSource | null }): boolean {
  return record.source === FulfillmentSource.MANUAL_IMPORT;
}

/**
 * Bản ghi ĐANG giữ đơn: không ở trạng thái non-blocking, và hoặc nhà cung cấp đã nhận (có mốc gửi), hoặc Admin
 * đã đánh dấu đã fulfill bằng Import Excel (không có mốc gửi — không gửi gì đi cả).
 */
export function holdsFulfilledOrder(record: {
  status: FulfillmentStatus;
  submittedAt: Date | null;
  source?: FulfillmentSource | null;
}): boolean {
  if (NON_BLOCKING_FULFILLMENT_STATUSES.includes(record.status)) return false;
  return record.submittedAt !== null || isManualImportRecord(record);
}

/**
 * Import Excel đánh dấu đã fulfill ⇒ `SHIPPED` (quyết định PO 2026-11-02): đã có mã vận đơn. Không dùng
 * `SUBMITTED` (nghĩa là nhà cung cấp đã nhận) để không giả kết quả của nhà cung cấp.
 */
export const IMPORT_FULFILLED_STATUS = FulfillmentStatus.SHIPPED;

/**
 * Trạng thái của bản ghi HIỆN HÀNH mà Import Excel được phép chuyển sang đã fulfill: chưa gửi (`DRAFT`) và gửi
 * hỏng (`FAILED`). Đơn chưa có bản ghi nào cũng được (tạo bản ghi mới). `CANCELLED` / `REJECTED` KHÔNG — nhà
 * cung cấp đã huỷ / từ chối là sự thật phải giữ, không được import đè thành "đã fulfill".
 */
export const IMPORT_MARKABLE_STATUSES: readonly FulfillmentStatus[] = [
  FulfillmentStatus.DRAFT,
  FulfillmentStatus.FAILED,
];

/**
 * Bản ghi CÓ nhà cung cấp (và vì vậy có tài khoản — CHECK `fulfillment_orders_account_provider_pair_check`).
 *
 * `account_id` / `provider` chỉ NULL ở bản ghi nhập tay (Import Excel) của đơn mà kết nối TikTok chưa gán nhà cung cấp.
 * Mọi luồng gọi API nhà cung cấp phải làm việc trên kiểu này — thu hẹp bằng `hasProvider`, không ép kiểu.
 */
export type WithProvider<T extends { accountId: string | null; provider: FulfillmentProvider | null }> = T & {
  accountId: string;
  provider: FulfillmentProvider;
};

export function hasProvider<T extends { accountId: string | null; provider: FulfillmentProvider | null }>(
  record: T,
): record is WithProvider<T> {
  return record.provider !== null && record.accountId !== null;
}
