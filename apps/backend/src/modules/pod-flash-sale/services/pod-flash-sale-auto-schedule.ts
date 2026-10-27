import { fromZonedParts, toZonedParts } from '../../../common/time/business-time';
import { FLASH_SALE_AUTO_MINUTES_PER_DAY, FLASH_SALE_AUTO_RULES } from '../constants/pod-flash-sale.constants';

const MS_PER_MINUTE = 60_000;

/**
 * Phép tính thời gian của Auto Flash Sale — hàm THUẦN, không đọc đồng hồ của server, không đọc
 * múi giờ của server. Mọi hàm nhận "bây giờ" và múi giờ IANA làm tham số.
 *
 * 🔴 Vì sao không dùng thư viện: dự án chưa có thư viện múi giờ nào; \`Intl.DateTimeFormat\`
 * của Node có sẵn dữ liệu IANA đầy đủ và là thứ các phép tính dưới đây cần.
 */

// Phép đổi múi giờ IANA dùng chung với lọc ngày nghiệp vụ (Orders / Payout / Dashboard) — MỘT bản cài đặt.
export { fromZonedParts, isValidTimeZone, toZonedParts } from '../../../common/time/business-time';

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
 * "Khoảng thời gian" N ngày ⇒ số PHÚT của đợt Auto: N × 1440. Đơn vị nghiệp vụ là phút, không phải
 * ngày lịch — 1 ngày = 1440 phút kể từ giờ bắt đầu, kể cả qua mốc đổi giờ mùa hè.
 */
export function autoDurationMinutes(durationDays: number): number {
  if (!Number.isInteger(durationDays) || durationDays < 1) {
    throw new Error(`Khoảng thời gian không hợp lệ: ${durationDays}`);
  }
  return durationDays * FLASH_SALE_AUTO_MINUTES_PER_DAY;
}

/**
 * Khung giờ của đợt KẾ TIẾP trong chuỗi — tính từ `endAt` của đợt hiện tại, KHÔNG từ ngày chạy
 * cron, không từ ngày hôm nay. Biểu diễn phút BAO GỒM hai đầu: đợt N ngày chiếm đúng N × 1440 phút.
 *
 * ```
 *   A.end   = 21/10 13:59
 *   B.start = A.end + 1 phút, làm tròn xuống tới phút    = 21/10 14:00
 *   B.end   = B.start + (N × 1440 − 1) phút               = 22/10 13:59 | 23/10 13:59 | 24/10 13:59 (N = 1 | 2 | 3)
 * ```
 *
 * 🔴 KHÔNG ép giờ kết thúc về 23:59 / cuối ngày: phép tính là số phút trôi qua trên thời điểm tuyệt
 * đối (UTC), nên không phụ thuộc múi giờ của server, trình duyệt hay đợt sale.
 *
 * Làm tròn xuống tới phút để giờ bắt đầu là giờ "chẵn phút" (đợt cũ kết thúc 23:59:59 ⇒ đợt mới bắt
 * đầu 00:00:00, không phải 00:00:59). Múi giờ IANA lệch nguyên phút, nên tròn phút theo UTC cũng là
 * tròn phút theo giờ treo tường.
 */
export function computeNextWindow(currentEndAt: Date, durationDays: number): { startAt: Date; endAt: Date } {
  const durationMinutes = autoDurationMinutes(durationDays);
  const rawStart = currentEndAt.getTime() + FLASH_SALE_AUTO_RULES.GAP_MS;
  const startAt = new Date(rawStart - (rawStart % MS_PER_MINUTE));
  const endAt = new Date(startAt.getTime() + (durationMinutes - 1) * MS_PER_MINUTE);
  return { startAt, endAt };
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
