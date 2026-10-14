/**
 * Hàm thuần của Dashboard (không React) — kiểm bằng `npm run test:dashboard`.
 *
 * 🔴 Ngày trong Dashboard là chuỗi "YYYY-MM-DD" THEO GIỜ VẬN HÀNH do backend tính. Không đưa qua
 * `new Date()` của trình duyệt khi hiển thị: người xem ở múi giờ âm sẽ thấy lùi một ngày.
 */

const MS_PER_DAY = 86_400_000;

/** Hôm nay "YYYY-MM-DD" theo múi giờ vận hành (`offsetMinutes` so với UTC). */
function localToday(offsetMinutes: number, now: Date): string {
  return new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Tháng hiện tại (đầu tháng → hôm nay) theo múi giờ vận hành (`offsetMinutes` so với UTC). */
export function currentMonthRange(offsetMinutes: number, now: Date = new Date()): { from: string; to: string } {
  const today = localToday(offsetMinutes, now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/**
 * Khoảng ngày của một lựa chọn nhanh, theo múi giờ vận hành do backend trả (`timezoneOffsetMinutes`) — CÙNG quy tắc
 * với `resolveDateRange` của backend (Hôm nay / Hôm qua trọn ngày; Tháng này = đầu tháng → hôm nay; Tháng trước =
 * TRỌN tháng liền trước). Backend nhận "YYYY-MM-DD" và tự quy về 00:00 → 23:59:59.999 giờ vận hành.
 */
export function presetRange(
  preset: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH',
  offsetMinutes: number,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = localToday(offsetMinutes, now);
  switch (preset) {
    case 'TODAY':
      return { from: today, to: today };
    case 'YESTERDAY': {
      const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - MS_PER_DAY).toISOString().slice(0, 10);
      return { from: yesterday, to: yesterday };
    }
    case 'THIS_MONTH':
      return currentMonthRange(offsetMinutes, now);
    case 'LAST_MONTH': {
      // Ngày cuối tháng trước = 1 ngày trước ngày 01 của tháng này (tự đúng 28 / 29 / 30 / 31 ngày).
      const lastDay = new Date(Date.parse(`${today.slice(0, 8)}01T00:00:00.000Z`) - MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
  }
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
