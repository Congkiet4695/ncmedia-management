/**
 * Bộ lọc thời gian theo preset cho danh sách đơn.
 *
 * Preset được quy đổi ở **BACKEND** (yêu cầu nghiệp vụ: không filter ở frontend),
 * theo múi giờ vận hành cấu hình qua `APP_TIMEZONE_OFFSET_MINUTES` (mặc định UTC+7).
 * Nhờ vậy "Hôm nay" là hôm nay theo giờ đội vận hành, không phải theo giờ UTC của máy chủ.
 */

export const POD_DATE_PRESETS = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'ALL',
  'CUSTOM',
] as const;
export type PodDatePreset = (typeof POD_DATE_PRESETS)[number];

/** Khoảng thời gian đã quy đổi sang UTC để truy vấn DB. `undefined` = không giới hạn. */
export interface ResolvedDateRange {
  from?: Date;
  to?: Date;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * Quy đổi preset (+ khoảng tuỳ chọn) thành khoảng UTC.
 *
 * @param preset      Preset người dùng chọn. Bỏ trống ⇒ dùng `customFrom`/`customTo` nếu có.
 * @param offsetMin   Chênh lệch múi giờ vận hành so với UTC, tính bằng phút (VN = 420).
 * @param customFrom  Ngày bắt đầu (ISO) — dùng cho preset `CUSTOM`.
 * @param customTo    Ngày kết thúc (ISO) — dùng cho preset `CUSTOM`. Bao gồm TRỌN ngày này.
 * @param now         Thời điểm hiện tại (tiêm vào để test tất định).
 */
export function resolveDateRange(
  preset: PodDatePreset | undefined,
  offsetMin: number,
  customFrom?: string,
  customTo?: string,
  now: Date = new Date(),
): ResolvedDateRange {
  // Không chọn preset (hoặc chọn CUSTOM) ⇒ dùng khoảng tuỳ chọn nếu có.
  if (!preset || preset === 'CUSTOM') {
    return {
      from: customFrom ? startOfLocalDay(new Date(customFrom), offsetMin) : undefined,
      to: customTo ? endOfLocalDay(new Date(customTo), offsetMin) : undefined,
    };
  }

  if (preset === 'ALL') return {};

  const todayStart = startOfLocalDay(now, offsetMin);

  switch (preset) {
    case 'TODAY':
      return { from: todayStart, to: endOfLocalDay(now, offsetMin) };

    case 'YESTERDAY': {
      const yesterday = new Date(now.getTime() - MS_PER_DAY);
      return {
        from: startOfLocalDay(yesterday, offsetMin),
        to: endOfLocalDay(yesterday, offsetMin),
      };
    }

    // "7 ngày gần nhất" = hôm nay và 6 ngày trước đó (tổng 7 ngày, gồm cả hôm nay).
    case 'LAST_7_DAYS':
      return {
        from: new Date(todayStart.getTime() - 6 * MS_PER_DAY),
        to: endOfLocalDay(now, offsetMin),
      };

    case 'LAST_30_DAYS':
      return {
        from: new Date(todayStart.getTime() - 29 * MS_PER_DAY),
        to: endOfLocalDay(now, offsetMin),
      };

    case 'THIS_MONTH':
      return { from: startOfLocalMonth(now, offsetMin), to: endOfLocalDay(now, offsetMin) };

    // "Tháng trước" = trọn tháng liền trước, KHÔNG phải 30 ngày gần nhất.
    case 'LAST_MONTH': {
      const thisMonthStart = startOfLocalMonth(now, offsetMin);
      // Lùi 1ms để rơi vào ngày cuối cùng của tháng trước, rồi lấy trọn tháng đó.
      const lastMonthDay = new Date(thisMonthStart.getTime() - 1);
      return {
        from: startOfLocalMonth(lastMonthDay, offsetMin),
        to: endOfLocalDay(lastMonthDay, offsetMin),
      };
    }

    default:
      return {};
  }
}

/** 00:00:00.000 của ngày (theo múi giờ vận hành), trả về mốc UTC. */
function startOfLocalDay(date: Date, offsetMin: number): Date {
  const local = new Date(date.getTime() + offsetMin * MS_PER_MINUTE);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMin * MS_PER_MINUTE);
}

/** 23:59:59.999 của ngày (theo múi giờ vận hành), trả về mốc UTC. */
function endOfLocalDay(date: Date, offsetMin: number): Date {
  const local = new Date(date.getTime() + offsetMin * MS_PER_MINUTE);
  local.setUTCHours(23, 59, 59, 999);
  return new Date(local.getTime() - offsetMin * MS_PER_MINUTE);
}

/** 00:00:00.000 ngày đầu tháng (theo múi giờ vận hành), trả về mốc UTC. */
function startOfLocalMonth(date: Date, offsetMin: number): Date {
  const local = new Date(date.getTime() + offsetMin * MS_PER_MINUTE);
  local.setUTCDate(1);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offsetMin * MS_PER_MINUTE);
}
