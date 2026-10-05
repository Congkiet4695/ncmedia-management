import {
  addCalendarDays,
  computeEndOfDuration,
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

describe('computeEndOfDuration — "Khoảng thời gian" theo NGÀY LỊCH, kết thúc 23:59:59', () => {
  it.each([
    [1, '2026-10-20 23:59:59'],
    [2, '2026-10-21 23:59:59'],
    [3, '2026-10-22 23:59:59'],
  ])('start 20/10/2026 00:00 · %i ngày ⇒ %s', (days, expected) => {
    expect(wallSec(computeEndOfDuration(at(2026, 10, 20, 0, 0), days, LA))).toBe(expected);
  });

  it('🔴 1 ngày = hết CHÍNH ngày bắt đầu, KHÔNG phải +24 giờ (bắt đầu 00:09 ⇒ kết thúc 23:59:59 cùng ngày)', () => {
    const start = at(2026, 10, 21, 0, 9);
    const end = computeEndOfDuration(start, 1, LA);
    expect(wallSec(end)).toBe('2026-10-21 23:59:59');
    expect(end.getTime() - start.getTime()).toBeLessThan(24 * 3_600_000);
  });

  it('khoảng thời gian không hợp lệ ⇒ ném lỗi (không đoán)', () => {
    expect(() => computeEndOfDuration(at(2026, 10, 20, 0, 0), 0, LA)).toThrow();
    expect(() => computeEndOfDuration(at(2026, 10, 20, 0, 0), 1.5, LA)).toThrow();
  });
});

describe('computeNextWindow — START = END + 10 phút (tròn phút), END = 23:59:59 của ngày (START + N − 1)', () => {
  it.each([
    [1, '2026-10-21 23:59:59'],
    [2, '2026-10-22 23:59:59'],
    [3, '2026-10-23 23:59:59'],
  ])('A kết thúc 20/10 23:59:59 ⇒ B 21/10 00:09:00 → (%i ngày) %s', (days, expectedEnd) => {
    const next = computeNextWindow(atSec(2026, 10, 20, 23, 59, 59), LA, days);
    expect(wallSec(next.startAt)).toBe('2026-10-21 00:09:00');
    expect(wallSec(next.endAt)).toBe(expectedEnd);
  });

  it('chuỗi cũ (A kết thúc 23:59:00) vẫn bắt đầu 00:09:00 như trước', () => {
    const next = computeNextWindow(at(2026, 1, 15, 23, 59), LA, 3);
    expect(wallSec(next.startAt)).toBe('2026-01-16 00:09:00');
    expect(wallSec(next.endAt)).toBe('2026-01-18 23:59:59');
  });

  it('chu kỳ kế: C tính từ END của B, không từ ngày chạy cron', () => {
    const b = computeNextWindow(atSec(2026, 10, 20, 23, 59, 59), LA, 2);
    const c = computeNextWindow(b.endAt, LA, 2);
    expect(wallSec(c.startAt)).toBe('2026-10-23 00:09:00');
    expect(wallSec(c.endAt)).toBe('2026-10-24 23:59:59');
  });

  it('🔴 qua mốc đổi giờ mùa hè (08/03/2026) vẫn kết thúc 23:59:59 giờ treo tường', () => {
    const next = computeNextWindow(atSec(2026, 3, 6, 23, 59, 59), LA, 3);
    expect(wallSec(next.startAt)).toBe('2026-03-07 00:09:00');
    expect(wallSec(next.endAt)).toBe('2026-03-09 23:59:59');
  });

  it('🔴 múi giờ của ĐỢT SALE quyết định ngày, không phải múi giờ server / trình duyệt', () => {
    const end = atSec(2026, 10, 20, 23, 59, 59, 'Asia/Ho_Chi_Minh');
    const vn = computeNextWindow(end, 'Asia/Ho_Chi_Minh', 1);
    expect(wallSec(vn.startAt, 'Asia/Ho_Chi_Minh')).toBe('2026-10-21 00:09:00');
    expect(wallSec(vn.endAt, 'Asia/Ho_Chi_Minh')).toBe('2026-10-21 23:59:59');
    // Cùng thời điểm A kết thúc, nếu (sai) tính theo Los Angeles thì ngày cuối lệch.
    expect(wallSec(computeNextWindow(end, LA, 1).endAt, 'Asia/Ho_Chi_Minh')).not.toBe('2026-10-21 23:59:59');
  });

  it('cộng ngày lịch qua cuối tháng/năm', () => {
    expect(wall(addCalendarDays(at(2026, 12, 30, 10, 0), 3, LA))).toBe('2027-01-02 10:00');
    expect(wallSec(computeNextWindow(atSec(2026, 12, 30, 23, 59, 59), LA, 3).endAt)).toBe('2027-01-02 23:59:59');
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
