import type { FulfillmentOrder } from './types';

/**
 * Bản ghi fulfillment mà **đơn ở nhà cung cấp không còn tồn tại** (vd bị xoá thẳng trên Sellerwix / Mango,
 * phát hiện khi người dùng bấm Sync Fulfillment).
 *
 * Backend biểu diễn bằng dữ liệu sẵn có: `status = CANCELLED` + `lastErrorCode = PROVIDER_ORDER_NOT_FOUND`.
 * CANCELLED thuộc trạng thái gửi được ⇒ nút Fulfill tự bật lại; lần gửi mới dùng mã đơn mới (`-R{n}`).
 * Hàm này chỉ để HIỂN THỊ cho đúng ("không còn đơn" ≠ "đã huỷ có xác nhận"), không quyết định gửi được hay không.
 */
export const PROVIDER_ORDER_NOT_FOUND_CODE = 'PROVIDER_ORDER_NOT_FOUND';

export function isProviderOrderGone(
  record: Pick<FulfillmentOrder, 'status' | 'lastErrorCode'> | null | undefined,
): boolean {
  return record?.status === 'CANCELLED' && record.lastErrorCode === PROVIDER_ORDER_NOT_FOUND_CODE;
}
