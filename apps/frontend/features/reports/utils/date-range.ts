import type { QuickRange } from '../constants';
import type { DateRangeParams } from '../types';

/** Format Date → 'YYYY-MM-DD' (local). */
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Quy đổi Quick Range → {startDate, endDate} (local date). 'all' → rỗng (không giới hạn).
 * 'custom' → trả về rỗng (người dùng tự nhập start/end). Tuần bắt đầu Thứ Hai.
 */
export function resolveQuickRange(range: QuickRange, now = new Date()): DateRangeParams {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (range) {
    case 'today':
      return { startDate: iso(today), endDate: iso(today) };
    case 'week': {
      const dow = (today.getDay() + 6) % 7; // 0 = Monday
      const start = new Date(today);
      start.setDate(today.getDate() - dow);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { startDate: iso(start), endDate: iso(end) };
    }
    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { startDate: iso(start), endDate: iso(end) };
    }
    case 'year': {
      const start = new Date(today.getFullYear(), 0, 1);
      const end = new Date(today.getFullYear(), 11, 31);
      return { startDate: iso(start), endDate: iso(end) };
    }
    case 'all':
    case 'custom':
    default:
      return {};
  }
}

/** Nhãn bucket time-series cho trục/tooltip theo groupBy. */
export function formatBucketLabel(bucket: string, groupBy: 'day' | 'month' | 'year'): string {
  // bucket = 'YYYY-MM-DD'
  const [y, m, d] = bucket.split('-');
  if (groupBy === 'year') return y;
  if (groupBy === 'month') return `${m}/${y}`;
  return `${d}/${m}`;
}
