import { parseCalendarDay, toCalendarDay } from './calendar-day';

describe('calendar-day — Ngày về tiền', () => {
  it('YYYY-MM-DD ⇄ Date 00:00 UTC, đọc lại đúng ngày (không lệch múi giờ)', () => {
    const date = parseCalendarDay('2026-11-05');
    expect(date?.toISOString()).toBe('2026-11-05T00:00:00.000Z');
    expect(toCalendarDay(date as Date)).toBe('2026-11-05');
  });

  it('ngày không tồn tại / sai dạng ⇒ null', () => {
    expect(parseCalendarDay('2026-02-30')).toBeNull();
    expect(parseCalendarDay('2026-13-01')).toBeNull();
    expect(parseCalendarDay('2026-1-5')).toBeNull();
    expect(parseCalendarDay('0099-01-01')).toBeNull();
  });

  it('năm nhuận', () => {
    expect(parseCalendarDay('2028-02-29')).not.toBeNull();
    expect(parseCalendarDay('2026-02-29')).toBeNull();
  });
});
