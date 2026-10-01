import { DASHBOARD_MAX_RANGE_DAYS, localDay, percentChange, resolveDayRange } from './dashboard-metrics';
import { ORDER_STATUS_GROUPS, orderStatusGroupOf } from './order-status-groups';
import { TIKTOK_ORDER_STATUSES } from '../constants/tiktok.constants';

describe('percentChange', () => {
  it('(hiện tại − trước) / trước × 100, làm tròn 2 số', () => {
    expect(percentChange(2, 8)).toBe(-75);
    expect(percentChange(223, 139)).toBe(60.43);
    expect(percentChange(10, 10)).toBe(0);
  });

  it('kỳ trước = 0 ⇒ null (không chia 0)', () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe('resolveDayRange (UTC+7)', () => {
  const NOW = new Date('2026-09-30T18:30:00.000Z'); // 01/10/2026 01:30 giờ VN

  it('bỏ trống ⇒ đầu tháng (giờ VN) → hôm nay', () => {
    const range = resolveDayRange(undefined, undefined, 420, NOW);
    expect(range.fromDay).toBe('2026-10-01');
    expect(range.toDay).toBe('2026-10-01');
    expect(range.from.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-01T16:59:59.999Z');
  });

  it('khoảng tuỳ chọn gồm trọn hai ngày mút', () => {
    const range = resolveDayRange('2026-09-01', '2026-09-30', 420, NOW);
    expect(range.days).toBe(30);
    expect(range.from.toISOString()).toBe('2026-08-31T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-30T16:59:59.999Z');
  });

  it('sai định dạng / ngược chiều / quá dài ⇒ RangeError', () => {
    expect(() => resolveDayRange('2026/09/01', '2026-09-30', 420)).toThrow(RangeError);
    expect(() => resolveDayRange('2026-09-30', '2026-09-01', 420)).toThrow(RangeError);
    expect(() => resolveDayRange('2024-01-01', '2026-01-01', 420)).toThrow(`${DASHBOARD_MAX_RANGE_DAYS}`);
  });

  it('localDay theo múi giờ vận hành', () => {
    expect(localDay(NOW, 420)).toBe('2026-10-01');
    expect(localDay(NOW, 0)).toBe('2026-09-30');
  });
});

describe('ORDER_STATUS_GROUPS', () => {
  it('mọi trạng thái TikTok đã biết thuộc ĐÚNG một nhóm', () => {
    for (const status of TIKTOK_ORDER_STATUSES) {
      const groups = Object.values(ORDER_STATUS_GROUPS).filter((list) => (list as readonly string[]).includes(status));
      expect(groups).toHaveLength(1);
    }
  });

  it('ánh xạ theo enum, giá trị lạ ⇒ OTHER', () => {
    expect(orderStatusGroupOf('COMPLETED')).toBe('DELIVERED');
    expect(orderStatusGroupOf('DELIVERED')).toBe('DELIVERED');
    expect(orderStatusGroupOf('IN_TRANSIT')).toBe('SHIPPING');
    expect(orderStatusGroupOf('AWAITING_COLLECTION')).toBe('AWAITING_COLLECTION');
    expect(orderStatusGroupOf('CANCELLED')).toBe('CANCELLED');
    expect(orderStatusGroupOf('SOMETHING_NEW')).toBe('OTHER');
  });
});
