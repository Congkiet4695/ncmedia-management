/**
 * "Tiền giao account" — hằng số nghiệp vụ dùng chung (Employee + POD TikTok).
 *
 * Số tiền cộng mỗi lần KHÔNG nằm ở đây: cấu hình `ACCOUNT_HANDOVER_CREDIT_AMOUNT` (mặc định 40) — xem
 * `AccountHandoverService.creditAmount`.
 */

/** Đơn vị tiền của cột `employees.account_handover_amount` và sổ cái. */
export const ACCOUNT_HANDOVER_CURRENCY = 'USD';

/** Giới hạn của DECIMAL(15,2). */
export const ACCOUNT_HANDOVER_MAX_AMOUNT = 9_999_999_999_999.99;

/**
 * Khoá sự kiện của khoản cộng tự động cho MỘT TikTok Account.
 *
 * 🔴 Khoá theo ACCOUNT (không theo cặp account × employee): một account chỉ sinh khoản "giao account" MỘT lần
 * trong suốt vòng đời. Retry, đi qua cả luồng link lẫn assign, unlink rồi link lại, chuyển A → B → A đều KHÔNG
 * cộng thêm (chưa có chính sách hoàn trả / cộng lại khi chuyển người — xem docs/employee.md).
 */
export function tiktokAccountHandoverEventKey(tiktokAccountId: string): string {
  return `TIKTOK_ACCOUNT_HANDOVER:${tiktokAccountId}`;
}

/** Khoá sự kiện của một lần chỉnh tay (mỗi lần một khoá mới). */
export function manualAdjustmentEventKey(id: string): string {
  return `MANUAL_ADJUSTMENT:${id}`;
}
