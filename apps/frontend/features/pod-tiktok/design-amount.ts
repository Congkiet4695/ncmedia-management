/** Khớp `POD_ORDER_DESIGN_AMOUNT_MAX` của backend. */
export const DESIGN_AMOUNT_MAX = 1_000_000;
const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Chuỗi người dùng gõ ở ô Design Amount ⇒ số tiền hợp lệ (≥ 0, tối đa 2 chữ số thập phân, ≤ tối đa) hoặc `null`.
 * Chấp nhận dấu phẩy thập phân (`2,5`). Hàm thuần — kiểm bằng `npm run test:design-amount`.
 */
export function parseDesignAmount(raw: string): number | null {
  const value = raw.trim().replace(',', '.');
  if (!MONEY_PATTERN.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount <= DESIGN_AMOUNT_MAX ? amount : null;
}
