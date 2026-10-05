import { FLASH_SALE_AUTO_END_OF_DAY, FLASH_SALE_AUTO_RULES } from '../constants/pod-flash-sale.constants';

/**
 * Phép tính thời gian của Auto Flash Sale — hàm THUẦN, không đọc đồng hồ của server, không đọc
 * múi giờ của server. Mọi hàm nhận "bây giờ" và múi giờ IANA làm tham số.
 *
 * 🔴 Vì sao không dùng thư viện: dự án chưa có thư viện múi giờ nào; \`Intl.DateTimeFormat\`
 * của Node có sẵn dữ liệu IANA đầy đủ và là thứ các phép tính dưới đây cần.
 */

interface ZonedParts {
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

/** Múi giờ IANA hợp lệ không (\`America/Los_Angeles\`, \`Asia/Ho_Chi_Minh\`, \`UTC\` …). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Một thời điểm ⇒ ngày giờ treo tường ở \`timeZone\`. */
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
 * Ngày giờ treo tường ở \`timeZone\` ⇒ thời điểm (UTC).
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

/** Cộng \`days\` ngày LỊCH ở \`timeZone\` — giữ nguyên giờ treo tường qua mốc đổi giờ. */
export function addCalendarDays(instant: Date, days: number, timeZone: string): Date {
  const parts = toZonedParts(instant, timeZone);
  // `Date.UTC` tự chuẩn hoá ngày tràn tháng/năm (31/01 + 3 ⇒ 03/02).
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return fromZonedParts(
    {
      ...parts,
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
    },
    timeZone,
  );
}

/**
 * Giờ KẾT THÚC theo "Khoảng thời gian": 23:59:59 của ngày lịch (ngày chứa `startAt` + `durationDays` − 1)
 * ở `timeZone`. 1 ngày = hết CHÍNH ngày bắt đầu — KHÔNG phải `startAt` + 24 giờ.
 *
 * ```
 *   start 20/10 00:00 · 1 ngày ⇒ 20/10 23:59:59 · 2 ngày ⇒ 21/10 23:59:59 · 3 ngày ⇒ 22/10 23:59:59
 * ```
 */
export function computeEndOfDuration(startAt: Date, durationDays: number, timeZone: string): Date {
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error(`Khoảng thời gian không hợp lệ: ${durationDays}`);
  }
  const lastDay = toZonedParts(addCalendarDays(startAt, durationDays - 1, timeZone), timeZone);
  return fromZonedParts({ ...lastDay, ...FLASH_SALE_AUTO_END_OF_DAY }, timeZone);
}

/**
 * Khung giờ của đợt KẾ TIẾP trong chuỗi — tính từ `endAt` của đợt hiện tại, KHÔNG từ ngày chạy
 * cron, không từ ngày hôm nay.
 *
 * ```
 *   A.end   = 20/10 23:59:59
 *   B.start = A.end + 10 phút, làm tròn xuống tới phút = 21/10 00:09:00
 *   B.end   = 23:59:59 của (21/10 + N − 1)              = 23/10 23:59:59 khi N = 3
 * ```
 *
 * Làm tròn xuống tới phút để giờ bắt đầu là giờ "chẵn phút" (A kết thúc 23:59:59 ⇒ B bắt đầu
 * 00:09:00, không phải 00:09:59). Múi giờ IANA lệch nguyên phút, nên tròn phút theo UTC cũng là
 * tròn phút theo giờ treo tường.
 */
export function computeNextWindow(
  currentEndAt: Date,
  timeZone: string,
  durationDays: number,
): { startAt: Date; endAt: Date } {
  const rawStart = currentEndAt.getTime() + FLASH_SALE_AUTO_RULES.GAP_MS;
  const startAt = new Date(rawStart - (rawStart % 60_000));
  return { startAt, endAt: computeEndOfDuration(startAt, durationDays, timeZone) };
}

/** Đợt có tới hạn tạo đợt kế tiếp chưa: còn ≤ LEAD (kể cả đã hết hạn). */
export function isDueForNext(endAt: Date, now: Date): boolean {
  return endAt.getTime() - now.getTime() <= FLASH_SALE_AUTO_RULES.LEAD_MS;
}

/** \`HH:mm\` ⇒ \`{hour, minute}\`. Định dạng đã được DTO + CHECK của DB bảo đảm. */
function parseRunTime(runTime: string): { hour: number; minute: number } {
  const [hour, minute] = runTime.split(':').map(Number);
  return { hour, minute };
}

/** Mốc chạy \`runTime\` của NGÀY chứa \`instant\` (ở \`timeZone\`). */
function slotOfDay(instant: Date, runTime: string, timeZone: string): Date {
  const { hour, minute } = parseRunTime(runTime);
  const day = toZonedParts(instant, timeZone);
  return fromZonedParts({ ...day, hour, minute, second: 0 }, timeZone);
}

/**
 * Mốc chạy GẦN NHẤT đã tới (≤ now): hôm nay nếu đã qua giờ chạy, ngược lại hôm qua.
 *
 * Đây là thứ làm cho "server tắt lúc 05:00, bật lại 15:00" vẫn chạy: lúc 15:00 mốc gần nhất là
 * 05:00 hôm nay, chưa được giành ⇒ chạy bù ngay.
 */
export function latestSlot(now: Date, runTime: string, timeZone: string): Date {
  const today = slotOfDay(now, runTime, timeZone);
  if (today.getTime() <= now.getTime()) return today;
  return slotOfDay(addCalendarDays(now, -1, timeZone), runTime, timeZone);
}

/** Mốc chạy KẾ TIẾP sẽ xảy ra (> \`after\`). */
export function nextSlot(after: Date, runTime: string, timeZone: string): Date {
  const today = slotOfDay(after, runTime, timeZone);
  if (today.getTime() > after.getTime()) return today;
  return slotOfDay(addCalendarDays(after, 1, timeZone), runTime, timeZone);
}

/**
 * Lần chạy tiếp theo hiển thị cho Admin: mốc gần nhất nếu nó CHƯA được chạy (đang quá hạn ⇒
 * chạy ở nhịp quét tới), ngược lại mốc của ngày mai.
 */
export function upcomingRun(
  now: Date,
  runTime: string,
  timeZone: string,
  lastScheduledAt: Date | null,
): Date {
  const latest = latestSlot(now, runTime, timeZone);
  if (!lastScheduledAt || lastScheduledAt.getTime() < latest.getTime()) return latest;
  return nextSlot(now, runTime, timeZone);
}
