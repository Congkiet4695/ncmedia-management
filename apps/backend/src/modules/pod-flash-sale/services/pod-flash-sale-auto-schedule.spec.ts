import {
  addCalendarDays,
  autoDurationMinutes,
  computeNextWindow,
  fromZonedParts,
  isDueForNext,
  isValidTimeZone,
  latestSlot,
  nextSlot,
  toZonedParts,
  upcomingRun,
} from './pod-flash-sale-auto-schedule';

/**
 * Lịch của Auto Flash Sale — kịch bản đúng như yêu cầu (ngày cố định, múi giờ Los Angeles, KHÔNG
 * phụ thuộc múi giờ của máy chạy test).
 */
const LA = 'America/Los_Angeles';
const at = (y: number, mo: number, d: number, h: number, mi: number, tz = LA) =>
  fromZonedParts({ year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, tz);
const wall = (date: Date, tz = LA) => {
  const p = toZonedParts(date, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
};

const wallSec = (date: Date, tz = LA) => {
  const p = toZonedParts(date, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
};
const atSec = (y: number, mo: number, d: number, h: number, mi: number, s: number, tz = LA) =>
  fromZonedParts({ year: y, month: mo, day: d, hour: h, minute: mi, second: s }, tz);

describe('autoDurationMinutes — "Khoảng thời gian" tính theo PHÚT', () => {
  it.each([
    [1, 1440],
    [2, 2880],
    [3, 4320],
  ])('%i ngày ⇒ %i phút', (days, minutes) => {
    expect(autoDurationMinutes(days)).toBe(minutes);
  });

  it('khoảng thời gian không hợp lệ ⇒ ném lỗi (không đoán)', () => {
    expect(() => autoDurationMinutes(0)).toThrow();
    expect(() => autoDurationMinutes(1.5)).toThrow();
  });
});

describe('computeNextWindow — START = END + 1 phút, END = START + (N × 1440 − 1) phút', () => {
  const HCM = 'Asia/Ho_Chi_Minh';
  const MIN = 60_000;

  it.each([
    [1, '2026-10-22 13:59:00'],
    [2, '2026-10-23 13:59:00'],
    [3, '2026-10-24 13:59:00'],
  ])('Flash A 20/10 14:00 → 21/10 13:59 · %i ngày ⇒ Auto #1 21/10 14:00 → %s', (days, expectedEnd) => {
    for (const tz of [HCM, LA, 'UTC']) {
      const next = computeNextWindow(at(2026, 10, 21, 13, 59, tz), days);
      expect(wallSec(next.startAt, tz)).toBe('2026-10-21 14:00:00');
      expect(wallSec(next.endAt, tz)).toBe(expectedEnd);
      // Biểu diễn phút bao gồm hai đầu: N × 1440 phút ⇔ END − START = N × 1440 − 1 phút.
      expect(next.endAt.getTime() - next.startAt.getTime()).toBe((days * 1440 - 1) * MIN);
    }
  });

  it('🔴 KHÔNG ép về 23:59: đợt cũ kết thúc 21/10 23:59 ⇒ 22/10 00:00 → 22/10 23:59 (1 ngày)', () => {
    const next = computeNextWindow(at(2026, 10, 21, 23, 59, HCM), 1);
    expect(wallSec(next.startAt, HCM)).toBe('2026-10-22 00:00:00');
    expect(wallSec(next.endAt, HCM)).toBe('2026-10-22 23:59:00');
  });

  it('đợt cũ kết thúc 21/10 10:37 ⇒ 21/10 10:38 → 22/10 10:37 (1 ngày)', () => {
    const next = computeNextWindow(at(2026, 10, 21, 10, 37, HCM), 1);
    expect(wallSec(next.startAt, HCM)).toBe('2026-10-21 10:38:00');
    expect(wallSec(next.endAt, HCM)).toBe('2026-10-22 10:37:00');
  });

  it('chuỗi cũ (đợt trước kết thúc 23:59:59) ⇒ bắt đầu 00:00:00, không chồng', () => {
    const end = atSec(2026, 10, 20, 23, 59, 59, HCM);
    const next = computeNextWindow(end, 3);
    expect(wallSec(next.startAt, HCM)).toBe('2026-10-21 00:00:00');
    expect(wallSec(next.endAt, HCM)).toBe('2026-10-23 23:59:00');
    expect(next.startAt.getTime()).toBeGreaterThan(end.getTime());
  });

  it.each([1, 2, 3])('🔴 chuỗi A → #1 → #2 → #3 (%i ngày): mỗi đợt bắt đầu ĐÚNG 1 phút sau END đợt trước — không hở, không chồng', (days) => {
    let endAt = at(2026, 10, 21, 13, 59, HCM);
    const starts: string[] = [];
    for (let i = 0; i < 3; i++) {
      const next = computeNextWindow(endAt, days);
      expect(next.startAt.getTime() - endAt.getTime()).toBe(MIN);
      starts.push(wallSec(next.startAt, HCM));
      endAt = next.endAt;
    }
    const day = (offset: number) => `2026-10-${21 + offset * days} 14:00:00`;
    expect(starts).toEqual([day(0), day(1), day(2)]);
    expect(wallSec(endAt, HCM)).toBe(`2026-10-${21 + 3 * days} 13:59:00`);
  });

  it('🔴 qua mốc đổi giờ (LA, 01/11/2026): 1 ngày vẫn ĐÚNG 1440 phút, không thành 23 / 25 giờ', () => {
    const next = computeNextWindow(at(2026, 10, 31, 13, 59, LA), 1);
    expect(wallSec(next.startAt, LA)).toBe('2026-10-31 14:00:00');
    expect(next.endAt.getTime() - next.startAt.getTime() + MIN).toBe(1440 * MIN);
    // Giờ treo tường lùi 1 giờ vì đồng hồ LA được chỉnh lùi — thời lượng thật vẫn là 24 giờ.
    expect(wallSec(next.endAt, LA)).toBe('2026-11-01 12:59:00');
  });

  it('kết quả không phụ thuộc múi giờ: cùng một thời điểm END ⇒ cùng một START/END tuyệt đối', () => {
    const end = new Date('2026-10-21T06:59:00.000Z'); // 13:59 HCM
    const next = computeNextWindow(end, 1);
    expect(next.startAt.toISOString()).toBe('2026-10-21T07:00:00.000Z');
    expect(next.endAt.toISOString()).toBe('2026-10-22T06:59:00.000Z');
  });

  it('qua cuối tháng/năm', () => {
    const next = computeNextWindow(at(2026, 12, 30, 9, 14, HCM), 3);
    expect(wallSec(next.startAt, HCM)).toBe('2026-12-30 09:15:00');
    expect(wallSec(next.endAt, HCM)).toBe('2027-01-02 09:14:00');
  });

  it('cộng ngày lịch (dùng cho mốc chạy cron) qua cuối tháng/năm', () => {
    expect(wall(addCalendarDays(at(2026, 12, 30, 10, 0), 3, LA))).toBe('2027-01-02 10:00');
  });
});

describe('isDueForNext — còn ≤ 24 giờ', () => {
  const cron = at(2026, 1, 15, 5, 0);
  it('còn ~19 giờ (cron 05:00, kết thúc 23:59) ⇒ tới hạn', () => {
    expect(isDueForNext(at(2026, 1, 15, 23, 59), cron)).toBe(true);
  });
  it('còn ĐÚNG 24 giờ ⇒ tới hạn', () => {
    expect(isDueForNext(new Date(cron.getTime() + 24 * 3_600_000), cron)).toBe(true);
  });
  it('còn 24 giờ + 1 phút ⇒ CHƯA', () => {
    expect(isDueForNext(new Date(cron.getTime() + 24 * 3_600_000 + 60_000), cron)).toBe(false);
  });
  it('đã hết hạn ⇒ vẫn tới hạn (chạy bù)', () => {
    expect(isDueForNext(at(2026, 1, 14, 23, 59), cron)).toBe(true);
  });
});

describe('Mốc chạy mỗi ngày (giờ Admin cấu hình, theo múi giờ cấu hình)', () => {
  it('15:00 LA, giờ chạy 05:00 ⇒ mốc gần nhất là 05:00 HÔM NAY (chạy bù khi server lên lại)', () => {
    expect(wall(latestSlot(at(2026, 1, 15, 15, 0), '05:00', LA))).toBe('2026-01-15 05:00');
  });
  it('04:00 LA ⇒ mốc gần nhất là 05:00 HÔM QUA', () => {
    expect(wall(latestSlot(at(2026, 1, 15, 4, 0), '05:00', LA))).toBe('2026-01-14 05:00');
  });
  it('mốc kế tiếp sau 05:00 là 05:00 ngày mai', () => {
    expect(wall(nextSlot(at(2026, 1, 15, 5, 0), '05:00', LA))).toBe('2026-01-16 05:00');
  });
  it('lần chạy tới: mốc hôm nay chưa được giành ⇒ chính nó; đã giành ⇒ ngày mai', () => {
    const now = at(2026, 1, 15, 15, 0);
    expect(wall(upcomingRun(now, '05:00', LA, at(2026, 1, 14, 5, 0)))).toBe('2026-01-15 05:00');
    expect(wall(upcomingRun(now, '05:00', LA, at(2026, 1, 15, 5, 0)))).toBe('2026-01-16 05:00');
  });
  it('múi giờ IANA hợp lệ / không hợp lệ', () => {
    expect(isValidTimeZone(LA)).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
