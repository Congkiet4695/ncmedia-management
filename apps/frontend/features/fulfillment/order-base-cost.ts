/**
 * Luật nhập **Base Cost cấp đơn** (sửa tại chỗ ở cột Giá) — thuần, không React ⇒ kiểm bằng
 * `npm run test:base-cost`.
 *
 * 🔴 Trùng luật backend (`resolveOrderLevelBaseCost` + `UpdateOrderBaseCostDto`) và luật đọc cột Basecost của
 * Import Excel: số thập phân không dấu, dấu CHẤM thập phân, 0 ≤ giá ≤ `ORDER_BASE_COST_MAX`, số lẻ không vượt
 * đơn vị tiền. Để trống KHÔNG phải 0. Backend vẫn kiểm lại mọi thứ.
 */

/** Khớp `MANUAL_BASE_COST_MAX` của backend. */
export const ORDER_BASE_COST_MAX = 100_000;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

export type OrderBaseCostInputError = 'REQUIRED' | 'INVALID' | 'OUT_OF_RANGE' | 'TOO_MANY_DECIMALS';

/** Số chữ số thập phân của đơn vị tiền (USD 2, JPY 0) — cùng nguồn `Intl` với backend. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function parseOrderBaseCost(
  raw: string,
  currency: string,
): { ok: true; value: number } | { ok: false; error: OrderBaseCostInputError } {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'REQUIRED' };
  if (!DECIMAL_PATTERN.test(text)) return { ok: false, error: 'INVALID' };
  const value = Number(text);
  if (!Number.isFinite(value) || value > ORDER_BASE_COST_MAX) return { ok: false, error: 'OUT_OF_RANGE' };
  const [, fraction = ''] = String(value).split('.');
  if (/e/i.test(String(value)) || fraction.length > currencyDigits(currency)) {
    return { ok: false, error: 'TOO_MANY_DECIMALS' };
  }
  return { ok: true, value };
}
