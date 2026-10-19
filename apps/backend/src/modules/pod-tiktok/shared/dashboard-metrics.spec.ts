import {
  DASHBOARD_MAX_RANGE_DAYS,
  localDay,
  percentChange,
  resolveAllTimeRange,
  resolveDayRange,
  sellerCurrentProfit,
  sellerEstProfit,
} from './dashboard-metrics';
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

describe('sellerCurrentProfit — Paid − Basecost − Label − Seller Shipping Fee − Design Amount', () => {
  const input = { paid: '475.19', baseCost: '35.46', label: '2', shippingFee: '12.34', designAmount: '0' };

  it('số liệu bình thường', () => {
    expect(sellerCurrentProfit(input)).toBe('425.39');
  });

  it('Shipping Fee = 0 ⇒ chỉ trừ Basecost + Label', () => {
    expect(sellerCurrentProfit({ ...input, shippingFee: '0' })).toBe('437.73');
  });

  it('lợi nhuận âm giữ nguyên dấu (không chặn về 0)', () => {
    expect(sellerCurrentProfit({ paid: '0', baseCost: '10.5', label: '1', shippingFee: '3.2', designAmount: '0' })).toBe('-14.7');
  });

  it('Label null (khác đơn vị tiền) ⇒ null, không coi là 0', () => {
    expect(sellerCurrentProfit({ ...input, label: null })).toBeNull();
  });

  it('tính bằng Decimal trên tổng chưa làm tròn — không lệch số lẻ dấu phẩy động', () => {
    // 0.3 − 0.1 − 0.1 − 0.1 bằng number là 2.7e-17; Decimal cho đúng 0.
    expect(sellerCurrentProfit({ ...input, paid: '0.3', baseCost: '0.1', label: '0.1', shippingFee: '0.1' })).toBe('0');
    expect(sellerCurrentProfit({ ...input, paid: '100.0004', baseCost: '0', label: '0', shippingFee: '0.0001' })).toBe('100.0003');
  });

  it('Shipping Fee trừ ĐÚNG MỘT lần: tăng Shipping Fee x ⇒ Current Profit giảm đúng x', () => {
    const before = Number(sellerCurrentProfit(input));
    const after = Number(sellerCurrentProfit({ ...input, shippingFee: '22.34' }));
    expect(Math.round((before - after) * 100) / 100).toBe(10);
  });

  it('Design Amount = 0 ⇒ y như công thức cũ (Paid − Basecost − Label − Shipping Fee)', () => {
    expect(sellerCurrentProfit({ ...input, designAmount: '0' })).toBe(
      String(Math.round((475.19 - 35.46 - 2 - 12.34) * 100) / 100),
    );
  });

  it('Design Amount trừ ĐÚNG MỘT lần: 425.39 − 7.5 = 417.89', () => {
    expect(sellerCurrentProfit({ ...input, designAmount: '7.5' })).toBe('417.89');
  });

  it('Shipping Fee vẫn trừ trọn (quy tắc PO giữ nguyên) khi có Design Amount', () => {
    const a = Number(sellerCurrentProfit({ ...input, designAmount: '3' }));
    const b = Number(sellerCurrentProfit({ ...input, designAmount: '3', shippingFee: '22.34' }));
    expect(Math.round((a - b) * 100) / 100).toBe(10);
  });

  it('Design Amount null (khác đơn vị tiền) ⇒ null', () => {
    expect(sellerCurrentProfit({ ...input, designAmount: null })).toBeNull();
  });
});

describe('sellerEstProfit — Est. profit = Revenue − Base cost − Shipping Fee − Label, không trừ hai lần phí ship', () => {
  const input = {
    revenue: '200',
    baseCost: '50',
    label: '1.5',
    shippingFee: '30',
    shippingIncluded: '0',
    designAmount: '0',
  };

  it('phí ship chưa nằm trong Revenue ⇒ trừ trọn: 200 − 50 − 30 − 1.5 = 118.5', () => {
    expect(sellerEstProfit(input)).toBe('118.5');
  });

  it('phí ship đã nằm trọn trong Revenue ⇒ không trừ lại: 200 − 50 − 1.5 = 148.5', () => {
    expect(sellerEstProfit({ ...input, shippingIncluded: '30' })).toBe('148.5');
  });

  it('= Revenue − Base cost − Shipping Fee − Label + phần đã trừ trong Revenue (đúng công thức PO, bù phần trùng)', () => {
    const literal = 200 - 50 - 30 - 1.5;
    expect(Number(sellerEstProfit({ ...input, shippingIncluded: '12' }))).toBe(literal + 12);
  });

  it('tăng phần đã-nằm-trong-Revenue x ⇒ lợi nhuận tăng đúng x (không trừ hai lần)', () => {
    const a = Number(sellerEstProfit({ ...input, shippingIncluded: '5' }));
    const b = Number(sellerEstProfit({ ...input, shippingIncluded: '15' }));
    expect(b - a).toBe(10);
  });

  it('Label null (khác đơn vị tiền) ⇒ null', () => {
    expect(sellerEstProfit({ ...input, label: null })).toBeNull();
  });

  it('Base cost / Shipping Fee bằng 0 vẫn tính, âm vẫn âm', () => {
    expect(sellerEstProfit({ ...input, revenue: '0', baseCost: '0', label: '0', shippingFee: '0', shippingIncluded: '0' })).toBe('0');
    expect(sellerEstProfit({ ...input, revenue: '10' })).toBe('-71.5');
  });

  it('Design Amount = 0 ⇒ y như trước khi có Design Amount', () => {
    expect(sellerEstProfit({ ...input, designAmount: '0' })).toBe('118.5');
  });

  it('Design Amount trừ ĐÚNG MỘT lần: 200 − 50 − 30 − 1.5 − 12.25 = 106.25', () => {
    expect(sellerEstProfit({ ...input, designAmount: '12.25' })).toBe('106.25');
  });

  it('có Design Amount vẫn KHÔNG trừ hai lần phí ship đã nằm trong Revenue: 200 − 50 − 1.5 − 10 = 138.5', () => {
    expect(sellerEstProfit({ ...input, shippingIncluded: '30', designAmount: '10' })).toBe('138.5');
  });

  it('Design Amount null (khác đơn vị tiền đang xem) ⇒ null, không coi là 0', () => {
    expect(sellerEstProfit({ ...input, designAmount: null })).toBeNull();
  });

  it('Decimal — không lệch số lẻ dấu phẩy động', () => {
    expect(sellerEstProfit({ ...input, revenue: '0.3', baseCost: '0.1', label: '0.1', shippingFee: '0.2', shippingIncluded: '0.1' })).toBe('0');
  });
});

describe('resolveAllTimeRange — "Tất cả thời gian" (UTC+7)', () => {
  const NOW = new Date('2026-10-14T05:00:00.000Z'); // 14/10/2026 12:00 giờ VN

  it('từ ngày có dữ liệu sớm nhất đến hôm nay, KHÔNG giới hạn DASHBOARD_MAX_RANGE_DAYS', () => {
    const range = resolveAllTimeRange('2025-01-23', 420, NOW);
    expect(range).toMatchObject({ fromDay: '2025-01-23', toDay: '2026-10-14' });
    expect(range.days).toBeGreaterThan(DASHBOARD_MAX_RANGE_DAYS);
    expect(range.from.toISOString()).toBe('2025-01-22T17:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-14T16:59:59.999Z');
  });

  it('chưa có dữ liệu / ngày sớm nhất ở tương lai / sai định dạng ⇒ chỉ hôm nay', () => {
    for (const earliest of [null, '2026-12-01', 'abc']) {
      expect(resolveAllTimeRange(earliest, 420, NOW)).toMatchObject({ fromDay: '2026-10-14', toDay: '2026-10-14', days: 1 });
    }
  });

  it('hôm nay theo giờ vận hành (01:30 VN ngày 01/10 vẫn là 30/09 UTC)', () => {
    expect(resolveAllTimeRange('2026-09-01', 420, new Date('2026-09-30T18:30:00.000Z')).toDay).toBe('2026-10-01');
  });
});
