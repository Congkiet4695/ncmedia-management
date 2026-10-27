/**
 * Hàm thuần của Dashboard (không React) — kiểm bằng `npm run test:dashboard`.
 *
 * 🔴 Ngày trong Dashboard là chuỗi "YYYY-MM-DD" THEO MÚI GIỜ NGHIỆP VỤ do backend trả (`timeZone`, IANA — mặc
 * định America/Los_Angeles, tự đổi PST/PDT). Không đưa qua `new Date()` của trình duyệt khi hiển thị: người xem
 * ở múi giờ khác sẽ thấy lệch một ngày. Không dùng offset cố định: Mỹ đổi giờ mùa hè.
 */

import { businessToday } from '@/utils/business-time';

const MS_PER_DAY = 86_400_000;

/** Hôm nay "YYYY-MM-DD" ở múi giờ `timeZone` — MỘT cài đặt dùng chung (`utils/business-time`). */
export { businessToday };

/** Cộng `days` ngày LỊCH vào "YYYY-MM-DD" (không đi qua múi giờ nào — tự đúng 28 / 29 / 30 / 31 ngày, qua năm). */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Tháng hiện tại (đầu tháng → hôm nay) theo múi giờ nghiệp vụ. */
export function currentMonthRange(timeZone: string, now: Date = new Date()): { from: string; to: string } {
  const today = businessToday(timeZone, now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * Khoảng ngày của một lựa chọn nhanh, theo múi giờ nghiệp vụ do backend trả (`timeZone`) — CÙNG quy tắc với
 * `resolveDateRange` của backend (Hôm nay / Hôm qua trọn ngày; Tháng này = đầu tháng → hôm nay; Tháng trước =
 * TRỌN tháng liền trước). Backend nhận "YYYY-MM-DD" và tự quy về [00:00 ngày đầu, 00:00 sau ngày cuối) ở múi giờ đó.
 */
export function presetRange(
  preset: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH',
  timeZone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = businessToday(timeZone, now);
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case 'YESTERDAY': {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'THIS_MONTH':
      return currentMonthRange(timeZone, now);
    case 'LAST_MONTH': {
      // Ngày cuối tháng trước = 1 ngày trước ngày 01 của tháng này (tự đúng 28 / 29 / 30 / 31 ngày).
      const lastDay = addDays(`${today.slice(0, 8)}01`, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
  }
}

/**
 * Khoảng ngày tự chọn KHÔNG hợp lệ (ngày bắt đầu sau ngày kết thúc) — kiểm ở giao diện TRƯỚC khi gọi API.
 * Hai ngày bằng nhau là hợp lệ; thiếu một ngày (hoặc "Tất cả thời gian") không phải lỗi khoảng.
 * Chuỗi "YYYY-MM-DD" so sánh được trực tiếp theo thứ tự từ điển.
 */
export function isReversedRange(range: { from: string; to: string; allTime?: boolean }): boolean {
  return !range.allTime && Boolean(range.from) && Boolean(range.to) && range.from > range.to;
}

/** "2026-09-07" → "07/09". */
export function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** "2026-09-07" → "07/09/2026". */
export function fullDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/** % thay đổi để hiển thị: "+60.43%" / "-75.00%"; `null` (kỳ trước = 0) ⇒ "—". */
export function formatChange(change: number | null): string {
  if (change === null || !Number.isFinite(change)) return '—';
  return `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
}
