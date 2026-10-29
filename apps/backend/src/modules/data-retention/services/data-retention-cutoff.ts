import {
  addCalendarDays,
  businessDayOf,
  startOfBusinessDay,
} from '../../../common/time/business-time';

/** Mốc giữ lại của một tác vụ: dữ liệu có thời điểm `< cutoff` là hết hạn. */
export interface RetentionCutoff {
  /** Ngày nghiệp vụ (YYYY-MM-DD) ĐẦU TIÊN được giữ lại. */
  keepFromDay: string;
  /** 00:00 của `keepFromDay` ở múi giờ nghiệp vụ — điều kiện xoá là `timestamp < cutoff`. */
  cutoff: Date;
}

/**
 * Giữ `keepDays` NGÀY LỊCH gần nhất TÍNH CẢ HÔM NAY, theo múi giờ nghiệp vụ.
 *
 * ```
 *   keepDays = 1  ⇒ chỉ hôm nay                        (Recent Notifications)
 *   keepDays = 7  ⇒ hôm nay + 6 ngày trước             (Publish History / Draft Listings)
 * ```
 *
 * 🔴 Không cộng trừ cố định 24 giờ: ngày đổi giờ mùa hè dài 23 / 25 giờ. Mốc là 00:00 địa phương do
 * `startOfBusinessDay` tính bằng dữ liệu IANA — không phụ thuộc múi giờ của server / container / DB.
 */
export function retentionCutoff(now: Date, timeZone: string, keepDays: number): RetentionCutoff {
  if (!Number.isInteger(keepDays) || keepDays < 1) {
    throw new RangeError('Số ngày giữ lại phải là số nguyên ≥ 1');
  }
  const keepFromDay = addCalendarDays(businessDayOf(now, timeZone), -(keepDays - 1));
  return { keepFromDay, cutoff: startOfBusinessDay(keepFromDay, timeZone) };
}
