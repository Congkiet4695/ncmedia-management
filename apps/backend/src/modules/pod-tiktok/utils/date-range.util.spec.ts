import { resolveDateRange } from './date-range.util';

/**
 * Múi giờ vận hành mặc định: UTC+7 (giờ Việt Nam).
 * Mọi mốc "Hôm nay / Hôm qua / Tháng này" phải tính theo giờ này, KHÔNG theo UTC.
 */
const VN = 420;

/** 2026-08-06 09:30 giờ VN  ⇔  2026-08-06T02:30:00Z */
const NOW = new Date('2026-08-06T02:30:00.000Z');

/** Rút gọn để so sánh dễ đọc. */
const iso = (d?: Date) => d?.toISOString() ?? null;

describe('resolveDateRange', () => {
  describe('TODAY', () => {
    it('bắt đầu 00:00 và kết thúc 23:59:59.999 giờ VN', () => {
      const range = resolveDateRange('TODAY', VN, undefined, undefined, NOW);
      // 00:00 VN ngày 06/08 = 17:00Z ngày 05/08
      expect(iso(range.from)).toBe('2026-08-05T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-06T16:59:59.999Z');
    });

    it('bao trùm chính thời điểm hiện tại', () => {
      const range = resolveDateRange('TODAY', VN, undefined, undefined, NOW);
      expect(range.from!.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(range.to!.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    });

    it('🔴 sát nửa đêm giờ VN vẫn ra đúng ngày (không lệch sang hôm trước theo UTC)', () => {
      // 00:30 giờ VN ngày 06/08 = 17:30Z ngày 05/08 — theo UTC vẫn là ngày 05.
      const nearMidnight = new Date('2026-08-05T17:30:00.000Z');
      const range = resolveDateRange('TODAY', VN, undefined, undefined, nearMidnight);
      expect(iso(range.from)).toBe('2026-08-05T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-06T16:59:59.999Z');
    });
  });

  describe('YESTERDAY', () => {
    it('trọn ngày hôm qua theo giờ VN', () => {
      const range = resolveDateRange('YESTERDAY', VN, undefined, undefined, NOW);
      expect(iso(range.from)).toBe('2026-08-04T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-05T16:59:59.999Z');
    });

    it('không chồng lấn với TODAY', () => {
      const yesterday = resolveDateRange('YESTERDAY', VN, undefined, undefined, NOW);
      const today = resolveDateRange('TODAY', VN, undefined, undefined, NOW);
      expect(yesterday.to!.getTime()).toBeLessThan(today.from!.getTime());
    });
  });

  describe('LAST_7_DAYS / LAST_30_DAYS', () => {
    it('7 ngày = hôm nay + 6 ngày trước', () => {
      const range = resolveDateRange('LAST_7_DAYS', VN, undefined, undefined, NOW);
      expect(iso(range.from)).toBe('2026-07-30T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-06T16:59:59.999Z');
    });

    it('30 ngày = hôm nay + 29 ngày trước', () => {
      const range = resolveDateRange('LAST_30_DAYS', VN, undefined, undefined, NOW);
      // 00:00 giờ VN ngày 08/07 (= 06/08 lùi 29 ngày) ứng với 17:00Z ngày 07/07.
      expect(iso(range.from)).toBe('2026-07-07T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-06T16:59:59.999Z');
    });

    it('khoảng 30 ngày đúng bằng 30 ngày tròn', () => {
      const range = resolveDateRange('LAST_30_DAYS', VN, undefined, undefined, NOW);
      const days = (range.to!.getTime() - range.from!.getTime() + 1) / (24 * 3600 * 1000);
      expect(days).toBeCloseTo(30, 5);
    });

    it('khoảng 7 ngày đúng bằng 7 ngày tròn', () => {
      const range = resolveDateRange('LAST_7_DAYS', VN, undefined, undefined, NOW);
      const days = (range.to!.getTime() - range.from!.getTime() + 1) / (24 * 3600 * 1000);
      expect(days).toBeCloseTo(7, 5);
    });
  });

  describe('THIS_MONTH', () => {
    it('từ 00:00 ngày 1 của tháng theo giờ VN', () => {
      const range = resolveDateRange('THIS_MONTH', VN, undefined, undefined, NOW);
      // 00:00 VN ngày 01/08 = 17:00Z ngày 31/07
      expect(iso(range.from)).toBe('2026-07-31T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-06T16:59:59.999Z');
    });

    it('ngày đầu tháng: from và to nằm trong cùng một ngày', () => {
      const firstDay = new Date('2026-08-01T03:00:00.000Z'); // 10:00 VN ngày 01/08
      const range = resolveDateRange('THIS_MONTH', VN, undefined, undefined, firstDay);
      expect(iso(range.from)).toBe('2026-07-31T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-01T16:59:59.999Z');
    });
  });

  describe('LAST_MONTH', () => {
    it('trọn tháng LIỀN TRƯỚC theo giờ VN (không phải 30 ngày gần nhất)', () => {
      const range = resolveDateRange('LAST_MONTH', VN, undefined, undefined, NOW);
      // 00:00 VN ngày 01/07 = 17:00Z ngày 30/06 · hết ngày 31/07 VN = 16:59:59.999Z ngày 31/07
      expect(iso(range.from)).toBe('2026-06-30T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-07-31T16:59:59.999Z');
    });

    it('không chồng lấn với THIS_MONTH', () => {
      const last = resolveDateRange('LAST_MONTH', VN, undefined, undefined, NOW);
      const current = resolveDateRange('THIS_MONTH', VN, undefined, undefined, NOW);
      expect(last.to!.getTime()).toBeLessThan(current.from!.getTime());
    });

    it('🔴 đang ở tháng 1 → lùi đúng sang tháng 12 năm trước', () => {
      const january = new Date('2026-01-10T03:00:00.000Z'); // 10:00 VN ngày 10/01/2026
      const range = resolveDateRange('LAST_MONTH', VN, undefined, undefined, january);
      expect(iso(range.from)).toBe('2025-11-30T17:00:00.000Z');
      expect(iso(range.to)).toBe('2025-12-31T16:59:59.999Z');
    });

    it('ngày đầu tháng vẫn ra trọn tháng trước', () => {
      const firstDay = new Date('2026-08-01T03:00:00.000Z');
      const range = resolveDateRange('LAST_MONTH', VN, undefined, undefined, firstDay);
      expect(iso(range.from)).toBe('2026-06-30T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-07-31T16:59:59.999Z');
    });
  });

  describe('ALL', () => {
    it('không giới hạn thời gian', () => {
      expect(resolveDateRange('ALL', VN, undefined, undefined, NOW)).toEqual({});
    });

    it('bỏ qua cả khoảng tuỳ chọn nếu chọn ALL', () => {
      const range = resolveDateRange('ALL', VN, '2026-01-01', '2026-02-01', NOW);
      expect(range).toEqual({});
    });
  });

  describe('CUSTOM', () => {
    it('bao TRỌN cả ngày bắt đầu và ngày kết thúc', () => {
      const range = resolveDateRange('CUSTOM', VN, '2026-07-01', '2026-07-31', NOW);
      expect(iso(range.from)).toBe('2026-06-30T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-07-31T16:59:59.999Z');
    });

    it('chọn cùng một ngày → trọn 24 giờ của ngày đó', () => {
      const range = resolveDateRange('CUSTOM', VN, '2026-07-15', '2026-07-15', NOW);
      const hours = (range.to!.getTime() - range.from!.getTime() + 1) / (3600 * 1000);
      expect(hours).toBeCloseTo(24, 5);
    });

    it('chỉ có ngày bắt đầu → không giới hạn ngày kết thúc', () => {
      const range = resolveDateRange('CUSTOM', VN, '2026-07-01', undefined, NOW);
      expect(range.from).toBeDefined();
      expect(range.to).toBeUndefined();
    });

    it('không có preset nhưng có khoảng ngày → vẫn áp dụng khoảng đó', () => {
      const range = resolveDateRange(undefined, VN, '2026-07-01', '2026-07-31', NOW);
      expect(iso(range.from)).toBe('2026-06-30T17:00:00.000Z');
      expect(iso(range.to)).toBe('2026-07-31T16:59:59.999Z');
    });

    it('không preset, không khoảng ngày → không lọc', () => {
      expect(resolveDateRange(undefined, VN, undefined, undefined, NOW)).toEqual({});
    });
  });

  describe('Múi giờ khác', () => {
    it('UTC (offset 0) cho mốc khác với UTC+7', () => {
      const vn = resolveDateRange('TODAY', VN, undefined, undefined, NOW);
      const utc = resolveDateRange('TODAY', 0, undefined, undefined, NOW);
      expect(iso(utc.from)).toBe('2026-08-06T00:00:00.000Z');
      expect(iso(vn.from)).not.toBe(iso(utc.from));
    });

    it('múi giờ âm (US Pacific, -420) vẫn tính đúng', () => {
      const range = resolveDateRange('TODAY', -420, undefined, undefined, NOW);
      // 02:30Z ngày 06/08 = 19:30 ngày 05/08 giờ PDT ⇒ "hôm nay" là ngày 05/08.
      expect(iso(range.from)).toBe('2026-08-05T07:00:00.000Z');
      expect(iso(range.to)).toBe('2026-08-06T06:59:59.999Z');
    });
  });
});
