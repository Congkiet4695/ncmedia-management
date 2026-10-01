/**
 * Công thức thuần của Dashboard — không I/O, test được trực tiếp.
 */

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
  const offsetMs = offsetMinutes * MS_PER_MINUTE;
  return {
    fromDay: from,
    toDay: to,
    from: new Date(fromUtcMidnight - offsetMs),
    to: new Date(toUtcMidnight + MS_PER_DAY - 1 - offsetMs),
    days,
  };
}
