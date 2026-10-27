import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { businessDayOf } from '../../../common/time/business-time';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../../auth/decorators/require-permissions.decorator';
import {
  EMPLOYEE_DEFAULT_PERMISSIONS,
  FULFILLMENT_DEFAULT_PERMISSIONS,
} from '../../auth/constants/default-roles';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PodScopeGuard } from '../guards/pod-scope.guard';
import { PodDashboardController } from '../pod-dashboard.controller';
import type {
  DashboardFilter,
  PodDashboardRepository,
} from '../repositories/pod-dashboard.repository';
import { PodDashboardService } from './pod-dashboard.service';
import type { PodAccessScope } from './pod-access-scope.service';

const ORG = 'org-1';
const ADMIN: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };
const SELLER: PodAccessScope = { allShops: false, accountIds: ['acc-1'], shopIds: ['shop-1'] };

function build(overrides: Partial<Record<keyof PodDashboardRepository, jest.Mock>> = {}) {
  const repo = {
    currencies: jest.fn().mockResolvedValue(['USD', 'GBP']),
    holdTotals: jest.fn().mockResolvedValue([
      { currency: 'USD', amount: '12305.25', shopCount: 43 },
      { currency: 'GBP', amount: '10', shopCount: 1 },
    ]),
    holdBySeller: jest
      .fn()
      .mockResolvedValue([
        { sellerId: 's1', sellerName: 'Trang', shopCount: 8, amount: '5419.789' },
      ]),
    shopStatuses: jest.fn().mockResolvedValue([
      { status: 'ACTIVE', count: 46 },
      { status: 'INACTIVE', count: 2 },
      { status: 'DEAUTHORIZED', count: 1 },
    ]),
    periods: jest.fn().mockResolvedValue([
      { orders: 2, estRevenue: '24.13', payout: '0' },
      { orders: 8, estRevenue: '842.93', payout: '0' },
      { orders: 223, estRevenue: '8722.28', payout: '78.03' },
      { orders: 0, estRevenue: '0', payout: '3665.78' },
    ]),
    finance: jest.fn().mockResolvedValue({ paid: '78.03', processing: '6.57' }),
    orderGroups: jest.fn().mockResolvedValue([
      { group: 'DELIVERED', count: 135, amount: '3000' },
      { group: 'SHIPPING', count: 22, amount: '855.56' },
      { group: 'CANCELLED', count: 21, amount: '1078.77' },
    ]),
    sellerStats: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    // Mặc định: chưa shop nào đồng bộ Return/Refund ⇒ giữ "chưa có dữ liệu".
    returnsAvailable: jest.fn().mockResolvedValue(false),
    returnStats: jest.fn().mockResolvedValue({ requests: 0, returnedOrders: 0, refundedOrders: 0, settledRefund: '0' }),
    financeTrend: jest.fn().mockResolvedValue([]),
    orderTrend: jest.fn().mockResolvedValue([]),
    earliestActivityDay: jest.fn().mockResolvedValue('2025-01-23'),
    holdShops: jest.fn().mockResolvedValue({
      items: [
        { shopId: 'shop-1', shopName: 'Shop 1', accountName: 'Acc 1', amount: '12000.004', sellerId: 'e-1', sellerName: 'Trang', sellerEmail: 't@x' },
        { shopId: 'shop-2', shopName: 'Shop 2', accountName: 'Acc 1', amount: '305.246', sellerId: null, sellerName: null, sellerEmail: null },
      ],
      total: 43,
      totalAmount: '12305.25',
    }),
    shopsByStatus: jest.fn().mockResolvedValue({
      items: [{ shopId: 'shop-9', shopName: 'Die shop', accountName: 'Acc 9', region: 'US', sellerId: null, sellerName: null, sellerEmail: null }],
      total: 2,
    }),
    ...overrides,
  };
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  return {
    service: new PodDashboardService(repo as unknown as PodDashboardRepository, config),
    repo,
  };
}

const filterOf = (mock: jest.Mock): DashboardFilter =>
  (mock.mock.calls as DashboardFilter[][])[0][0];

describe('PodDashboardService.overview', () => {
  it('Hold theo đơn vị tiền đang chọn; đơn vị khác tách riêng, KHÔNG cộng dồn / quy đổi', async () => {
    const { service } = build();
    const result = await service.overview(ORG, ADMIN, {});
    expect(result.currency).toBe('USD');
    expect(result.hold).toEqual({
      currency: 'USD',
      amount: 12305.25,
      shopCount: 43,
      otherCurrencies: [{ currency: 'GBP', amount: 10, shopCount: 1 }],
    });
    expect(result.holdBySeller[0]).toMatchObject({
      sellerName: 'Trang',
      shopCount: 8,
      amount: 5419.79,
    });
  });

  it('trạng thái shop: Live / Inactive / Deauthorized tách riêng, không gộp mọi thứ vào "Die"', async () => {
    const { service } = build();
    const { shopStatus } = await service.overview(ORG, ADMIN, {});
    expect(shopStatus).toEqual({ live: 46, inactive: 2, deauthorized: 1, total: 49 });
  });

  it('Hôm nay / Tháng này kèm % so với kỳ trước; kỳ trước = 0 ⇒ null', async () => {
    const { service, repo } = build();
    const { periods } = await service.overview(ORG, ADMIN, {});
    expect(periods.today).toEqual({ orders: 2, estRevenue: 24.13, payout: 0, orderChange: -75 });
    expect(periods.yesterday.orderChange).toBeNull();
    // Tháng trước = 0 đơn ⇒ không chia 0.
    expect(periods.thisMonth.orderChange).toBeNull();
    expect(periods.lastMonth.payout).toBe(3665.78);
    // Bốn kỳ trong MỘT lần gọi repository.
    expect(repo.periods).toHaveBeenCalledTimes(1);
    expect((repo.periods.mock.calls[0] as unknown[])[1]).toHaveLength(4);
  });

  it('Admin ⇒ toàn tổ chức (accountIds = null); Seller ⇒ CHỈ account được gán', async () => {
    const admin = build();
    await admin.service.overview(ORG, ADMIN, {});
    expect(filterOf(admin.repo.holdTotals)).toMatchObject({
      organizationId: ORG,
      accountIds: null,
    });

    const seller = build();
    await seller.service.overview(ORG, SELLER, { sellerId: 'someone-else' });
    // Seller truyền sellerId của người khác vẫn bị giới hạn ở account của chính mình.
    expect(filterOf(seller.repo.holdTotals)).toMatchObject({
      accountIds: ['acc-1'],
      sellerId: 'someone-else',
    });
  });

  it('chưa có dữ liệu nào ⇒ không đoán đơn vị tiền', async () => {
    const { service } = build({
      currencies: jest.fn().mockResolvedValue([]),
      holdTotals: jest.fn().mockResolvedValue([]),
    });
    const result = await service.overview(ORG, ADMIN, {});
    expect(result.currency).toBeNull();
    expect(result.hold.amount).toBe(0);
  });

  it('chọn đơn vị tiền ⇒ mọi truy vấn lọc đúng đơn vị đó', async () => {
    const { service, repo } = build();
    await service.overview(ORG, ADMIN, { currency: 'GBP' });
    expect(filterOf(repo.periods).currency).toBe('GBP');
  });
});

describe('PodDashboardService.summary', () => {
  it('đủ mọi nhóm trạng thái (kể cả 0), tỉ lệ giao thành công = delivered / total', async () => {
    const { service } = build();
    const result = await service.summary(ORG, ADMIN, { from: '2026-09-01', to: '2026-09-30' });
    expect(result.finance).toEqual({ paid: 78.03, processing: 6.57 });
    expect(result.orders.total).toBe(178);
    expect(result.orders.delivered).toBe(135);
    expect(result.orders.deliveredRate).toBe(75.84);
    expect(result.orders.groups.map((g) => g.group)).toEqual([
      'UNPAID',
      'TO_SHIP',
      'AWAITING_COLLECTION',
      'SHIPPING',
      'DELIVERED',
      'CANCELLED',
      'OTHER',
    ]);
    expect(result.orders.groups.find((g) => g.group === 'AWAITING_COLLECTION')).toEqual({
      group: 'AWAITING_COLLECTION',
      count: 0,
      amount: 0,
    });
    expect(result.returnsAvailable).toBe(false);
    expect(result.returns).toBeNull();
  });

  it('đã đồng bộ Return/Refund ⇒ số đơn hoàn + doanh thu bị trừ trong quyết toán (không đụng tới tài chính khác)', async () => {
    const { service } = build({
      returnsAvailable: jest.fn().mockResolvedValue(true),
      returnStats: jest.fn().mockResolvedValue({ requests: 3, returnedOrders: 2, refundedOrders: 1, settledRefund: '11.6' }),
    });
    const result = await service.summary(ORG, ADMIN, {});
    expect(result.returnsAvailable).toBe(true);
    expect(result.returns).toEqual({ requests: 3, returnedOrders: 2, refundedOrders: 1, settledRefund: 11.6 });
    // Paid / Processing giữ nguyên nguồn cũ — refund KHÔNG bị trừ thêm.
    expect(result.finance).toEqual({ paid: 78.03, processing: 6.57 });
  });

  it('không có đơn ⇒ tỉ lệ null (không chia 0)', async () => {
    const { service } = build({ orderGroups: jest.fn().mockResolvedValue([]) });
    const result = await service.summary(ORG, ADMIN, {});
    expect(result.orders.deliveredRate).toBeNull();
  });

  it('khoảng ngày sai ⇒ 400 DASHBOARD_RANGE_INVALID', async () => {
    const { service } = build();
    await expect(
      service.summary(ORG, ADMIN, { from: '2026-09-30', to: '2026-09-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 khoảng ngày sai ⇒ từ chối TRƯỚC mọi truy vấn DB (summary / sellers / trends)', async () => {
    const { service, repo } = build();
    const reversed = { from: '2026-09-30', to: '2026-09-01' };
    await expect(service.summary(ORG, ADMIN, reversed)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sellers(ORG, ADMIN, reversed)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.trends(ORG, ADMIN, reversed)).rejects.toBeInstanceOf(BadRequestException);
    const calls = Object.values(repo as Record<string, jest.Mock>)
      .filter((fn) => typeof fn?.mock === 'object')
      .reduce((sum, fn) => sum + fn.mock.calls.length, 0);
    expect(calls).toBe(0);
  });
});

describe('PodDashboardService.sellers', () => {
  it('chuyển tham số sắp xếp / phân trang xuống DB; Đơn hoàn = null (chưa có dữ liệu)', async () => {
    const row = {
      sellerId: 's1',
      sellerName: 'Trang',
      sellerEmail: 't@x',
      active: true,
      orders: 95,
      revenue: '6650.684',
      revenueOrders: 90,
      baseCost: '35.46',
      baseCostOrders: 3,
      shippingFee: '12.344',
      shippingFeeOrders: 88,
      shippingIncluded: '10',
      fulfilledOrders: 4,
      label: '2',
      designAmount: '0',
      profit: '6610.88',
      profitOrders: 3,
      paid: '475.19',
      processing: '0',
      hold: '5419.79',
    };
    const { service, repo } = build({
      sellerStats: jest.fn().mockResolvedValue({ items: [row], total: 41 }),
    });
    const result = await service.sellers(ORG, ADMIN, {
      from: '2026-08-18',
      to: '2026-09-18',
      activeOnly: true,
      sort: 'hold',
      order: 'asc',
      page: 2,
      limit: 20,
    });
    expect((repo.sellerStats.mock.calls[0] as unknown[])[2]).toMatchObject({
      activeOnly: true,
      sort: 'hold',
      order: 'asc',
      page: 2,
      limit: 20,
    });
    expect(result.items[0]).toMatchObject({
      orders: 95,
      returns: null,
      revenue: 6650.68,
      revenueOrders: 90,
      baseCost: 35.46,
      label: 2,
      fulfilledOrders: 4,
      // 6650.684 − 35.46 − 2 − (12.344 − 10 đã nằm trong Doanh thu) = 6610.88
      profit: 6610.88,
      profitOrders: 3,
      hold: 5419.79,
      shippingFee: 12.34,
      shippingFeeOrders: 88,
      shippingIncluded: 10,
      // 475.19 − 35.46 − 2 − 12.344 = 425.386 ⇒ 425.39
      currentProfit: 425.39,
    });
    // Cột "Doanh thu dự kiến" đã bỏ — API không còn trả field này.
    expect(result.items[0]).not.toHaveProperty('estRevenue');
    // Label truyền từ cấu hình (một nguồn với màn Order), không hard-code trong SQL.
    expect((repo.sellerStats.mock.calls[0] as unknown[])[2]).toMatchObject({ label: { amount: 0.5, currency: 'USD' } });
    expect(result.meta).toEqual({ total: 41, page: 2, limit: 20, totalPages: 3 });
  });

  it('đã đồng bộ Return/Refund ⇒ cột Đơn hoàn là số đơn thật (0 vẫn là 0)', async () => {
    const base = { sellerId: 's1', sellerName: 'A', sellerEmail: 'a@x', active: true, orders: 5, revenue: '0', revenueOrders: 0, baseCost: '0', baseCostOrders: 0, shippingFee: '0', shippingFeeOrders: 0, shippingIncluded: '0', fulfilledOrders: 0, label: '0', designAmount: '0', profit: null, profitOrders: 0, paid: '0', processing: '0', hold: '0' };
    const { service } = build({
      returnsAvailable: jest.fn().mockResolvedValue(true),
      sellerStats: jest.fn().mockResolvedValue({ items: [{ ...base, returns: 2 }, { ...base, sellerId: 's2', returns: 0 }], total: 2 }),
    });
    const result = await service.sellers(ORG, ADMIN, { from: '2026-08-18', to: '2026-09-18', activeOnly: false, sort: 'orders', order: 'desc', page: 1, limit: 20 });
    expect(result.items.map((item) => item.returns)).toEqual([2, 0]);
  });
});

describe('PodDashboardService — Design Amount (Seller Statistics)', () => {
  const base = { sellerId: 's1', sellerName: 'A', sellerEmail: 'a@x', active: true, orders: 4, revenue: '100', revenueOrders: 4, baseCost: '40', baseCostOrders: 4, shippingFee: '6.5', shippingFeeOrders: 4, shippingIncluded: '2.5', fulfilledOrders: 4, label: '2', designAmount: '0', profit: '54', profitOrders: 4, paid: '80', processing: '0', hold: '0', returns: 0 };
  const rowOf = async (over: Record<string, unknown>) => {
    const { service } = build({ sellerStats: jest.fn().mockResolvedValue({ items: [{ ...base, ...over }], total: 1 }) });
    return (await service.sellers(ORG, ADMIN, { from: '2026-10-01', to: '2026-10-05' })).items[0];
  };

  it('Design Amount = 0 ⇒ Est. profit / Current Profit y như trước', async () => {
    // Est: 100 − 40 − 2 − (6.5 − 2.5) = 54 · Current: 80 − 40 − 2 − 6.5 = 31.5
    expect(await rowOf({})).toMatchObject({ designAmount: 0, profit: 54, currentProfit: 31.5 });
  });

  it('Design Amount trừ ĐÚNG MỘT lần ở cả Est. profit và Current Profit', async () => {
    expect(await rowOf({ designAmount: '7.255' })).toMatchObject({
      designAmount: 7.26,
      profit: 46.75, // 54 − 7.255 = 46.745 ⇒ 46.75
      currentProfit: 24.25, // 31.5 − 7.255 = 24.245 ⇒ 24.25
    });
  });

  it('Design Amount null (khác đơn vị tiền đang xem) ⇒ cột + hai lợi nhuận là "—"', async () => {
    expect(await rowOf({ designAmount: null })).toMatchObject({ designAmount: null, profit: null, currentProfit: null });
  });

  it('sort=designAmount được chuyển xuống DB', async () => {
    const { service, repo } = build({ sellerStats: jest.fn().mockResolvedValue({ items: [], total: 0 }) });
    await service.sellers(ORG, ADMIN, { from: '2026-10-01', to: '2026-10-05', sort: 'designAmount' });
    expect((repo.sellerStats.mock.calls[0] as unknown[])[2]).toMatchObject({ sort: 'designAmount' });
  });
});

describe('PodDashboardService — Profit Dự kiến / Label thiếu dữ kiện', () => {
  it('Label khác đơn vị tiền ⇒ Profit Dự kiến null ("—"), không coi Label là 0', async () => {
    const row = { sellerId: 's1', sellerName: 'A', sellerEmail: 'a@x', active: true, orders: 3, revenue: '30', revenueOrders: 2, baseCost: '0', baseCostOrders: 0, shippingFee: '0', shippingFeeOrders: 0, shippingIncluded: '0', fulfilledOrders: 1, label: null, designAmount: '0', profit: null, profitOrders: 0, paid: '0', processing: '0', hold: '0', returns: 0 };
    const { service } = build({ sellerStats: jest.fn().mockResolvedValue({ items: [row], total: 1 }) });
    const result = await service.sellers(ORG, ADMIN, { from: '2026-10-01', to: '2026-10-05' });
    expect(result.items[0]).toMatchObject({ label: null, profit: null, profitOrders: 0, revenueOrders: 2, orders: 3 });
  });
});

describe('PodDashboardService — Shipping Fee / Current Profit', () => {
  const base = { sellerId: 's1', sellerName: 'A', sellerEmail: 'a@x', active: true, orders: 4, revenue: '100', revenueOrders: 4, baseCost: '40', baseCostOrders: 4, shippingFee: '6.5', shippingFeeOrders: 4, shippingIncluded: '2.5', fulfilledOrders: 4, label: '2', designAmount: '0', profit: '54', profitOrders: 4, paid: '80', processing: '0', hold: '0', returns: 0 };
  const sellersOf = async (rows: Array<Record<string, unknown>>) => {
    const { service, repo } = build({ sellerStats: jest.fn().mockResolvedValue({ items: rows, total: rows.length }) });
    return { result: await service.sellers(ORG, ADMIN, { from: '2026-10-01', to: '2026-10-14' }), repo };
  };

  it('Current Profit = Paid − Basecost − Label − Shipping Fee (trừ TRỌN Shipping Fee)', async () => {
    const { result } = await sellersOf([base]);
    // 80 − 40 − 2 − 6.5 = 31.5; Est. profit = 100 − 40 − 2 − (6.5 − 2.5) = 54
    expect(result.items[0]).toMatchObject({ shippingFee: 6.5, shippingFeeOrders: 4, currentProfit: 31.5, profit: 54 });
  });

  it('Shipping Fee = 0 ⇒ Current Profit chỉ trừ Basecost + Label', async () => {
    const { result } = await sellersOf([{ ...base, shippingFee: '0', shippingFeeOrders: 4 }]);
    expect(result.items[0]).toMatchObject({ shippingFee: 0, currentProfit: 38 });
  });

  it('Paid chưa có (0) ⇒ Current Profit âm, không bị chặn về 0', async () => {
    const { result } = await sellersOf([{ ...base, paid: '0' }]);
    expect(result.items[0].currentProfit).toBe(-48.5);
  });

  it('Label khác đơn vị tiền (null) ⇒ Current Profit null ("—"), Shipping Fee vẫn hiện', async () => {
    const { result } = await sellersOf([{ ...base, label: null }]);
    expect(result.items[0]).toMatchObject({ label: null, currentProfit: null, shippingFee: 6.5 });
  });

  it('mỗi seller tính trên tổng CỦA CHÍNH seller đó', async () => {
    const { result } = await sellersOf([base, { ...base, sellerId: 's2', paid: '10', baseCost: '1', label: '0.5', shippingFee: '0.25', shippingIncluded: '0' }]);
    expect(result.items.map((item) => item.currentProfit)).toEqual([31.5, 8.25]);
  });

  it('sắp xếp theo shippingFee / currentProfit truyền nguyên xuống DB (whitelist)', async () => {
    const { service, repo } = build();
    await service.sellers(ORG, ADMIN, { sort: 'currentProfit', order: 'asc' });
    await service.sellers(ORG, ADMIN, { sort: 'shippingFee', order: 'desc' });
    expect((repo.sellerStats.mock.calls[0] as unknown[])[2]).toMatchObject({ sort: 'currentProfit', order: 'asc' });
    expect((repo.sellerStats.mock.calls[1] as unknown[])[2]).toMatchObject({ sort: 'shippingFee', order: 'desc' });
  });
});

describe('PodDashboardService — Est. profit = Revenue − Base cost − Shipping Fee − Label (2026-10-14)', () => {
  const base = { sellerId: 's1', sellerName: 'A', sellerEmail: 'a@x', active: true, orders: 10, revenue: '500', revenueOrders: 10, baseCost: '120', baseCostOrders: 6, shippingFee: '40', shippingFeeOrders: 10, shippingIncluded: '0', fulfilledOrders: 6, label: '3', designAmount: '0', profit: '0', profitOrders: 6, paid: '0', processing: '0', hold: '0', returns: 0 };
  const profitOf = async (patch: Record<string, unknown>) => {
    const { service } = build({ sellerStats: jest.fn().mockResolvedValue({ items: [{ ...base, ...patch }], total: 1 }) });
    return (await service.sellers(ORG, ADMIN, { from: '2026-10-01', to: '2026-10-14' })).items[0].profit;
  };

  it('Phí ship CHƯA nằm trong Revenue ⇒ trừ trọn Shipping Fee: 500 − 120 − 40 − 3 = 337', async () => {
    expect(await profitOf({})).toBe(337);
  });

  it('Phí ship ĐÃ nằm trọn trong Revenue (đơn đã quyết toán) ⇒ KHÔNG trừ lần hai: 500 − 120 − 3 = 377', async () => {
    expect(await profitOf({ shippingIncluded: '40' })).toBe(377);
  });

  it('Một phần đã nằm trong Revenue ⇒ chỉ trừ phần còn lại: 500 − 120 − (40 − 25) − 3 = 362', async () => {
    expect(await profitOf({ shippingIncluded: '25' })).toBe(362);
  });

  it('Không đơn nào có Base cost xác nhận ⇒ vẫn tính (Basecost = 0 như cột hiển thị), không còn "—"', async () => {
    expect(await profitOf({ baseCost: '0', baseCostOrders: 0, fulfilledOrders: 0, label: '0' })).toBe(460);
  });

  it('Âm vẫn hiển thị âm (không chặn về 0)', async () => {
    expect(await profitOf({ revenue: '10' })).toBe(-153);
  });

  it('Label khác đơn vị tiền ⇒ null ("—")', async () => {
    expect(await profitOf({ label: null })).toBeNull();
  });

  it('Tính bằng Decimal trên tổng chưa làm tròn rồi mới làm tròn 2 số', async () => {
    // 0.3 − 0.1 − (0.105 − 0.1) − 0.1 = 0.095 ⇒ 0.1 (cộng trừ số thực JS sẽ ra 0.0949999…)
    expect(await profitOf({ revenue: '0.3', baseCost: '0.1', shippingFee: '0.105', shippingIncluded: '0.1', label: '0.1' })).toBe(0.1);
  });

  it('Trả shippingIncluded để đối chiếu với cột Shipping Fee', async () => {
    const { service } = build({ sellerStats: jest.fn().mockResolvedValue({ items: [{ ...base, shippingIncluded: '12.345' }], total: 1 }) });
    const row = (await service.sellers(ORG, ADMIN, {})).items[0];
    expect(row).toMatchObject({ shippingFee: 40, shippingIncluded: 12.35 });
  });
});

describe('PodDashboardService — "Tất cả thời gian" (allTime)', () => {
  // Hôm nay theo múi giờ nghiệp vụ mặc định (config mock trả fallback ⇒ America/Los_Angeles).
  const todayLa = () => businessDayOf(new Date(), 'America/Los_Angeles');

  it('bỏ qua from / to, lấy từ ngày có dữ liệu sớm nhất (trong phạm vi) đến hôm nay — không giới hạn 366 ngày', async () => {
    const { service, repo } = build();
    const result = await service.summary(ORG, SELLER, { allTime: true, from: '2026-10-01', to: '2026-10-02' });
    expect(result).toMatchObject({ from: '2025-01-23', to: todayLa() });
    // Phạm vi người xem đi xuống truy vấn ngày sớm nhất (Seller không kéo mốc của shop khác).
    expect(filterOf(repo.earliestActivityDay)).toMatchObject({ organizationId: ORG, accountIds: ['acc-1'] });
    const window = (repo.finance.mock.calls[0] as unknown[])[1] as { from: Date; before: Date };
    // 00:00 23/01/2025 ở LA (PST, UTC−8).
    expect(window.from.toISOString()).toBe('2025-01-23T08:00:00.000Z');
  });

  it('chưa có dữ liệu ⇒ chỉ hôm nay', async () => {
    const { service } = build({ earliestActivityDay: jest.fn().mockResolvedValue(null) });
    const result = await service.trends(ORG, ADMIN, { allTime: true });
    expect(result).toMatchObject({ from: todayLa(), to: todayLa() });
  });

  it('allTime dùng chung cho Thống kê seller và Xu hướng', async () => {
    const { service, repo } = build();
    await service.sellers(ORG, ADMIN, { allTime: true });
    await service.trends(ORG, ADMIN, { allTime: true });
    const sellerWindow = (repo.sellerStats.mock.calls[0] as unknown[])[1] as { from: Date };
    expect(sellerWindow.from.toISOString()).toBe('2025-01-23T08:00:00.000Z');
    expect((repo.financeTrend.mock.calls[0] as unknown[])[2]).toMatchObject({ fromDay: '2025-01-23', toDay: todayLa() });
  });

  it('không có allTime ⇒ giữ nguyên from / to và giới hạn 366 ngày như cũ', async () => {
    const { service, repo } = build();
    await expect(service.summary(ORG, ADMIN, { from: '2024-01-01', to: '2026-01-01' })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.earliestActivityDay).not.toHaveBeenCalled();
  });
});

describe('PodDashboardService — popup thẻ tổng quan', () => {
  it('Seller Employee đi kèm từng shop ở cả hai popup; chưa gán ⇒ null', async () => {
    const { service } = build();
    const hold = await service.holdShops(ORG, ADMIN, {});
    expect(hold.items.map((item) => [item.sellerId, item.sellerName])).toEqual([['e-1', 'Trang'], [null, null]]);
    const die = await service.shopsByStatus(ORG, ADMIN, { status: 'INACTIVE' });
    expect(die.items[0]).toMatchObject({ sellerId: null, sellerName: null, sellerEmail: null });
  });

  it('Hold theo shop: cùng đơn vị tiền với thẻ; meta.total = số shop; totalAmount = số trên thẻ', async () => {
    const { service, repo } = build();
    const result = await service.holdShops(ORG, ADMIN, { page: 1, limit: 20 });
    expect(filterOf(repo.holdShops)).toMatchObject({ organizationId: ORG, currency: 'USD', accountIds: null });
    expect((repo.holdShops.mock.calls[0] as unknown[])[1]).toEqual({ page: 1, limit: 20 });
    expect(result).toMatchObject({ currency: 'USD', totalAmount: 12305.25, meta: { total: 43, page: 1, limit: 20, totalPages: 3 } });
    expect(result.items.map((item) => item.amount)).toEqual([12000, 305.25]);
  });

  it('Live / Die: truyền đúng trạng thái thật xuống DB, không tự map lại', async () => {
    const { service, repo } = build();
    const die = await service.shopsByStatus(ORG, ADMIN, { status: 'INACTIVE', page: 2, limit: 10 });
    expect((repo.shopsByStatus.mock.calls[0] as unknown[]).slice(1)).toEqual(['INACTIVE', { page: 2, limit: 10 }]);
    expect(die).toMatchObject({ status: 'INACTIVE', meta: { total: 2, page: 2, limit: 10, totalPages: 1 } });
    await service.shopsByStatus(ORG, ADMIN, { status: 'ACTIVE' });
    expect((repo.shopsByStatus.mock.calls[1] as unknown[]).slice(1)).toEqual(['ACTIVE', { page: 1, limit: 20 }]);
  });

  it('chọn đơn vị tiền khác ⇒ popup Hold lọc theo đơn vị đó (không trộn USD/GBP)', async () => {
    const { service, repo } = build();
    await service.holdShops(ORG, ADMIN, { currency: 'GBP' });
    expect(filterOf(repo.holdShops).currency).toBe('GBP');
  });
});

describe('PodDashboardController — phân quyền (Admin Dashboard + Seller Dashboard)', () => {
  /** Chạy PermissionsGuard THẬT với danh sách quyền của một role. */
  const canOpen = async (permissions: readonly string[]) => {
    const prisma = {
      rolePermission: {
        findMany: jest
          .fn()
          .mockResolvedValue(permissions.map((code) => ({ permission: { code } }))),
      },
    };
    const guard = new PermissionsGuard(new Reflector(), prisma as never);
    const context = {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- chỉ đọc metadata, không gọi
      getHandler: () => PodDashboardController.prototype.overview,
      getClass: () => PodDashboardController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { organizationId: ORG, role: 'ANY', userId: 'u-1' } }),
      }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context).catch((error: unknown) => {
      if (error instanceof ForbiddenException) return false;
      throw error;
    });
  };

  it('report.read (Admin) HOẶC pod.dashboard.read (Seller) + JwtAuthGuard + PermissionsGuard + PodScopeGuard', () => {
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, PodDashboardController)).toEqual([
      'report.read',
      'pod.dashboard.read',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PodDashboardController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, PodDashboardController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
      PodScopeGuard,
    ]);
  });

  it('🔴 Seller (EMPLOYEE mặc định) mở được Dashboard nhưng KHÔNG có report.read (/reports/* là báo cáo cấp tổ chức) và KHÔNG có pod.shop.all', async () => {
    const permissions: readonly string[] = EMPLOYEE_DEFAULT_PERMISSIONS;
    expect(permissions).toContain('pod.dashboard.read');
    expect(permissions).not.toContain('report.read');
    expect(permissions).not.toContain('pod.shop.all');
    expect(await canOpen(EMPLOYEE_DEFAULT_PERMISSIONS)).toBe(true);
  });

  it('Admin (report.read) vẫn mở được; role không có quyền nào trong hai (FULFILLMENT) ⇒ 403', async () => {
    expect(await canOpen(['report.read'])).toBe(true);
    expect(await canOpen(FULFILLMENT_DEFAULT_PERMISSIONS)).toBe(false);
  });
});

describe('Seller Dashboard — phạm vi dữ liệu ở BACKEND', () => {
  const SELLER_A: PodAccessScope = { allShops: false, accountIds: ['acc-a'], shopIds: ['shop-a'] };
  const SELLER_B: PodAccessScope = { allShops: false, accountIds: ['acc-b'], shopIds: ['shop-b'] };
  const RANGE = { from: '2026-10-01', to: '2026-10-05' };

  it.each([
    [
      'overview',
      (s: PodDashboardService, scope: PodAccessScope) => s.overview(ORG, scope, {}),
      'holdTotals',
    ],
    [
      'summary',
      (s: PodDashboardService, scope: PodAccessScope) => s.summary(ORG, scope, RANGE),
      'finance',
    ],
    [
      'sellers',
      (s: PodDashboardService, scope: PodAccessScope) => s.sellers(ORG, scope, RANGE),
      'sellerStats',
    ],
    [
      'trends',
      (s: PodDashboardService, scope: PodAccessScope) => s.trends(ORG, scope, RANGE),
      'financeTrend',
    ],
    [
      'hold-shops (popup Hold)',
      (s: PodDashboardService, scope: PodAccessScope) => s.holdShops(ORG, scope, {}),
      'holdShops',
    ],
    [
      'shops (popup Live / Die)',
      (s: PodDashboardService, scope: PodAccessScope) => s.shopsByStatus(ORG, scope, { status: 'ACTIVE' }),
      'shopsByStatus',
    ],
  ] as const)(
    '%s: Seller A chỉ account của A, Seller B chỉ của B, Admin toàn tổ chức',
    async (_name, call, query) => {
      for (const [scope, expected] of [
        [SELLER_A, ['acc-a']],
        [SELLER_B, ['acc-b']],
        [ADMIN, null],
      ] as const) {
        const { service, repo } = build();
        await call(service, scope);
        expect(filterOf(repo[query])).toMatchObject({ organizationId: ORG, accountIds: expected });
      }
    },
  );

  it('🔴 Seller A gửi sellerId / shopId của Seller B ⇒ vẫn bị giới hạn ở account của A (phép GIAO ở DB)', async () => {
    const { service, repo } = build();
    await service.summary(ORG, SELLER_A, { ...RANGE, sellerId: 'seller-b', shopId: 'shop-b' });
    expect(filterOf(repo.finance)).toMatchObject({
      accountIds: ['acc-a'],
      sellerId: 'seller-b',
      shopId: 'shop-b',
    });
  });

  it('🔴 popup: Seller A sửa shopId / sellerId sang của B ⇒ vẫn giới hạn ở account của A', async () => {
    const { service, repo } = build();
    await service.shopsByStatus(ORG, SELLER_A, { status: 'INACTIVE', shopId: 'shop-b', sellerId: 'seller-b' });
    await service.holdShops(ORG, SELLER_A, { shopId: 'shop-b' });
    expect(filterOf(repo.shopsByStatus)).toMatchObject({ accountIds: ['acc-a'], shopId: 'shop-b', sellerId: 'seller-b' });
    expect(filterOf(repo.holdShops)).toMatchObject({ accountIds: ['acc-a'], shopId: 'shop-b' });
  });

  it('🔴 Seller chưa được gán account nào ⇒ accountIds RỖNG (trả 0), không phải "toàn tổ chức"', async () => {
    const { service, repo } = build();
    await service.overview(ORG, { allShops: false, accountIds: [], shopIds: [] }, {});
    expect(filterOf(repo.holdTotals).accountIds).toEqual([]);
  });

  it('bộ lọc shop / seller chỉ liệt kê trong phạm vi người xem', async () => {
    const filterOptions = jest.fn().mockResolvedValue({ shops: [], sellers: [] });
    const { service } = build({ filterOptions });
    await service.filterOptions(ORG, SELLER_A);
    expect(filterOptions).toHaveBeenCalledWith(ORG, ['acc-a']);
  });
});
