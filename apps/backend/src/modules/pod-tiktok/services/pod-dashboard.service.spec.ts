import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PodScopeGuard } from '../guards/pod-scope.guard';
import { PodDashboardController } from '../pod-dashboard.controller';
import type { DashboardFilter, PodDashboardRepository } from '../repositories/pod-dashboard.repository';
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
    holdBySeller: jest.fn().mockResolvedValue([{ sellerId: 's1', sellerName: 'Trang', shopCount: 8, amount: '5419.789' }]),
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
    financeTrend: jest.fn().mockResolvedValue([]),
    orderTrend: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  return { service: new PodDashboardService(repo as unknown as PodDashboardRepository, config), repo };
}

const filterOf = (mock: jest.Mock): DashboardFilter => (mock.mock.calls as DashboardFilter[][])[0][0];

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
    expect(result.holdBySeller[0]).toMatchObject({ sellerName: 'Trang', shopCount: 8, amount: 5419.79 });
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
    expect(filterOf(admin.repo.holdTotals)).toMatchObject({ organizationId: ORG, accountIds: null });

    const seller = build();
    await seller.service.overview(ORG, SELLER, { sellerId: 'someone-else' });
    // Seller truyền sellerId của người khác vẫn bị giới hạn ở account của chính mình.
    expect(filterOf(seller.repo.holdTotals)).toMatchObject({ accountIds: ['acc-1'], sellerId: 'someone-else' });
  });

  it('chưa có dữ liệu nào ⇒ không đoán đơn vị tiền', async () => {
    const { service } = build({ currencies: jest.fn().mockResolvedValue([]), holdTotals: jest.fn().mockResolvedValue([]) });
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
  });

  it('không có đơn ⇒ tỉ lệ null (không chia 0)', async () => {
    const { service } = build({ orderGroups: jest.fn().mockResolvedValue([]) });
    const result = await service.summary(ORG, ADMIN, {});
    expect(result.orders.deliveredRate).toBeNull();
  });

  it('khoảng ngày sai ⇒ 400 DASHBOARD_RANGE_INVALID', async () => {
    const { service } = build();
    await expect(service.summary(ORG, ADMIN, { from: '2026-09-30', to: '2026-09-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
      estRevenue: '6650.68',
      revenue: '6564.44',
      baseCost: '35.46',
      profit: '6615.22',
      paid: '475.19',
      processing: '0',
      hold: '5419.79',
    };
    const { service, repo } = build({ sellerStats: jest.fn().mockResolvedValue({ items: [row], total: 41 }) });
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
    expect(result.items[0]).toMatchObject({ orders: 95, returns: null, profit: 6615.22, hold: 5419.79 });
    expect(result.meta).toEqual({ total: 41, page: 2, limit: 20, totalPages: 3 });
  });
});

describe('PodDashboardController — phân quyền', () => {
  it('giữ quyền Dashboard hiện tại (report.read) + JwtAuthGuard + PermissionsGuard + PodScopeGuard', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PodDashboardController)).toEqual(['report.read']);
    expect(Reflect.getMetadata(GUARDS_METADATA, PodDashboardController)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
      PodScopeGuard,
    ]);
  });
});
