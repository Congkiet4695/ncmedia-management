import { BadRequestException } from '@nestjs/common';
import { resolveDateRange, resolvePresetDays } from './date-range.util';

/**
 * Múi giờ nghiệp vụ mặc định: America/Los_Angeles (PST UTC−8 / PDT UTC−7).
 * Mọi mốc "Hôm nay / Hôm qua / Tháng này" tính theo ngày ở Los Angeles — KHÔNG theo UTC, không theo máy.
 *
 * Năm 2026: PDT bắt đầu 08/03 (02:00 PST → 03:00 PDT, ngày 23 giờ), kết thúc 01/11 (02:00 PDT → 01:00 PST,
 * ngày 25 giờ).
 */
const LA = 'America/Los_Angeles';

/** 2026-10-27 11:00 PDT  ⇔  2026-10-27T18:00:00Z */
const NOW = new Date('2026-10-27T18:00:00.000Z');

const HOUR = 3_600_000;
const iso = (d?: Date) => d?.toISOString() ?? null;
const lengthHours = (range: { from?: Date; before?: Date }) =>
  ((range.before as Date).getTime() - (range.from as Date).getTime()) / HOUR;
/** Bản ghi có lọt vào khoảng nửa mở không — đúng điều kiện SQL `from <= t < before`. */
const contains = (range: { from?: Date; before?: Date }, at: string) => {
  const time = Date.parse(at);
  return (!range.from || range.from.getTime() <= time) && (!range.before || time < range.before.getTime());
};

describe('resolveDateRange — America/Los_Angeles', () => {
  describe('TODAY', () => {
    it('00:00 → 00:00 hôm sau theo giờ Los Angeles (PDT = UTC−7), nửa mở', () => {
      const range = resolveDateRange('TODAY', LA, undefined, undefined, NOW);
      expect(iso(range.from)).toBe('2026-10-27T07:00:00.000Z');
      expect(iso(range.before)).toBe('2026-10-28T07:00:00.000Z');
      expect([range.fromDay, range.toDay]).toEqual(['2026-10-27', '2026-10-27']);
    });

    it('bao trùm chính thời điểm hiện tại', () => {
      expect(contains(resolveDateRange('TODAY', LA, undefined, undefined, NOW), NOW.toISOString())).toBe(true);
    });

    it('🔴 23:59:59 ở LA (UTC đã sang ngày hôm sau) vẫn là HÔM NAY của LA', () => {
      const lateNight = new Date('2026-10-28T06:59:59.000Z'); // 27/10 23:59:59 PDT — UTC là 28/10
      const range = resolveDateRange('TODAY', LA, undefined, undefined, lateNight);
      expect(range.fromDay).toBe('2026-10-27');
      expect(iso(range.from)).toBe('2026-10-27T07:00:00.000Z');
    });

    it('🔴 đúng 00:00 ở LA ⇒ đã sang ngày mới', () => {
      const midnight = new Date('2026-10-28T07:00:00.000Z');
      expect(resolveDateRange('TODAY', LA, undefined, undefined, midnight).fromDay).toBe('2026-10-28');
    });

    it('🔴 sáng sớm ở Việt Nam (UTC+7) vẫn là "hôm qua" của LA — không dùng ngày của máy người xem', () => {
      // 2026-10-27 08:00 giờ VN = 2026-10-27T01:00Z = 2026-10-26 18:00 PDT
      const vnMorning = new Date('2026-10-27T01:00:00.000Z');
      expect(resolveDateRange('TODAY', LA, undefined, undefined, vnMorning).fromDay).toBe('2026-10-26');
    });
  });

  describe('YESTERDAY', () => {
    it('trọn ngày hôm qua ở LA, nối tiếp KHÍT với TODAY (không chồng, không hở)', () => {
      const yesterday = resolveDateRange('YESTERDAY', LA, undefined, undefined, NOW);
      const today = resolveDateRange('TODAY', LA, undefined, undefined, NOW);
      expect(iso(yesterday.from)).toBe('2026-10-26T07:00:00.000Z');
      expect(iso(yesterday.before)).toBe(iso(today.from));
    });
  });

  describe('LAST_7_DAYS / LAST_30_DAYS', () => {
    it('7 ngày = hôm nay + 6 ngày LỊCH trước', () => {
      expect(resolvePresetDays('LAST_7_DAYS', LA, NOW)).toEqual({ fromDay: '2026-10-21', toDay: '2026-10-27' });
    });

    it('30 ngày = hôm nay + 29 ngày LỊCH trước', () => {
      expect(resolvePresetDays('LAST_30_DAYS', LA, NOW)).toEqual({ fromDay: '2026-09-28', toDay: '2026-10-27' });
    });

    it('🔴 7 ngày chứa ngày đổi giờ (08/03) dài 7×24 − 1 giờ — không cộng cố định 24 giờ', () => {
      const range = resolveDateRange('LAST_7_DAYS', LA, undefined, undefined, new Date('2026-03-10T20:00:00.000Z'));
      expect(iso(range.from)).toBe('2026-03-04T08:00:00.000Z'); // 00:00 PST
      expect(iso(range.before)).toBe('2026-03-11T07:00:00.000Z'); // 00:00 PDT
      expect(lengthHours(range)).toBe(7 * 24 - 1);
    });
  });

  describe('THIS_MONTH', () => {
    it('từ 00:00 ngày 01 ở LA đến hết hôm nay', () => {
      const range = resolveDateRange('THIS_MONTH', LA, undefined, undefined, NOW);
      expect(iso(range.from)).toBe('2026-10-01T07:00:00.000Z');
      expect(iso(range.before)).toBe('2026-10-28T07:00:00.000Z');
    });

    it('🔴 tháng có ngày đổi giờ: đầu tháng PDT (UTC−7), cuối khoảng PST (UTC−8)', () => {
      const range = resolveDateRange('THIS_MONTH', LA, undefined, undefined, new Date('2026-11-15T20:00:00.000Z'));
      expect(iso(range.from)).toBe('2026-11-01T07:00:00.000Z');
      expect(iso(range.before)).toBe('2026-11-16T08:00:00.000Z');
    });

    it('ngày 01 lúc 00:30 ở LA ⇒ "Tháng này" đúng một ngày', () => {
      const range = resolveDateRange('THIS_MONTH', LA, undefined, undefined, new Date('2026-10-01T07:30:00.000Z'));
      expect([range.fromDay, range.toDay]).toEqual(['2026-10-01', '2026-10-01']);
    });

    it('🔴 30/09 21:00 ở LA (UTC đã là 01/10) vẫn thuộc THÁNG 9', () => {
      const range = resolveDateRange('THIS_MONTH', LA, undefined, undefined, new Date('2026-10-01T04:00:00.000Z'));
      expect([range.fromDay, range.toDay]).toEqual(['2026-09-01', '2026-09-30']);
    });
  });

  describe('LAST_MONTH', () => {
    it('trọn tháng LIỀN TRƯỚC ở LA, nối khít với THIS_MONTH', () => {
      const last = resolveDateRange('LAST_MONTH', LA, undefined, undefined, NOW);
      const thisMonth = resolveDateRange('THIS_MONTH', LA, undefined, undefined, NOW);
      expect([last.fromDay, last.toDay]).toEqual(['2026-09-01', '2026-09-30']);
      expect(iso(last.from)).toBe('2026-09-01T07:00:00.000Z');
      expect(iso(last.before)).toBe(iso(thisMonth.from));
    });

    it('🔴 đang ở tháng 1 ⇒ tháng 12 năm trước (PST, UTC−8)', () => {
      const range = resolveDateRange('LAST_MONTH', LA, undefined, undefined, new Date('2027-01-05T20:00:00.000Z'));
      expect(iso(range.from)).toBe('2026-12-01T08:00:00.000Z');
      expect(iso(range.before)).toBe('2027-01-01T08:00:00.000Z');
    });

    it('tháng 2 năm nhuận đủ 29 ngày', () => {
      expect(resolvePresetDays('LAST_MONTH', LA, new Date('2028-03-10T20:00:00.000Z'))).toEqual({
        fromDay: '2028-02-01',
        toDay: '2028-02-29',
      });
    });
  });

  describe('🔴 ngày đổi giờ mùa hè', () => {
    it('08/03/2026 (bắt đầu PDT) dài 23 giờ', () => {
      const range = resolveDateRange('CUSTOM', LA, '2026-03-08', '2026-03-08');
      expect(iso(range.from)).toBe('2026-03-08T08:00:00.000Z');
      expect(iso(range.before)).toBe('2026-03-09T07:00:00.000Z');
      expect(lengthHours(range)).toBe(23);
    });

    it('01/11/2026 (kết thúc PDT) dài 25 giờ', () => {
      const range = resolveDateRange('CUSTOM', LA, '2026-11-01', '2026-11-01');
      expect(iso(range.from)).toBe('2026-11-01T07:00:00.000Z');
      expect(iso(range.before)).toBe('2026-11-02T08:00:00.000Z');
      expect(lengthHours(range)).toBe(25);
    });

    it('YESTERDAY vào sáng 09/03 = trọn ngày 23 giờ 08/03', () => {
      const range = resolveDateRange('YESTERDAY', LA, undefined, undefined, new Date('2026-03-09T16:00:00.000Z'));
      expect(range.fromDay).toBe('2026-03-08');
      expect(lengthHours(range)).toBe(23);
    });

    it('bản ghi 01:30 lần THỨ HAI (PST) của ngày 01/11 vẫn thuộc ngày 01/11', () => {
      const range = resolveDateRange('CUSTOM', LA, '2026-11-01', '2026-11-01');
      expect(contains(range, '2026-11-01T08:30:00.000Z')).toBe(true); // 01:30 PDT
      expect(contains(range, '2026-11-01T09:30:00.000Z')).toBe(true); // 01:30 PST
      expect(contains(range, '2026-11-02T07:59:59.999Z')).toBe(true); // 23:59:59.999 PST
    });
  });

  describe('🔴 ranh giới nửa mở', () => {
    const range = resolveDateRange('CUSTOM', LA, '2026-10-27', '2026-10-27');

    it('bản ghi ĐÚNG 00:00 đầu ngày được tính', () => {
      expect(contains(range, '2026-10-27T07:00:00.000Z')).toBe(true);
    });

    it('bản ghi 23:59:59.999999 cuối ngày được tính (không bỏ sót micro giây)', () => {
      // `Date` chỉ có mili giây — kiểm mốc thật sự: mọi t < before đều lọt, kể cả 1 µs trước before.
      expect(range.before!.getTime() - 1).toBeGreaterThanOrEqual(range.from!.getTime());
      expect(contains(range, '2026-10-28T06:59:59.999Z')).toBe(true);
    });

    it('bản ghi ĐÚNG 00:00 ngày hôm sau KHÔNG được tính', () => {
      expect(contains(range, '2026-10-28T07:00:00.000Z')).toBe(false);
    });

    it('bản ghi 23:59 ngày hôm trước KHÔNG được tính', () => {
      expect(contains(range, '2026-10-27T06:59:59.999Z')).toBe(false);
    });
  });

  describe('ALL', () => {
    it('không giới hạn thời gian', () => {
      expect(resolveDateRange('ALL', LA, undefined, undefined, NOW)).toEqual({});
    });

    it('bỏ qua khoảng tuỳ chọn khi chọn ALL', () => {
      expect(resolveDateRange('ALL', LA, '2026-01-01', '2026-01-31', NOW)).toEqual({});
    });
  });

  describe('CUSTOM', () => {
    it('nhiều ngày ⇒ từ 00:00 ngày đầu đến 00:00 sau ngày cuối (gồm trọn ngày cuối)', () => {
      const range = resolveDateRange('CUSTOM', LA, '2026-10-01', '2026-10-15');
      expect(iso(range.from)).toBe('2026-10-01T07:00:00.000Z');
      expect(iso(range.before)).toBe('2026-10-16T07:00:00.000Z');
      expect([range.fromDay, range.toDay]).toEqual(['2026-10-01', '2026-10-15']);
    });

    it('🔴 chuỗi YYYY-MM-DD là ngày LỊCH ở LA — không bị `new Date()` (UTC) kéo lùi một ngày', () => {
      // Lỗi cũ: new Date('2026-10-27') = 00:00Z = 26/10 17:00 PDT ⇒ lọc nhầm ngày 26.
      expect(resolveDateRange('CUSTOM', LA, '2026-10-27', '2026-10-27').fromDay).toBe('2026-10-27');
    });

    it('chỉ có ngày bắt đầu ⇒ không giới hạn ngày kết thúc', () => {
      const range = resolveDateRange('CUSTOM', LA, '2026-10-01', undefined);
      expect(iso(range.from)).toBe('2026-10-01T07:00:00.000Z');
      expect(range.before).toBeUndefined();
    });

    it('không có preset nhưng có khoảng ngày ⇒ vẫn áp dụng khoảng đó', () => {
      expect(iso(resolveDateRange(undefined, LA, '2026-10-01', '2026-10-01').from)).toBe('2026-10-01T07:00:00.000Z');
    });

    it('không preset, không khoảng ngày ⇒ không lọc', () => {
      expect(resolveDateRange(undefined, LA)).toEqual({ from: undefined, before: undefined });
    });

    it('🔴 ngày bắt đầu SAU ngày kết thúc ⇒ 400 DATE_RANGE_INVALID', () => {
      expect(() => resolveDateRange('CUSTOM', LA, '2026-10-15', '2026-10-01')).toThrow(BadRequestException);
      try {
        resolveDateRange('CUSTOM', LA, '2026-10-15', '2026-10-01');
      } catch (error) {
        expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'DATE_RANGE_INVALID' });
      }
    });

    it('🔴 ngày không tồn tại (30/02) ⇒ 400, không tự "lăn" sang tháng sau', () => {
      expect(() => resolveDateRange('CUSTOM', LA, '2026-02-30', '2026-03-01')).toThrow(BadRequestException);
    });

    it('client cũ gửi ISO có giờ ⇒ hiểu là THỜI ĐIỂM, quy về ngày ở LA chứa nó (không dịch giờ hai lần)', () => {
      // 2026-10-28T03:00Z = 27/10 20:00 PDT
      const range = resolveDateRange('CUSTOM', LA, '2026-10-28T03:00:00.000Z', '2026-10-28T03:00:00.000Z');
      expect([range.fromDay, range.toDay]).toEqual(['2026-10-27', '2026-10-27']);
    });
  });

  describe('múi giờ cấu hình được', () => {
    it('Asia/Ho_Chi_Minh (UTC+7, không đổi giờ) cho mốc khác với LA', () => {
      const range = resolveDateRange('TODAY', 'Asia/Ho_Chi_Minh', undefined, undefined, NOW);
      expect(iso(range.from)).toBe('2026-10-27T17:00:00.000Z');
      expect(iso(range.before)).toBe('2026-10-28T17:00:00.000Z');
    });
  });
});
