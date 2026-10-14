/**
 * Công thức thuần của Dashboard — không I/O, test được trực tiếp.
 */

import { Prisma } from '@prisma/client';

/** Ngày tối đa của một khoảng thống kê theo ngày (chặn truy vấn / series vô hạn). */
export const DASHBOARD_MAX_RANGE_DAYS = 366;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

/**
 * % thay đổi = (hiện tại − kỳ trước) / kỳ trước × 100.
 *
 * Kỳ trước = 0 ⇒ `null` (không chia 0; giao diện hiện "—"). Làm tròn 2 chữ số thập phân.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

/** Ngày "YYYY-MM-DD" của một thời điểm theo múi giờ vận hành. */
export function localDay(date: Date, offsetMinutes: number): string {
  return new Date(date.getTime() + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/** Khoảng ngày (theo múi giờ vận hành) đã kiểm tra — gồm cả mốc UTC để lọc DB. */
export interface DashboardDayRange {
  /** "YYYY-MM-DD" (giờ vận hành). */
  fromDay: string;
  toDay: string;
  /** 00:00 ngày đầu và 23:59:59.999 ngày cuối, quy về UTC. */
  from: Date;
  to: Date;
  days: number;
}

/**
 * Kiểm tra + quy đổi khoảng ngày. Bỏ trống ⇒ tháng hiện tại (đầu tháng → hôm nay).
 * Ném `RangeError` khi sai định dạng, ngược chiều hoặc dài hơn `DASHBOARD_MAX_RANGE_DAYS`.
 */
export function resolveDayRange(
  fromDay: string | undefined,
  toDay: string | undefined,
  offsetMinutes: number,
  now: Date = new Date(),
): DashboardDayRange {
  const today = localDay(now, offsetMinutes);
  const to = toDay ?? today;
  const from = fromDay ?? `${today.slice(0, 8)}01`;
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) {
    throw new RangeError('Ngày phải có dạng YYYY-MM-DD');
  }
  const fromUtcMidnight = Date.parse(`${from}T00:00:00.000Z`);
  const toUtcMidnight = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromUtcMidnight) || Number.isNaN(toUtcMidnight)) {
    throw new RangeError('Ngày không hợp lệ');
  }
  if (fromUtcMidnight > toUtcMidnight) throw new RangeError('Ngày bắt đầu sau ngày kết thúc');
  const days = Math.round((toUtcMidnight - fromUtcMidnight) / MS_PER_DAY) + 1;
  if (days > DASHBOARD_MAX_RANGE_DAYS) {
    throw new RangeError(`Khoảng thời gian tối đa ${DASHBOARD_MAX_RANGE_DAYS} ngày`);
  }
  return dayRangeOf(from, to, offsetMinutes);
}

/**
 * "Tất cả thời gian": từ ngày có dữ liệu sớm nhất (`earliestDay`, giờ vận hành) đến HÔM NAY — KHÔNG áp giới hạn
 * `DASHBOARD_MAX_RANGE_DAYS`. Chưa có dữ liệu (`null`) hoặc ngày sớm nhất ở tương lai ⇒ chỉ hôm nay.
 */
export function resolveAllTimeRange(
  earliestDay: string | null,
  offsetMinutes: number,
  now: Date = new Date(),
): DashboardDayRange {
  const today = localDay(now, offsetMinutes);
  const from =
    earliestDay && DAY_PATTERN.test(earliestDay) && earliestDay < today ? earliestDay : today;
  return dayRangeOf(from, today, offsetMinutes);
}

/** Khoảng đã kiểm tra (`from` ≤ `to`, đúng định dạng) ⇒ mốc UTC 00:00 ngày đầu → 23:59:59.999 ngày cuối. */
function dayRangeOf(from: string, to: string, offsetMinutes: number): DashboardDayRange {
  const fromUtcMidnight = Date.parse(`${from}T00:00:00.000Z`);
  const toUtcMidnight = Date.parse(`${to}T00:00:00.000Z`);
  const offsetMs = offsetMinutes * MS_PER_MINUTE;
  return {
    fromDay: from,
    toDay: to,
    from: new Date(fromUtcMidnight - offsetMs),
    to: new Date(toUtcMidnight + MS_PER_DAY - 1 - offsetMs),
    days: Math.round((toUtcMidnight - fromUtcMidnight) / MS_PER_DAY) + 1,
  };
}

/** Các tổng (chuỗi Decimal, đã cộng ở DB theo seller) dùng cho Current Profit. */
export interface SellerCurrentProfitInput {
  /** Σ tiền TikTok đã chi (payment PAID) trong khoảng. */
  paid: string;
  /** Σ giá vốn đã xác nhận (cột Basecost). */
  baseCost: string;
  /** Σ label; `null` = label khác đơn vị tiền đang xem (không quy đổi). */
  label: string | null;
  /** Σ phí ship Seller từng đơn (cột Shipping Fee). */
  shippingFee: string;
}

/**
 * Current Profit của bảng Thống kê seller = Paid − Basecost − Label − Seller Shipping Fee
 * (công thức nguyên văn — quyết định PO 2026-10-14). KHÁC Profit Dự kiến (Σ lợi nhuận từng đơn).
 *
 * Tính trên tổng ĐÃ cộng (không làm tròn từng thành phần trước), bằng Decimal để không lệch số lẻ.
 * Label `null` ⇒ `null` ("—"), không coi là 0. Biểu thức `current_profit` (ORDER BY) trong
 * `PodDashboardRepository.sellerStats` phải khớp hàm này.
 */
export function sellerCurrentProfit(input: SellerCurrentProfitInput): string | null {
  if (input.label === null) return null;
  return new Prisma.Decimal(input.paid)
    .minus(input.baseCost)
    .minus(input.label)
    .minus(input.shippingFee)
    .toString();
}

/** Các tổng (chuỗi Decimal, đã cộng ở DB theo seller) dùng cho Profit Dự kiến. */
export interface SellerEstProfitInput {
  /** Σ tiền thu về từng đơn (cột Doanh thu). */
  revenue: string;
  /** Σ giá vốn đã xác nhận (cột Basecost) — đơn chưa có giá vốn đóng góp 0, đúng như cột hiển thị. */
  baseCost: string;
  /** Σ label; `null` = label khác đơn vị tiền đang xem (không quy đổi). */
  label: string | null;
  /** Σ phí ship Seller từng đơn (cột Shipping Fee). */
  shippingFee: string;
  /** Phần của `shippingFee` ĐÃ nằm trong Doanh thu (TikTok đã trừ trong settlement / est_settlement). */
  shippingIncluded: string;
}

/**
 * Profit Dự kiến (Est. profit) của bảng Thống kê seller = Revenue − Base cost − Shipping Fee − Label
 * (quyết định PO 2026-10-14), KHÔNG trừ hai lần phí ship: phần Shipping Fee mà TikTok ĐÃ trừ trong Doanh thu
 * (`shippingIncluded`) không bị trừ lại ⇒ thực tế trừ `shippingFee − shippingIncluded`.
 *
 * Tính trên các tổng của dòng (đúng các cột đang hiển thị), bằng Decimal, không làm tròn từng thành phần.
 * Label `null` ⇒ `null` ("—"). Biểu thức `profit` (ORDER BY) trong `PodDashboardRepository.sellerStats`
 * phải khớp hàm này.
 */
export function sellerEstProfit(input: SellerEstProfitInput): string | null {
  if (input.label === null) return null;
  const shippingNotInRevenue = new Prisma.Decimal(input.shippingFee).minus(input.shippingIncluded);
  return new Prisma.Decimal(input.revenue)
    .minus(input.baseCost)
    .minus(input.label)
    .minus(shippingNotInRevenue)
    .toString();
}
