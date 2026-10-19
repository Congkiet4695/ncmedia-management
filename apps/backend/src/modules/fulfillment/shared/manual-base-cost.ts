import { FulfillmentStatus } from '@prisma/client';
import { NON_BLOCKING_FULFILLMENT_STATUSES } from './fulfillment-lifecycle';

/**
 * Số chữ số thập phân hợp lệ của MỘT đơn vị tiền (USD 2, JPY 0, KWD 3) — theo dữ liệu ISO 4217 có sẵn
 * trong `Intl` của Node. Không có bảng tự chép.
 */
export function currencyFractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** `value` có nhiều hơn `digits` chữ số thập phân không (so sánh trên chuỗi, tránh sai số float). */
export function exceedsFractionDigits(value: number, digits: number): boolean {
  const [, fraction = ''] = String(value).split('.');
  // Dạng 1e-7 ⇒ coi là quá số lẻ cho mọi đơn vị tiền thực tế.
  if (/e/i.test(String(value))) return true;
  return fraction.length > digits;
}

/**
 * Lý do một đơn KHÔNG nhận được Base Cost cấp ĐƠN (sửa tại chỗ ở cột Giá / Import Excel).
 * Mã trùng `details.reason` của `FULFILLMENT_BASE_COST_INVALID` ⇒ frontend dịch theo một bảng.
 */
export type OrderBaseCostRejection =
  | 'NOT_FULFILLED'
  | 'NOT_SUBMITTED'
  | 'MULTI_ITEM'
  | 'CURRENCY_REQUIRED'
  | 'CURRENCY_INVALID'
  | 'TOO_MANY_DECIMALS'
  | 'OUT_OF_RANGE';

/** Phần của bản ghi fulfillment mà luật Base Cost cấp đơn cần đọc. */
export interface OrderBaseCostRecord {
  status: FulfillmentStatus;
  submittedAt: Date | null;
  currency: string | null;
  items: ReadonlyArray<{
    id: string;
    quantity: number;
    baseCost: { toString(): string } | number | null;
    baseCostConfirmedAt: Date | null;
  }>;
}

export type OrderBaseCostVerdict =
  | {
      ok: true;
      itemId: string;
      currency: string;
      before: number | null;
      /** Giá đã đúng bằng giá trị mới VÀ đã xác nhận ⇒ không ghi gì (gửi lại không tạo nhật ký thừa). */
      unchanged: boolean;
    }
  | { ok: false; reason: OrderBaseCostRejection; message: string };

/**
 * **Base Cost cấp ĐƠN** — một con số cho cả đơn, dùng chung cho sửa tại chỗ và Import Excel.
 *
 * 🔴 Không có cột "base cost của Order": giá vốn đơn = Σ giá vốn × số lượng các dòng của lần fulfill đang
 * hiệu lực. Một con số chỉ ghi được KHÔNG mơ hồ khi lần fulfill có ĐÚNG MỘT dòng, số lượng 1 (quyết định PO
 * 2026-10-19: không tự chia tiền cho nhiều dòng). Đơn nhiều dòng ⇒ `MULTI_ITEM`, dùng hộp thoại "Cập nhật
 * Base Cost" nhập từng dòng.
 *
 * Các luật còn lại trùng `FulfillmentService.updateBaseCostManually`: chỉ đơn đã được nhà cung cấp nhận, đơn vị
 * tiền phải có sẵn trên bản ghi, số lẻ không vượt đơn vị tiền, 0 ≤ giá ≤ `maxValue`.
 */
export function resolveOrderLevelBaseCost(
  record: OrderBaseCostRecord | null,
  value: number,
  maxValue: number,
): OrderBaseCostVerdict {
  if (!record) {
    return { ok: false, reason: 'NOT_FULFILLED', message: 'Đơn chưa được gửi fulfillment.' };
  }
  if (NON_BLOCKING_FULFILLMENT_STATUSES.includes(record.status) || !record.submittedAt) {
    return {
      ok: false,
      reason: 'NOT_SUBMITTED',
      message: `Đơn chưa được nhà cung cấp nhận (trạng thái ${record.status}) — chỉ nhập giá vốn cho đơn đã fulfill.`,
    };
  }
  const [item, ...rest] = record.items;
  if (!item || rest.length > 0 || item.quantity !== 1) {
    return {
      ok: false,
      reason: 'MULTI_ITEM',
      message: `Đơn có ${record.items.length} dòng hàng — nhập giá vốn từng dòng bằng "Cập nhật Base Cost".`,
    };
  }
  if (!Number.isFinite(value) || value < 0 || value > maxValue) {
    return { ok: false, reason: 'OUT_OF_RANGE', message: `Base Cost phải trong khoảng 0 – ${maxValue}.` };
  }
  const currency = record.currency?.toUpperCase() ?? null;
  if (!currency) {
    return {
      ok: false,
      reason: 'CURRENCY_REQUIRED',
      message: 'Đơn chưa có đơn vị tiền của giá vốn — nhập bằng "Cập nhật Base Cost" để chọn đơn vị tiền.',
    };
  }
  let digits: number;
  try {
    digits = currencyFractionDigits(currency);
  } catch {
    return { ok: false, reason: 'CURRENCY_INVALID', message: `Mã tiền tệ ${currency} không hợp lệ.` };
  }
  if (exceedsFractionDigits(value, digits)) {
    return {
      ok: false,
      reason: 'TOO_MANY_DECIMALS',
      message: `${currency} chỉ có ${digits} chữ số thập phân (nhận được ${value}).`,
    };
  }
  const before = item.baseCost === null ? null : Number(item.baseCost.toString());
  return {
    ok: true,
    itemId: item.id,
    currency,
    before,
    unchanged: before === value && item.baseCostConfirmedAt !== null,
  };
}
