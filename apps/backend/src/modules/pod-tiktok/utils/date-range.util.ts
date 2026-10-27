import { BadRequestException } from '@nestjs/common';
import {
  addCalendarDays,
  businessDayOf,
  businessDayRange,
  firstDayOfMonth,
  isCalendarDay,
} from '../../../common/time/business-time';

/**
 * Bộ lọc thời gian theo preset — DÙNG CHUNG cho Orders, TikTok Payout, Dashboard, Returns.
 *
 * Preset được quy đổi ở **BACKEND** (không filter ở frontend) theo **múi giờ nghiệp vụ** IANA
 * (`APP_BUSINESS_TIMEZONE`, mặc định `America/Los_Angeles`) — "Hôm nay" là hôm nay ở Los Angeles,
 * không phải theo giờ UTC của máy chủ hay giờ trình duyệt. Tự đổi PST/PDT.
 *
 * Hợp đồng API của khoảng tuỳ chọn: `YYYY-MM-DD` = một NGÀY LỊCH theo múi giờ nghiệp vụ (đúng thứ
 * `<input type="date">` gửi lên). Giá trị có giờ (ISO đầy đủ) được hiểu là một THỜI ĐIỂM tuyệt đối và quy
 * về ngày nghiệp vụ chứa nó — giữ tương thích với client cũ, nhưng không bao giờ bị dịch giờ hai lần.
 */

export const POD_DATE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'ALL',
  'CUSTOM',
] as const;
export type PodDatePreset = (typeof POD_DATE_PRESETS)[number];

/**
 * Khoảng thời gian NỬA MỞ để truy vấn DB: `from <= timestamp < before`. `undefined` = không giới hạn phía đó.
 *
 * 🔴 `before` là 00:00 của ngày SAU ngày cuối — dùng `lt`, KHÔNG dùng `lte` (cột `timestamptz(6)` có micro
 * giây: mốc 23:59:59.999 bỏ sót bản ghi ở 23:59:59.9995).
 */
export interface ResolvedDateRange {
  from?: Date;
  before?: Date;
  /** Ngày nghiệp vụ đầu / cuối (`YYYY-MM-DD`, gồm trọn ngày cuối) — để HIỂN THỊ, không dịch qua giờ trình duyệt. */
  fromDay?: string;
  toDay?: string;
}

/** Hai ngày nghiệp vụ (gồm cả hai đầu) của một preset có mốc (không gồm ALL / CUSTOM). */
export function resolvePresetDays(
  preset: Exclude<PodDatePreset, 'ALL' | 'CUSTOM'>,
  timeZone: string,
  now: Date = new Date(),
): { fromDay: string; toDay: string } {
  const today = businessDayOf(now, timeZone);
  switch (preset) {
    case 'TODAY':
      return { fromDay: today, toDay: today };
    case 'YESTERDAY': {
      const yesterday = addCalendarDays(today, -1);
      return { fromDay: yesterday, toDay: yesterday };
    }
    // "7 ngày gần nhất" = hôm nay và 6 ngày trước đó (tổng 7 ngày LỊCH, gồm cả hôm nay).
    case 'LAST_7_DAYS':
      return { fromDay: addCalendarDays(today, -6), toDay: today };
    case 'LAST_30_DAYS':
      return { fromDay: addCalendarDays(today, -29), toDay: today };
    case 'THIS_MONTH':
      return { fromDay: firstDayOfMonth(today), toDay: today };
    // "Tháng trước" = trọn tháng LỊCH liền trước, KHÔNG phải 30 ngày gần nhất.
    case 'LAST_MONTH': {
      const lastDayOfPreviousMonth = addCalendarDays(firstDayOfMonth(today), -1);
      return { fromDay: firstDayOfMonth(lastDayOfPreviousMonth), toDay: lastDayOfPreviousMonth };
    }
  }
}

/**
 * Quy đổi preset (+ khoảng tuỳ chọn) thành khoảng thời điểm nửa mở.
 *
 * @param preset      Preset người dùng chọn. Bỏ trống / `CUSTOM` ⇒ dùng `customFrom`/`customTo` nếu có.
 * @param timeZone    Múi giờ nghiệp vụ IANA (`businessTimeZone`).
 * @param customFrom  Ngày bắt đầu — `YYYY-MM-DD` (ngày nghiệp vụ). Dùng cho preset `CUSTOM`.
 * @param customTo    Ngày kết thúc — `YYYY-MM-DD`. Bao gồm TRỌN ngày này.
 * @param now         Thời điểm hiện tại (tiêm vào để test tất định).
 * @throws BadRequestException `DATE_RANGE_INVALID` — ngày sai / không tồn tại / bắt đầu sau kết thúc.
 */
export function resolveDateRange(
  preset: PodDatePreset | undefined,
  timeZone: string,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): ResolvedDateRange {
  if (preset === 'ALL') return {};

  if (!preset || preset === 'CUSTOM') {
    const fromDay = customFrom ? toBusinessDay(customFrom, timeZone) : undefined;
    const toDay = customTo ? toBusinessDay(customTo, timeZone) : undefined;
    if (fromDay && toDay && fromDay > toDay) {
      throw invalidRange('Ngày bắt đầu không được sau ngày kết thúc');
    }
    // Một phía bỏ trống ⇒ phía đó không giới hạn; mỗi phía vẫn là MỐC ĐẦU NGÀY ở múi giờ nghiệp vụ.
    return {
      from: fromDay ? businessDayRange(fromDay, fromDay, timeZone).start : undefined,
      before: toDay ? businessDayRange(toDay, toDay, timeZone).endExclusive : undefined,
      fromDay,
      toDay,
    };
  }

  const { fromDay, toDay } = resolvePresetDays(preset, timeZone, now);
  const range = businessDayRange(fromDay, toDay, timeZone);
  return { from: range.start, before: range.endExclusive, fromDay, toDay };
}

/** `YYYY-MM-DD` ⇒ chính nó; ISO có giờ ⇒ ngày nghiệp vụ chứa thời điểm đó. */
function toBusinessDay(value: string, timeZone: string): string {
  const trimmed = value.trim();
  if (isCalendarDay(trimmed)) return trimmed;
  // Ngày dạng YYYY-MM-DD nhưng không có thật (2026-02-30) ⇒ báo lỗi, không để `Date` tự "lăn" sang tháng sau.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) throw invalidRange(`Ngày không tồn tại: ${trimmed}`);
  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) throw invalidRange(`Ngày không hợp lệ: ${trimmed}`);
  return businessDayOf(instant, timeZone);
}

function invalidRange(message: string): BadRequestException {
  return new BadRequestException({ code: 'DATE_RANGE_INVALID', message });
}
