import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from '../../auth/decorators/require-permissions.decorator';
import { EMPLOYEE_DEFAULT_PERMISSIONS } from '../../auth/constants/default-roles';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PodEmployeeWorkController } from '../pod-employee-work.controller';
import type {
  EmployeeWorkPairRow,
  EmployeeWorkUserRow,
} from '../repositories/pod-employee-work.repository';
import { PodEmployeeWorkService } from './pod-employee-work.service';

const ORG = '11111111-1111-4111-8111-111111111111';

const user = (userId: string, name: string, extra: Partial<EmployeeWorkUserRow> = {}): EmployeeWorkUserRow => ({
  userId,
  name,
  email: `${name.toLowerCase()}@example.test`,
  isEmployee: true,
  active: true,
  ...extra,
});

const pair = (userId: string, shopId: string, extra: Partial<EmployeeWorkPairRow> = {}): EmployeeWorkPairRow => ({
  userId,
  shopId,
  shopName: `Shop ${shopId}`,
  accountName: `Account ${shopId}`,
  listings: 0,
  assigned: false,
  orders: 0,
  profitOrders: 0,
  profit: null,
  ...extra,
});

function setup(pairs: EmployeeWorkPairRow[], users: EmployeeWorkUserRow[]) {
  const repo = {
    pairs: jest.fn().mockResolvedValue(pairs),
    users: jest.fn().mockResolvedValue(users),
    listingActorIds: jest.fn().mockResolvedValue([]),
    shops: jest.fn().mockResolvedValue([]),
  };
  const dashboard = { currencies: jest.fn().mockResolvedValue(['USD', 'GBP']) };
  const config = { get: jest.fn((_key: string, fallback: number) => fallback) };
  const service = new PodEmployeeWorkService(repo as never, dashboard as never, config as unknown as ConfigService);
  return { service, repo, dashboard };
}

describe('PodEmployeeWorkService', () => {
  // Shop S1: A phụ trách, B listing 3 ⇒ S1 hiện dưới CẢ HAI người. S2: A listing 2.
  const pairs = [
    pair('A', 'S1', { assigned: true, orders: 4, profitOrders: 2, profit: '10.005' }),
    pair('B', 'S1', { listings: 3, orders: 4, profitOrders: 2, profit: '10.005' }),
    pair('A', 'S2', { listings: 2, orders: 1, profitOrders: 0, profit: null }),
  ];
  const users = [user('A', 'An'), user('B', 'Bình'), user('C', 'Chi'), user('D', 'Dũng', { active: false })];

  it('tóm tắt: đơn / lợi nhuận cộng theo SHOP DUY NHẤT (S1 có hai người nhưng chỉ tính một lần)', async () => {
    const { service } = setup(pairs, users);
    const result = await service.page(ORG, { from: '2026-10-06', to: '2026-10-06' });

    expect(result.summary).toEqual({
      activeEmployees: 2,
      accountsListed: 2,
      productsListed: 5,
      orders: 5,
      profitOrders: 2,
      profit: 10.01,
      profitPerOrder: 5,
    });
  });

  it('dòng nhân viên = tổng các shop của họ; đơn chưa tính được lợi nhuận KHÔNG coi là 0', async () => {
    const { service } = setup(pairs, users);
    const result = await service.page(ORG, { from: '2026-10-06' });
    const rowA = result.items.find((row) => row.userId === 'A');

    expect(rowA).toMatchObject({ accounts: 2, listings: 2, orders: 5, profitOrders: 2, profit: 10.01, profitPerOrder: 5 });
    expect(rowA?.accountDetails.find((detail) => detail.shopId === 'S2')?.profit).toBeNull();
  });

  it('nhân viên đang hoạt động không làm gì vẫn hiện (0); nhân viên ngừng hoạt động không có số liệu thì ẩn', async () => {
    const { service } = setup(pairs, users);
    const result = await service.page(ORG, {});
    const ids = result.items.map((row) => row.userId);

    expect(ids).toContain('C');
    expect(result.items.find((row) => row.userId === 'C')).toMatchObject({ listings: 0, accounts: 0, profit: null });
    expect(ids).not.toContain('D');
  });

  it('mặc định sắp xếp listing giảm dần; hoà thì theo tên', async () => {
    const { service } = setup(pairs, users);
    const result = await service.page(ORG, {});
    expect(result.items.map((row) => row.userId)).toEqual(['B', 'A', 'C']);
  });

  it('sắp xếp theo lợi nhuận (null xếp cuối khi giảm dần) và theo tên A→Z', async () => {
    const { service } = setup(pairs, users);
    const byProfit = await service.page(ORG, { sort: 'profit' });
    expect(byProfit.items.map((row) => row.userId)).toEqual(['A', 'B', 'C']);
    const byName = await service.page(ORG, { sort: 'name' });
    expect(byName.items.map((row) => row.name)).toEqual(['An', 'Bình', 'Chi']);
  });

  it('lọc theo người ⇒ chỉ người đó, tóm tắt chỉ theo shop của người đó', async () => {
    const { service } = setup(pairs, users);
    const result = await service.page(ORG, { userId: 'B' });
    expect(result.items.map((row) => row.userId)).toEqual(['B']);
    expect(result.summary).toMatchObject({ productsListed: 3, accountsListed: 1, orders: 4 });
  });

  it('lọc theo shop ⇒ chỉ người có liên quan tới shop (không kèm nhân viên 0)', async () => {
    const { service, repo } = setup(pairs.filter((row) => row.shopId === 'S1'), users);
    const result = await service.page(ORG, { shopId: 'S1' });
    expect(repo.pairs).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, shopId: 'S1' }));
    expect(result.items.map((row) => row.userId).sort()).toEqual(['A', 'B']);
  });

  it('đơn vị tiền mặc định = đơn vị phổ biến nhất (như Dashboard); tổ chức luôn là tham số truyền vào', async () => {
    const { service, repo } = setup(pairs, users);
    const result = await service.page(ORG, {});
    expect(result.currency).toBe('USD');
    expect(repo.pairs).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG, currency: 'USD' }));
    expect(repo.users).toHaveBeenCalledWith(ORG, expect.any(Array));
  });

  it('khoảng ngày theo giờ vận hành: 06/10 (+07) = 05/10 17:00Z → 06/10 16:59:59.999Z', async () => {
    const { service, repo } = setup([], users);
    await service.page(ORG, { from: '2026-10-06', to: '2026-10-06' });
    const filter = (repo.pairs.mock.calls[0] as [{ from: Date; to: Date }])[0];
    expect(filter.from.toISOString()).toBe('2026-10-05T17:00:00.000Z');
    expect(filter.to.toISOString()).toBe('2026-10-06T16:59:59.999Z');
  });

  it('khoảng ngày ngược ⇒ 400 EMPLOYEE_WORK_RANGE_INVALID', async () => {
    const { service } = setup(pairs, users);
    await expect(service.page(ORG, { from: '2026-10-07', to: '2026-10-06' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('phân trang trên danh sách đã sắp xếp', async () => {
    const { service } = setup(pairs, users);
    const result = await service.page(ORG, { page: 2, limit: 2 });
    expect(result.items.map((row) => row.userId)).toEqual(['C']);
    expect(result.meta).toEqual({ total: 3, page: 2, limit: 2, totalPages: 2 });
  });

  it('xuất Excel: có file .xlsx theo khoảng ngày', async () => {
    const { service } = setup(pairs, users);
    const file = await service.export(ORG, { from: '2026-10-01', to: '2026-10-06' });
    expect(file.filename).toBe('employee-work-2026-10-01_2026-10-06.xlsx');
    expect(file.buffer.length).toBeGreaterThan(0);
  });
});

describe('PodEmployeeWorkController — phân quyền (chỉ Admin)', () => {
  const canOpen = async (permissions: readonly string[]) => {
    const prisma = {
      rolePermission: {
        findMany: jest.fn().mockResolvedValue(permissions.map((code) => ({ permission: { code } }))),
      },
    };
    const guard = new PermissionsGuard(new Reflector(), prisma as never);
    const context = {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- chỉ đọc metadata, không gọi
      getHandler: () => PodEmployeeWorkController.prototype.page,
      getClass: () => PodEmployeeWorkController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { organizationId: ORG, role: 'ANY', userId: 'u-1' } }),
      }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context).catch((error: unknown) => {
      if (error instanceof ForbiddenException) return false;
      throw error;
    });
  };

  it('report.read VÀ pod.shop.all + JwtAuthGuard + PermissionsGuard', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PodEmployeeWorkController)).toEqual(['report.read', 'pod.shop.all']);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, PodEmployeeWorkController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, PodEmployeeWorkController)).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('Admin (có cả hai) mở được; Seller (EMPLOYEE mặc định) bị 403', async () => {
    await expect(canOpen(['report.read', 'pod.shop.all'])).resolves.toBe(true);
    await expect(canOpen(EMPLOYEE_DEFAULT_PERMISSIONS)).resolves.toBe(false);
  });

  it('chỉ một trong hai quyền ⇒ 403 (không lộ số liệu toàn tổ chức cho người chỉ xem báo cáo)', async () => {
    await expect(canOpen(['report.read'])).resolves.toBe(false);
    await expect(canOpen(['pod.shop.all'])).resolves.toBe(false);
  });
});
