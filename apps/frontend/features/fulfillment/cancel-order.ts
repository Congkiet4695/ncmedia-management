import { isNoResponseError, providerErrorBody } from './provider-error';
import type { FulfillmentOrder, FulfillmentState } from './types';

/**
 * Luật dùng chung của thao tác **Cancel Order** (huỷ đơn ở xưởng in) — cho MỌI nơi hiện nút:
 * menu Action của dòng đơn và drawer Fulfill Order. Hai nơi đọc cùng một hàm nên không thể lệch
 * nhau (một nơi hiện nút, nơi kia không).
 *
 * 🔴 Giao diện KHÔNG tự xét trạng thái: `state.canCancel` do backend tính
 * (`CANCELLABLE_FULFILLMENT_STATUSES` = SUBMITTED / ON_HOLD — "Accepted" chính là SUBMITTED).
 * Backend vẫn kiểm lại quyền, phạm vi shop và trạng thái thật ở nhà cung cấp trên mỗi request.
 */

/** Quyền của thao tác — khớp `@RequirePermissions('fulfillment.cancel')` ở backend. */
export const CANCEL_ORDER_PERMISSION = 'fulfillment.cancel';

/** Hiện nút Cancel Order ⇔ có quyền VÀ backend nói bản ghi hiện hành huỷ được. */
export function canShowCancelOrder(input: {
  allowed: boolean;
  state: Pick<FulfillmentState, 'canCancel'> | null | undefined;
}): boolean {
  return input.allowed && input.state?.canCancel === true;
}

/**
 * Kết cục của một lần huỷ THÀNH CÔNG về mặt HTTP.
 *
 * - `CANCELLED`: nhà cung cấp đã xác nhận ⇒ có thể Fulfill lại.
 * - `PENDING`: nhà cung cấp mới nhận yêu cầu (vd Sellerwix `cancel processing`) ⇒ chưa được báo
 *   "đã huỷ", chưa Fulfill lại được.
 */
export type CancelOrderOutcome = 'CANCELLED' | 'PENDING';

export function cancelOrderOutcome(record: Pick<FulfillmentOrder, 'status'>): CancelOrderOutcome {
  return record.status === 'CANCELLED' ? 'CANCELLED' : 'PENDING';
}

/**
 * Đã có yêu cầu huỷ đang chờ nhà cung cấp xác nhận (`state.cancelPending`, backend tính) ⇒ hiện trạng
 * thái "đang chờ huỷ" thay cho nút Cancel Order. Cùng điều kiện quyền với nút.
 */
export function isCancelOrderPending(input: {
  allowed: boolean;
  state: Pick<FulfillmentState, 'cancelPending'> | null | undefined;
}): boolean {
  return input.allowed && input.state?.cancelPending === true;
}

/** Mã lỗi backend nghĩa là "một yêu cầu huỷ khác đang chạy / đang chờ" — KHÔNG phải bị từ chối. */
const CANCEL_IN_PROGRESS_CODES: ReadonlySet<string> = new Set([
  'FULFILLMENT_CANCEL_PENDING',
  'FULFILLMENT_OPERATION_IN_PROGRESS',
]);

/**
 * Phân loại một lần huỷ KHÔNG nhận được kết quả thành công:
 *
 * - `UNKNOWN_OUTCOME`: không có phản hồi (timeout / mất mạng). Backend có thể VẪN đang xử lý và
 *   nhà cung cấp có thể đã nhận yêu cầu ⇒ KHÔNG được báo "không huỷ được"; tải lại trạng thái.
 * - `ALREADY_PENDING`: 409 vì đã có yêu cầu huỷ đang chờ / đang chạy ⇒ thông báo đang xử lý.
 * - `REJECTED`: nhà cung cấp / backend từ chối thật ⇒ báo lỗi, cho thử lại.
 */
export type CancelOrderFailure = 'UNKNOWN_OUTCOME' | 'ALREADY_PENDING' | 'REJECTED';

export function classifyCancelOrderError(error: unknown): CancelOrderFailure {
  if (isNoResponseError(error)) return 'UNKNOWN_OUTCOME';
  const code = providerErrorBody(error)?.code;
  if (code && CANCEL_IN_PROGRESS_CODES.has(code)) return 'ALREADY_PENDING';
  return 'REJECTED';
}
