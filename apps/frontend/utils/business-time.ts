/**
 * **Giờ nghiệp vụ US** — hàm thuần (không React), kiểm bằng `npm run test:business-time`.
 *
 * Mọi màn Orders / TikTok Payout / Dashboard (và đồng hồ trên Header) HIỂN THỊ thời gian theo MỘT múi giờ IANA —
 * `America/Los_Angeles` (TikTok Shop US), CÙNG múi giờ mà backend dùng để lọc ngày (`APP_BUSINESS_TIMEZONE`).
 * Nhờ vậy đơn lọc "Hôm nay" luôn hiện giờ đặt của hôm nay, dù người xem ở Việt Nam hay ở Mỹ.
 *
 * 🔴 Không offset cố định (Mỹ đổi giờ PST ⇄ PDT), không giờ máy người xem: dùng dữ liệu IANA của `Intl`.
 * 🔴 Chỉ ĐỔI CÁCH HIỂN THỊ — timestamp gốc (UTC từ API) không bị sửa, và mỗi giá trị chỉ được đổi múi giờ MỘT lần
 *    (đầu vào luôn là thời điểm tuyệt đối: ISO có `Z`/offset hoặc `Date`).
 */

/**
 * Múi giờ nghiệp vụ. Phải trùng `APP_BUSINESS_TIMEZONE` của backend (mặc định của cả hai đều là
 * America/Los_Angeles); `NEXT_PUBLIC_BUSINESS_TIMEZONE` chỉ để đổi đồng bộ khi backend đổi.
 */
export const BUSINESS_TIME_ZONE: string =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_BUSINESS_TIMEZONE) ||
  'America/Los_Angeles';

/** Ngày giờ treo tường ở một múi giờ. */
export interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
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
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Thời điểm hợp lệ hay `null` (rỗng / chuỗi không parse được). */
export function toInstant(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Một thời điểm ⇒ ngày giờ treo tường ở `timeZone` (chuỗi 2 chữ số, năm 4 chữ số). */
export function zonedParts(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    // Một số engine trả "24" cho nửa đêm dù hourCycle h23 — chuẩn hoá về "00".
    hour: parts.hour === '24' ? '00' : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

/** Ngày nghiệp vụ "YYYY-MM-DD" chứa thời điểm `now` (mặc định: bây giờ) ở `timeZone`. */
export function businessToday(
  timeZone: string = BUSINESS_TIME_ZONE,
  now: Date = new Date(),
): string {
  const { year, month, day } = zonedParts(now, timeZone);
  return `${year}-${month}-${day}`;
}

/**
 * Định dạng cố định `YYYY-MM-DD HH:mm` theo giờ nghiệp vụ — định dạng của màn Orders (đối chiếu với Seller
 * Center, không phụ thuộc ngôn ngữ). Rỗng / sai ⇒ `fallback`.
 */
export function formatBusinessDateTimeFixed(
  value: string | number | Date | null | undefined,
  fallback = '—',
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const instant = toInstant(value);
  if (!instant) return fallback;
  const { year, month, day, hour, minute } = zonedParts(instant, timeZone);
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/** Nhãn múi giờ đúng THỜI ĐIỂM đó: "PDT" (mùa hè) hoặc "PST" (mùa đông) cho Los Angeles. */
export function timeZoneAbbreviation(
  instant: Date = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  return name ?? timeZone;
}

/** Nội dung đồng hồ US trên Header — tách khỏi component để kiểm được và dùng CHUNG phép đổi múi giờ. */
export interface UsClockText {
  /** Ngày theo ngôn ngữ giao diện (vd `10/27/2026` · `27/10/2026`). */
  date: string;
  /** Giờ:phút theo quy ước của ngôn ngữ (vd `03:55 PM` · `15:55`). */
  time: string;
  /** `PDT` / `PST` — đúng THỜI ĐIỂM đang hiển thị. */
  zone: string;
}

/**
 * Ngày giờ hiện tại ở Los Angeles cho đồng hồ Header. `locale` là thẻ Intl của ngôn ngữ đang chọn — chỉ đổi CÁCH
 * VIẾT (thứ tự ngày/tháng, 12h/24h), không đổi múi giờ.
 */
export function formatUsClock(
  now: Date,
  locale: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): UsClockText {
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return { date, time, zone: timeZoneAbbreviation(now, timeZone) };
}
