/**
 * Thời gian theo múi giờ IANA — hàm THUẦN, không đọc múi giờ của server / container / phiên PostgreSQL.
 *
 * Hai khái niệm KHÁC NHAU, đừng trộn:
 *  - **Thời điểm** (`Date`): một khoảnh khắc tuyệt đối, lưu `timestamptz` (UTC) — không bao giờ bị "dịch giờ".
 *  - **Ngày nghiệp vụ** (`'YYYY-MM-DD'`): một ngày LỊCH ở múi giờ nghiệp vụ (`APP_BUSINESS_TIMEZONE`,
 *    mặc định `America/Los_Angeles`). Hôm nay / hôm qua / tháng này đều là ngày nghiệp vụ.
 *
 * 🔴 Không có offset cố định: Mỹ đổi giờ mùa hè (PST UTC−8 ⇄ PDT UTC−7), nên một ngày địa phương dài
 * 23 / 24 / 25 giờ. Mọi mốc được tính bằng dữ liệu IANA của `Intl` (Node có sẵn — không cần thư viện),
 * và khoảng ngày là NỬA MỞ `[start, endExclusive)` với `endExclusive` = 00:00 ngày KẾ TIẾP — không
 * dùng 23:59:59.999 (cột `timestamptz(6)` có độ chính xác micro giây) và không cộng cố định 24 giờ.
 */

const CALENDAR_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Múi giờ nghiệp vụ mặc định khi `APP_BUSINESS_TIMEZONE` không được cấu hình. */
export const DEFAULT_BUSINESS_TIMEZONE = 'America/Los_Angeles';

/** Ngày giờ treo tường ở một múi giờ. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Múi giờ IANA hợp lệ không (`America/Los_Angeles`, `Asia/Ho_Chi_Minh`, `UTC` …). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Một thời điểm ⇒ ngày giờ treo tường ở `timeZone`. */
export function toZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/**
 * Ngày giờ treo tường ở `timeZone` ⇒ thời điểm (UTC).
 *
 * Lấy độ lệch của múi giờ TẠI thời điểm đoán, rồi sửa một lần nữa: hai vòng là đủ cho mọi múi
 * giờ kể cả khi đoán đầu tiên rơi vào phía bên kia mốc đổi giờ mùa hè.
 */
export function fromZonedParts(parts: ZonedParts, timeZone: string): Date {
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const seen = toZonedParts(new Date(guess), timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    guess += asUtc - seenAsUtc;
  }
  return new Date(guess);
}

// ---------------------------------------------------------------------------
// Ngày lịch 'YYYY-MM-DD' — số học trên LỊCH, không đi qua múi giờ nào
// ---------------------------------------------------------------------------

/** Chuỗi có đúng dạng `YYYY-MM-DD` VÀ là ngày có thật (loại 2026-02-30). */
export function isCalendarDay(value: string): boolean {
  const match = CALENDAR_DAY_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** Cộng `days` ngày LỊCH (âm = lùi). `Date.UTC` tự chuẩn hoá tràn tháng / năm. */
export function addCalendarDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** Số ngày lịch của khoảng `[fromDay, toDay]` (gồm cả hai đầu). */
export function calendarDayCount(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00.000Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)) / MS_PER_DAY) + 1;
}

/** Ngày 01 của tháng chứa `day`. */
export function firstDayOfMonth(day: string): string {
  return `${day.slice(0, 8)}01`;
}

// ---------------------------------------------------------------------------
// Ngày nghiệp vụ ⇄ thời điểm
// ---------------------------------------------------------------------------

/** Ngày nghiệp vụ (`YYYY-MM-DD`) chứa thời điểm `instant` ở `timeZone`. */
export function businessDayOf(instant: Date, timeZone: string): string {
  const { year, month, day } = toZonedParts(instant, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Thời điểm 00:00 của ngày nghiệp vụ `day` ở `timeZone` (đúng cả ngày đổi giờ mùa hè). */
export function startOfBusinessDay(day: string, timeZone: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return fromZonedParts({ year, month, day: date, hour: 0, minute: 0, second: 0 }, timeZone);
}

/** Khoảng ngày nghiệp vụ đã kiểm tra, kèm mốc thời điểm NỬA MỞ để truy vấn `timestamptz`. */
export interface BusinessDayRange {
  /** Ngày đầu / ngày cuối (gồm trọn ngày cuối), `YYYY-MM-DD` theo múi giờ nghiệp vụ. */
  fromDay: string;
  toDay: string;
  /** 00:00 của `fromDay` — điều kiện `timestamp >= start`. */
  start: Date;
  /** 00:00 của ngày SAU `toDay` — điều kiện `timestamp < endExclusive`. */
  endExclusive: Date;
  /** Số ngày lịch của khoảng. */
  days: number;
}

/**
 * Khoảng `[fromDay, toDay]` (ngày nghiệp vụ) ⇒ mốc `[start, endExclusive)`.
 * Ném `RangeError` khi sai định dạng / ngày không tồn tại / ngày bắt đầu sau ngày kết thúc.
 */
export function businessDayRange(fromDay: string, toDay: string, timeZone: string): BusinessDayRange {
  if (!isCalendarDay(fromDay) || !isCalendarDay(toDay)) {
    throw new RangeError('Ngày phải có dạng YYYY-MM-DD và là ngày có thật');
  }
  if (fromDay > toDay) throw new RangeError('Ngày bắt đầu sau ngày kết thúc');
  return {
    fromDay,
    toDay,
    start: startOfBusinessDay(fromDay, timeZone),
    endExclusive: startOfBusinessDay(addCalendarDays(toDay, 1), timeZone),
    days: calendarDayCount(fromDay, toDay),
  };
}
