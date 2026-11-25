import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { POD_ORDER_SYNC_SELECTED_MAX, SyncSelectedPodOrdersDto } from '../dto/pod-order-query.dto';
import { OrderSyncHookRegistry } from '../../../common/hooks/order-sync-hook.registry';
import { PodOrderRepository } from '../repositories/pod-order.repository';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodAccessScope, PodAccessScopeService } from './pod-access-scope.service';
import { PodOrderService } from './pod-order.service';
import { PodOrderSyncService, SelectedOrderRef } from './pod-order-sync.service';

/**
 * `PodOrderService.syncSelected` — tầng bảo mật + điều phối của "Sync Orders".
 * Khoá: không tin ID từ client (tổ chức / phạm vi shop), gộp trùng, thành công một phần, trần song song.
 */
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALL: PodAccessScope = { allShops: true, accountIds: [], shopIds: [] };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('SyncSelectedPodOrdersDto — chặn ở cổng API', () => {
  const check = (orderIds: unknown) =>
    validate(plainToInstance(SyncSelectedPodOrdersDto, { orderIds }));

  it('rỗng / thiếu ⇒ lỗi', async () => {
    expect(await check([])).not.toHaveLength(0);
    expect(await check(undefined)).not.toHaveLength(0);
  });

  it(`quá ${POD_ORDER_SYNC_SELECTED_MAX} đơn ⇒ lỗi; đúng ${POD_ORDER_SYNC_SELECTED_MAX} ⇒ hợp lệ`, async () => {
    const ids = Array.from({ length: POD_ORDER_SYNC_SELECTED_MAX + 1 }, (_, i) => uuid(i));
    expect(await check(ids)).not.toHaveLength(0);
    expect(await check(ids.slice(0, POD_ORDER_SYNC_SELECTED_MAX))).toHaveLength(0);
  });

  it('ID không phải UUID ⇒ lỗi', async () => {
    expect(await check([uuid(1), 'not-a-uuid'])).not.toHaveLength(0);
  });
});

describe('PodOrderService.syncSelected', () => {
  let service: PodOrderService;
  let repo: { findSyncRefsByIds: jest.Mock };
  let accountRepo: { findShopForSync: jest.Mock };
  let syncService: { syncSelectedOrders: jest.Mock };
  let syncHooks: { notifyOrdersSynced: jest.Mock };

  beforeEach(() => {
    repo = { findSyncRefsByIds: jest.fn().mockResolvedValue([]) };
    accountRepo = {
      findShopForSync: jest.fn((_org: string, shopId: string) => Promise.resolve({ id: shopId })),
    };
    syncService = {
      syncSelectedOrders: jest.fn((_shop: unknown, refs: SelectedOrderRef[]) =>
        Promise.resolve({
          results: refs.map((ref) => ({ ...ref, status: 'SYNCED' })),
          created: 0,
          updated: refs.length,
          skipped: 0,
        }),
      ),
    };
    syncHooks = { notifyOrdersSynced: jest.fn().mockResolvedValue(undefined) };

    // Chỉ các phụ thuộc mà `syncSelected` dùng là mock thật; còn lại không được chạm tới.
    const unused = {} as never;
    service = new PodOrderService(
      { get: jest.fn((_key: string, fallback?: unknown) => fallback) } as unknown as ConfigService,
      repo as unknown as PodOrderRepository,
      unused,
      unused,
      accountRepo as unknown as PodTiktokAccountRepository,
      unused,
      syncService as unknown as PodOrderSyncService,
      unused,
      unused,
      unused,
      new PodAccessScopeService(unused),
      unused,
      syncHooks as unknown as OrderSyncHookRegistry,
    );
  });

  it('🔴 chỉ đọc đơn theo organizationId của người gọi — ID tổ chức khác ⇒ ORDER_NOT_FOUND, không đồng bộ', async () => {
    // DB chỉ trả đơn của tổ chức A; uuid(2) thuộc tổ chức B nên không có trong kết quả.
    repo.findSyncRefsByIds.mockResolvedValueOnce([
      { id: uuid(1), tiktokOrderId: 'T1', shopId: 'shop-1' },
    ]);

    const result = await service.syncSelected(ORG_A, { orderIds: [uuid(1), uuid(2)] }, ALL);

    expect(repo.findSyncRefsByIds).toHaveBeenCalledWith(ORG_A, [uuid(1), uuid(2)]);
    expect(accountRepo.findShopForSync).toHaveBeenCalledWith(ORG_A, 'shop-1');
    const synced = syncService.syncSelectedOrders.mock.calls.flatMap(
      (call: [unknown, SelectedOrderRef[]]) => call[1].map((ref) => ref.id),
    );
    expect(synced).toEqual([uuid(1)]);
    expect(result.results).toEqual([
      { orderId: uuid(1), tiktokOrderId: 'T1', status: 'SYNCED' },
      expect.objectContaining({
        orderId: uuid(2),
        tiktokOrderId: null,
        status: 'FAILED',
        errorCode: 'ORDER_NOT_FOUND',
      }),
    ]);
    expect(result).toEqual(expect.objectContaining({ total: 2, succeeded: 1, failed: 1 }));
  });

  it('🔴 Seller: đơn của shop NGOÀI phạm vi ⇒ ORDER_NOT_FOUND, không đồng bộ', async () => {
    const seller: PodAccessScope = { allShops: false, accountIds: [], shopIds: ['shop-mine'] };
    repo.findSyncRefsByIds.mockResolvedValueOnce([
      { id: uuid(1), tiktokOrderId: 'T1', shopId: 'shop-mine' },
      { id: uuid(2), tiktokOrderId: 'T2', shopId: 'shop-other' },
    ]);

    const result = await service.syncSelected(ORG_A, { orderIds: [uuid(1), uuid(2)] }, seller);

    expect(accountRepo.findShopForSync).toHaveBeenCalledTimes(1);
    expect(accountRepo.findShopForSync).toHaveBeenCalledWith(ORG_A, 'shop-mine');
    expect(result.results[1]).toEqual(
      expect.objectContaining({ orderId: uuid(2), status: 'FAILED', errorCode: 'ORDER_NOT_FOUND' }),
    );
  });

  it('gộp ID trùng — mỗi đơn đồng bộ đúng một lần', async () => {
    repo.findSyncRefsByIds.mockResolvedValueOnce([
      { id: uuid(1), tiktokOrderId: 'T1', shopId: 's' },
    ]);

    const result = await service.syncSelected(
      ORG_A,
      { orderIds: [uuid(1), uuid(1), uuid(1)] },
      ALL,
    );

    expect(repo.findSyncRefsByIds).toHaveBeenCalledWith(ORG_A, [uuid(1)]);
    expect(result.total).toBe(1);
    expect(syncService.syncSelectedOrders).toHaveBeenCalledTimes(1);
  });

  it('nhóm theo shop: mỗi shop MỘT lần gọi, giữ thứ tự kết quả theo thứ tự người dùng gửi', async () => {
    repo.findSyncRefsByIds.mockResolvedValueOnce([
      { id: uuid(3), tiktokOrderId: 'T3', shopId: 'shop-b' },
      { id: uuid(1), tiktokOrderId: 'T1', shopId: 'shop-a' },
      { id: uuid(2), tiktokOrderId: 'T2', shopId: 'shop-a' },
    ]);

    const result = await service.syncSelected(
      ORG_A,
      { orderIds: [uuid(1), uuid(2), uuid(3)] },
      ALL,
    );

    expect(syncService.syncSelectedOrders).toHaveBeenCalledTimes(2);
    expect(result.results.map((r) => r.orderId)).toEqual([uuid(1), uuid(2), uuid(3)]);
  });

  it('🔴 song song có TRẦN theo tiktok.sync.maxConcurrency — không bung một lần mọi shop', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: uuid(i),
      tiktokOrderId: `T${i}`,
      shopId: `shop-${i}`,
    }));
    repo.findSyncRefsByIds.mockResolvedValueOnce(rows);
    let inFlight = 0;
    let maxInFlight = 0;
    syncService.syncSelectedOrders.mockImplementation(
      async (_shop: unknown, refs: SelectedOrderRef[]) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return {
          results: refs.map((ref) => ({ ...ref, status: 'SYNCED' })),
          created: 0,
          updated: 0,
          skipped: 1,
        };
      },
    );

    const result = await service.syncSelected(ORG_A, { orderIds: rows.map((row) => row.id) }, ALL);

    expect(maxInFlight).toBe(4);
    expect(result.succeeded).toBe(10);
    expect(result.unchanged).toBe(10);
  });

  it('thành công một phần: một shop đã gỡ kết nối ⇒ SHOP_UNAVAILABLE, shop khác vẫn đồng bộ', async () => {
    repo.findSyncRefsByIds.mockResolvedValueOnce([
      { id: uuid(1), tiktokOrderId: 'T1', shopId: 'gone' },
      { id: uuid(2), tiktokOrderId: 'T2', shopId: 'ok' },
    ]);
    accountRepo.findShopForSync.mockImplementation((_org: string, shopId: string) =>
      Promise.resolve(shopId === 'gone' ? null : { id: shopId }),
    );

    const result = await service.syncSelected(ORG_A, { orderIds: [uuid(1), uuid(2)] }, ALL);

    expect(result.results[0]).toEqual(
      expect.objectContaining({ status: 'FAILED', errorCode: 'SHOP_UNAVAILABLE' }),
    );
    expect(result.results[1]).toEqual(expect.objectContaining({ status: 'SYNCED' }));
    expect(result).toEqual(expect.objectContaining({ succeeded: 1, failed: 1, updated: 1 }));
  });

  it('🔴 hết hạn chót của request ⇒ shop CHƯA bắt đầu trả DEADLINE_EXCEEDED, không gọi TikTok', async () => {
    repo.findSyncRefsByIds.mockResolvedValueOnce([
      { id: uuid(1), tiktokOrderId: 'T1', shopId: 'a' },
      { id: uuid(2), tiktokOrderId: 'T2', shopId: 'b' },
    ]);
    const realNow = Date.now;
    let calls = 0;
    // Lần đọc đầu = lúc bắt đầu request; mọi lần sau đã quá hạn chót.
    jest
      .spyOn(Date, 'now')
      .mockImplementation(() => (calls++ === 0 ? realNow() : realNow() + 10 * 60_000));

    try {
      const result = await service.syncSelected(ORG_A, { orderIds: [uuid(1), uuid(2)] }, ALL);
      expect(syncService.syncSelectedOrders).not.toHaveBeenCalled();
      expect(result.results.map((r) => r.errorCode)).toEqual([
        'DEADLINE_EXCEEDED',
        'DEADLINE_EXCEEDED',
      ]);
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('báo hook sau đồng bộ đúng MỘT lần cho cả tổ chức khi có đơn đổi; không đổi gì ⇒ không báo', async () => {
    repo.findSyncRefsByIds.mockResolvedValueOnce([
      { id: uuid(1), tiktokOrderId: 'T1', shopId: 'a' },
      { id: uuid(2), tiktokOrderId: 'T2', shopId: 'b' },
    ]);
    await service.syncSelected(ORG_A, { orderIds: [uuid(1), uuid(2)] }, ALL);
    expect(syncHooks.notifyOrdersSynced).toHaveBeenCalledTimes(1);
    expect(syncHooks.notifyOrdersSynced).toHaveBeenCalledWith({ organizationId: ORG_A });

    syncHooks.notifyOrdersSynced.mockClear();
    repo.findSyncRefsByIds.mockResolvedValueOnce([]);
    await service.syncSelected(ORG_A, { orderIds: [uuid(9)] }, ALL);
    expect(syncHooks.notifyOrdersSynced).not.toHaveBeenCalled();
  });
});
