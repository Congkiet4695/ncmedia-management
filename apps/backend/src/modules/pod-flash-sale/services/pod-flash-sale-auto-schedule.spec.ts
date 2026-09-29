import {
  addCalendarDays,
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

describe('computeNextWindow — START = END + 10 phút, END = START + 3 ngày lịch − 1 phút', () => {
  it('A 13/01 00:00 → 15/01 23:59 ⇒ B 16/01 00:09 → 19/01 00:08', () => {
    const next = computeNextWindow(at(2026, 1, 15, 23, 59), LA);
    expect(wall(next.startAt)).toBe('2026-01-16 00:09');
    expect(wall(next.endAt)).toBe('2026-01-19 00:08');
  });

  it('chu kỳ kế: C tính từ END của B, không từ ngày chạy cron', () => {
    const b = computeNextWindow(at(2026, 1, 15, 23, 59), LA);
    const c = computeNextWindow(b.endAt, LA);
    expect(wall(c.startAt)).toBe('2026-01-19 00:18');
    expect(wall(c.endAt)).toBe('2026-01-22 00:17');
  });

  it('🔴 qua mốc đổi giờ mùa hè (08/03/2026) vẫn giữ giờ treo tường — không cộng cứng 72 giờ', () => {
    const next = computeNextWindow(at(2026, 3, 6, 23, 59), LA);
    expect(wall(next.startAt)).toBe('2026-03-07 00:09');
    expect(wall(next.endAt)).toBe('2026-03-10 00:08');
    // Mất một giờ vì DST: 3 ngày lịch − 1 phút = 71 giờ 59 phút − 1 giờ.
    expect((next.endAt.getTime() - next.startAt.getTime()) / 60_000).toBe(71 * 60 - 1);
  });

  it('🔴 cùng một thời điểm, múi giờ khác ⇒ kết quả theo múi giờ CỦA ĐỢT SALE, không của server', () => {
    const end = at(2026, 1, 15, 23, 59, 'Asia/Ho_Chi_Minh');
    const next = computeNextWindow(end, 'Asia/Ho_Chi_Minh');
    expect(wall(next.endAt, 'Asia/Ho_Chi_Minh')).toBe('2026-01-19 00:08');
  });

  it('cộng ngày lịch qua cuối tháng/năm', () => {
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
