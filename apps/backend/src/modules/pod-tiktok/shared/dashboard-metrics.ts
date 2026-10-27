/**
 * Công thức thuần của Dashboard — không I/O, test được trực tiếp.
 */

import { Prisma } from '@prisma/client';
import {
  businessDayOf,
  businessDayRange,
  firstDayOfMonth,
  isCalendarDay,
  type BusinessDayRange,
} from '../../../common/time/business-time';

/** Ngày tối đa của một khoảng thống kê theo ngày (chặn truy vấn / series vô hạn). */
export const DASHBOARD_MAX_RANGE_DAYS = 366;

/**
 * % thay đổi = (hiện tại − kỳ trước) / kỳ trước × 100.
 *
 * Kỳ trước = 0 ⇒ `null` (không chia 0; giao diện hiện "—"). Làm tròn 2 chữ số thập phân.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

/** Ngày nghiệp vụ "YYYY-MM-DD" của một thời điểm (múi giờ IANA `APP_BUSINESS_TIMEZONE`). */
export function localDay(date: Date, timeZone: string): string {
  return businessDayOf(date, timeZone);
}

/**
 * Khoảng ngày (theo múi giờ nghiệp vụ) đã kiểm tra — gồm cả mốc thời điểm NỬA MỞ để lọc DB:
 * `from <= cột < before`. Mọi thẻ / biểu đồ / bảng của Dashboard dùng CÙNG một object này.
 */
export interface DashboardDayRange {
  /** "YYYY-MM-DD" (giờ nghiệp vụ), gồm trọn cả hai ngày. */
  fromDay: string;
  toDay: string;
  /** 00:00 ngày đầu (giờ nghiệp vụ) ⇒ thời điểm UTC. */
  from: Date;
  /** 00:00 ngày SAU ngày cuối (giờ nghiệp vụ) ⇒ thời điểm UTC. */
  before: Date;
  days: number;
}

/**
 * Kiểm tra + quy đổi khoảng ngày. Bỏ trống ⇒ tháng hiện tại (đầu tháng → hôm nay).
 * Ném `RangeError` khi sai định dạng, ngược chiều hoặc dài hơn `DASHBOARD_MAX_RANGE_DAYS`.
 */
export function resolveDayRange(
  fromDay: string | undefined,
  toDay: string | undefined,
  timeZone: string,
  now: Date = new Date(),
): DashboardDayRange {
  const today = localDay(now, timeZone);
  const range = businessDayRange(fromDay ?? firstDayOfMonth(today), toDay ?? today, timeZone);
  if (range.days > DASHBOARD_MAX_RANGE_DAYS) {
    throw new RangeError(`Khoảng thời gian tối đa ${DASHBOARD_MAX_RANGE_DAYS} ngày`);
  }
  return toDashboardRange(range);
}

/**
 * "Tất cả thời gian": từ ngày có dữ liệu sớm nhất (`earliestDay`, giờ nghiệp vụ) đến HÔM NAY — KHÔNG áp giới hạn
 * `DASHBOARD_MAX_RANGE_DAYS`. Chưa có dữ liệu (`null`) hoặc ngày sớm nhất ở tương lai ⇒ chỉ hôm nay.
 */
export function resolveAllTimeRange(
  earliestDay: string | null,
  timeZone: string,
  now: Date = new Date(),
): DashboardDayRange {
  const today = localDay(now, timeZone);
  const from = earliestDay && isCalendarDay(earliestDay) && earliestDay < today ? earliestDay : today;
  return toDashboardRange(businessDayRange(from, today, timeZone));
}

function toDashboardRange(range: BusinessDayRange): DashboardDayRange {
  return {
    fromDay: range.fromDay,
    toDay: range.toDay,
    from: range.start,
    before: range.endExclusive,
    days: range.days,
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
  /** Σ Design Amount (cột Design Amount); `null` = khác đơn vị tiền đang xem (không quy đổi). */
  designAmount: string | null;
}

/**
 * Current Profit của bảng Thống kê seller = Paid − Basecost − Label − Seller Shipping Fee − Design Amount
 * (công thức nguyên văn — quyết định PO 2026-10-14, bổ sung Design Amount). KHÁC Profit Dự kiến.
 * Quy tắc phí ship giữ NGUYÊN như PO đã chốt (trừ toàn bộ Shipping Fee) — chỉ thêm Design Amount, trừ MỘT lần.
 *
 * Tính trên tổng ĐÃ cộng (không làm tròn từng thành phần trước), bằng Decimal để không lệch số lẻ.
 * Label / Design Amount `null` ⇒ `null` ("—"), không coi là 0. Biểu thức `current_profit` (ORDER BY) trong
 * `PodDashboardRepository.sellerStats` phải khớp hàm này.
 */
export function sellerCurrentProfit(input: SellerCurrentProfitInput): string | null {
  if (input.label === null || input.designAmount === null) return null;
  return new Prisma.Decimal(input.paid)
    .minus(input.baseCost)
    .minus(input.label)
    .minus(input.shippingFee)
    .minus(input.designAmount)
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
  /** Σ Design Amount (cột Design Amount); `null` = khác đơn vị tiền đang xem (không quy đổi). */
  designAmount: string | null;
}

/**
 * Profit Dự kiến (Est. profit) của bảng Thống kê seller = Revenue − Base cost − Shipping Fee − Label − Design Amount
 * (quyết định PO 2026-10-14, bổ sung Design Amount), KHÔNG trừ hai lần phí ship: phần Shipping Fee mà TikTok ĐÃ trừ
 * trong Doanh thu (`shippingIncluded`) không bị trừ lại ⇒ thực tế trừ `shippingFee − shippingIncluded`.
 * Design Amount KHÔNG nằm trong Revenue (chi phí nhập tay) ⇒ trừ đúng MỘT lần.
 *
 * Tính trên các tổng của dòng (đúng các cột đang hiển thị), bằng Decimal, không làm tròn từng thành phần.
 * Label / Design Amount `null` ⇒ `null` ("—"). Biểu thức `profit` (ORDER BY) trong
 * `PodDashboardRepository.sellerStats` phải khớp hàm này.
 */
export function sellerEstProfit(input: SellerEstProfitInput): string | null {
  if (input.label === null || input.designAmount === null) return null;
  const shippingNotInRevenue = new Prisma.Decimal(input.shippingFee).minus(input.shippingIncluded);
  return new Prisma.Decimal(input.revenue)
    .minus(input.baseCost)
    .minus(input.label)
    .minus(shippingNotInRevenue)
    .minus(input.designAmount)
    .toString();
}
