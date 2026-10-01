/**
 * Hàm thuần của Dashboard (không React) — kiểm bằng `npm run test:dashboard`.
 *
 * 🔴 Ngày trong Dashboard là chuỗi "YYYY-MM-DD" THEO GIỜ VẬN HÀNH do backend tính. Không đưa qua
 * `new Date()` của trình duyệt khi hiển thị: người xem ở múi giờ âm sẽ thấy lùi một ngày.
 */

/** Tháng hiện tại (đầu tháng → hôm nay) theo múi giờ vận hành (`offsetMinutes` so với UTC). */
export function currentMonthRange(offsetMinutes: number, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
  return { from: `${today.slice(0, 8)}01`, to: today };
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
