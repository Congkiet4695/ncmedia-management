/**
 * Ngày lịch (cột `@db.Date`) ⇄ chuỗi `YYYY-MM-DD`.
 *
 * 🔴 Không đi qua múi giờ: chuỗi được neo ở 00:00 UTC khi ghi và đọc lại bằng phần ngày UTC — Prisma ghi cột DATE
 * theo ngày UTC của `Date`, nên "2026-11-05" luôn là 2026-11-05 dù server / trình duyệt ở UTC+7 hay UTC−8
 * (không lệch một ngày).
 */

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` có thật ⇒ Date 00:00 UTC; sai định dạng / ngày không tồn tại (2026-02-30) ⇒ `null`. */
export function parseCalendarDay(value: string): Date | null {
  const match = DAY_PATTERN.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return toCalendarDay(date) === value ? date : null;
}

/** Cột DATE ⇒ `YYYY-MM-DD` (phần ngày UTC). */
export function toCalendarDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
