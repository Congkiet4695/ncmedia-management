import { PodSyncStatus, PodSyncTrigger, Prisma } from '@prisma/client';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import type { TiktokReturnOrder } from '../../tiktok-sdk/types/tiktok-return-refund.types';
import { PodReturnSyncJob } from '../schedulers/pod-return-sync.job';
import configuration from '../../../config/configuration';
import { hasReturnScope, PodReturnSyncService, type ReturnSyncShop } from './pod-return-sync.service';

/**
 * PodReturnSyncService với TikTok giả + repository GIẢ LẬP TRONG BỘ NHỚ (giữ đúng khoá UNIQUE
 * organization_id + tiktok_return_id) — để chứng minh chạy lại không sinh trùng, không gửi trùng.
 */

const NOW_SEC = 1_760_100_000;

function ret(id: string, over: Partial<TiktokReturnOrder> = {}): TiktokReturnOrder {
  return {
    returnId: id,
    orderId: `order-${id}`,
    returnType: 'REFUND',
    returnStatus: 'RETURN_OR_REFUND_REQUEST_PENDING',
    returnReasonText: 'Damaged item',
    createTime: NOW_SEC - 100,
    updateTime: NOW_SEC - 50,
    refundAmount: { currency: 'USD', refundTotal: '10.00' },
    returnLineItems: [{ returnLineItemId: `${id}-l1`, orderLineItemId: `${id}-ol1`, productName: 'Tee', skuId: 's1' }],
    ...over,
  };
}

function shop(over: Partial<ReturnSyncShop> = {}): ReturnSyncShop {
  return {
    id: 'shop-1',
    organizationId: 'org-1',
    accountId: 'acc-1',
    name: 'Shop 1',
    lastReturnSyncCursor: BigInt(NOW_SEC - 3600),
    ...over,
  };
}

function build(
  options: {
    pages?: TiktokReturnOrder[][];
    notifyEnabled?: boolean | Error;
    shops?: ReturnSyncShop[];
    /** `granted_scopes` của kết nối (mặc định: chưa biết ⇒ null). */
    grantedScopes?: string[] | null;
  } = {},
) {
  const store = new Map<string, { id: string; organizationId: string; shopId: string; payloadHash: string; tiktokUpdateTime: bigint; orderId: string | null; data: Record<string, unknown> }>();
  const events: Array<{ entityId: string; eventType: string; payload: Record<string, unknown> }> = [];
  let seq = 0;

  const repo = {
    findSnapshots: jest.fn((organizationId: string, ids: string[]) => {
      const map = new Map<string, unknown>();
      for (const id of ids) {
        const row = store.get(`${organizationId}:${id}`);
        if (row) map.set(id, row);
      }
      return Promise.resolve(map);
    }),
    findOrderIds: jest.fn(() => Promise.resolve(new Map<string, string>([['order-r1', 'pod-order-1']]))),
    findLinePrices: jest.fn(() =>
      Promise.resolve(new Map<string, Prisma.Decimal>([['r1-ol1', new Prisma.Decimal('12.50')]])),
    ),
    createRequest: jest.fn((_tx: unknown, data: Record<string, unknown>) => {
      const key = `${String(data.organizationId)}:${String(data.tiktokReturnId)}`;
      if (store.has(key)) {
        return Promise.reject(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));
      }
      const id = `req-${++seq}`;
      store.set(key, {
        id,
        organizationId: data.organizationId as string,
        shopId: data.shopId as string,
        payloadHash: data.payloadHash as string,
        tiktokUpdateTime: data.tiktokUpdateTime as bigint,
        orderId: (data.orderId as string | null) ?? null,
        data,
      });
      return Promise.resolve({ id });
    }),
    updateRequest: jest.fn((_tx: unknown, id: string, data: Record<string, unknown>) => {
      for (const row of store.values()) {
        if (row.id === id) {
          Object.assign(row, { payloadHash: data.payloadHash, orderId: data.orderId ?? null, data: { ...row.data, ...data } });
        }
      }
      return Promise.resolve();
    }),
    replaceItems: jest.fn(() => Promise.resolve()),
    touchSynced: jest.fn(() => Promise.resolve()),
    findNotificationParty: jest.fn(() =>
      Promise.resolve({ sellerName: 'Seller A', accountName: 'Acc', shopName: 'Shop 1' }),
    ),
  };

  const pages = options.pages ?? [[ret('r1')]];
  const api = {
    searchReturns: jest.fn((_ctx: unknown, params: { pageToken?: string }) => {
      const index = params.pageToken ? Number(params.pageToken) : 0;
      return Promise.resolve({
        data: { items: pages[index] ?? [], nextPageToken: index + 1 < pages.length ? String(index + 1) : undefined },
        requestId: `rq-${index}`,
      });
    }),
  };
  const notifications = {
    isEnabled: jest.fn(() =>
      options.notifyEnabled instanceof Error
        ? Promise.reject(options.notifyEnabled)
        : Promise.resolve(options.notifyEnabled ?? true),
    ),
    enqueueInTransaction: jest.fn((_tx: unknown, list: typeof events) => {
      let created = 0;
      for (const event of list) {
        // Khoá idempotency của outbox: (org, eventType, entityType, entityId, channel).
        if (!events.some((e) => e.entityId === event.entityId && e.eventType === event.eventType)) {
          events.push(event);
          created += 1;
        }
      }
      return Promise.resolve(created);
    }),
    kick: jest.fn(),
  };
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    podTiktokShop: {
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      // Như Prisma: shop kèm `account.grantedScopes` (select lồng).
      findMany: jest.fn(() =>
        Promise.resolve(
          (options.shops ?? [shop()]).map((row) => ({ ...row, account: { grantedScopes: options.grantedScopes ?? null } })),
        ),
      ),
    },
  };
  const shopContext = {
    resolve: jest.fn((_org: string, shopId: string) =>
      Promise.resolve({ accessToken: 'tok', shopCipher: 'cipher', shopId }),
    ),
  };
  const syncStatus = {
    start: jest.fn(() => Promise.resolve({ runId: 'run' })),
    finish: jest.fn(() => Promise.resolve(true)),
    failStaleRuns: jest.fn(() => Promise.resolve(0)),
  };
  const locks = {
    acquire: jest.fn((key: string): Promise<{ key: string; token: string } | null> => Promise.resolve({ key, token: 't' })),
    release: jest.fn((_lock: { key: string }) => Promise.resolve()),
    renew: jest.fn(() => Promise.resolve(true)),
  };
  const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) };

  const service = new PodReturnSyncService(
    prisma as never,
    config as never,
    repo as never,
    api as never,
    shopContext as never,
    syncStatus as never,
    locks as never,
    notifications as never,
  );
  return { service, store, events, repo, api, notifications, prisma, shopContext, syncStatus, locks };
}

beforeEach(() => {
  // Chỉ cố định ĐỒNG HỒ (new Date / Date.now); timer thật vẫn chạy.
  jest.useFakeTimers({ now: NOW_SEC * 1000, doNotFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PodReturnSyncService.syncShop', () => {
  it('yêu cầu mới ⇒ tạo đúng một bản ghi gắn đúng tổ chức / kết nối / shop, gửi ĐÚNG một thông báo', async () => {
    const h = build();
    const result = await h.service.syncShop(shop(), PodSyncTrigger.MANUAL, 'user-1');
    expect(result).toMatchObject({ status: PodSyncStatus.SUCCESS, created: 1, updated: 0, notified: 1 });
    const [row] = [...h.store.values()];
    expect(row.data).toMatchObject({ organizationId: 'org-1', accountId: 'acc-1', shopId: 'shop-1', tiktokReturnId: 'r1', orderId: 'pod-order-1' });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ eventType: 'RETURN_REFUND_REQUEST', entityId: row.id });
    expect(h.events[0].payload).toMatchObject({ tiktokOrderId: 'order-r1', returnType: 'REFUND', paidAmount: '12.5', requestedRefundAmount: '10', sellerName: 'Seller A' });
    // Watermark tiến tới cận trên của lượt.
    expect(h.prisma.podTiktokShop.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastReturnSyncCursor: BigInt(NOW_SEC) } }),
    );
  });

  it('đồng bộ lại cùng yêu cầu ⇒ không tạo trùng, không gửi thêm thông báo', async () => {
    const h = build();
    await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    const second = await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    expect(second).toMatchObject({ created: 0, updated: 0, unchanged: 1, notified: 0 });
    expect(h.store.size).toBe(1);
    expect(h.events).toHaveLength(1);
  });

  it('chạy nhiều lần liên tiếp (cron + Sync Now) ⇒ vẫn chỉ một bản ghi và một thông báo', async () => {
    const h = build();
    for (let i = 0; i < 3; i++) await h.service.syncShop(shop(), PodSyncTrigger.MANUAL, null);
    expect(h.store.size).toBe(1);
    expect(h.events).toHaveLength(1);
  });

  it('trạng thái đổi ⇒ CẬP NHẬT bản ghi hiện có, không gửi thông báo "yêu cầu mới" lần nữa', async () => {
    const h = build({ pages: [[ret('r1')]] });
    await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    h.api.searchReturns.mockResolvedValueOnce({
      data: { items: [ret('r1', { returnStatus: 'RETURN_OR_REFUND_REQUEST_COMPLETE', updateTime: NOW_SEC - 10 })], nextPageToken: undefined },
      requestId: 'rq',
    });
    const result = await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    expect(result).toMatchObject({ updated: 1, created: 0, notified: 0 });
    const [row] = [...h.store.values()];
    expect(row.data).toMatchObject({ returnStatus: 'RETURN_OR_REFUND_REQUEST_COMPLETE', statusGroup: 'COMPLETED', refundCompleted: true });
    expect(h.events).toHaveLength(1);
  });

  it('phân trang: đọc HẾT mọi trang theo page_token', async () => {
    const h = build({ pages: [[ret('a'), ret('b')], [ret('c')], [ret('d')]] });
    const result = await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    expect(h.api.searchReturns).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ fetched: 4, created: 4, status: PodSyncStatus.SUCCESS });
  });

  it('lượt đầu của shop (chưa có watermark) ⇒ nhập lịch sử, KHÔNG gửi thông báo', async () => {
    const h = build();
    const result = await h.service.syncShop(shop({ lastReturnSyncCursor: null }), PodSyncTrigger.CRON, null);
    expect(result).toMatchObject({ created: 1, notified: 0 });
    expect(h.events).toHaveLength(0);
    expect(h.notifications.isEnabled).not.toHaveBeenCalled();
  });

  it('yêu cầu TẠO trước cửa sổ đồng bộ (lần đầu lọt vào vì vừa cập nhật) ⇒ không coi là yêu cầu mới', async () => {
    const h = build({ pages: [[ret('old', { createTime: NOW_SEC - 30 * 86_400 })]] });
    const result = await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    expect(result).toMatchObject({ created: 1, notified: 0 });
  });

  it('105005 (thiếu scope seller.return_refund.basic) ⇒ FAILED + RETURN_SCOPE_MISSING, watermark KHÔNG tiến', async () => {
    const h = build();
    h.api.searchReturns.mockRejectedValueOnce(
      new TiktokClientError(TiktokErrorClass.AUTH, 105005, 'scope not authorized', 200, 'req-x'),
    );
    const result = await h.service.syncShop(shop(), PodSyncTrigger.MANUAL, null);
    expect(result).toMatchObject({ status: PodSyncStatus.FAILED, errorCode: 'RETURN_SCOPE_MISSING', fetched: 0 });
    expect(h.prisma.podTiktokShop.updateMany).not.toHaveBeenCalled();
    expect(h.syncStatus.finish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: PodSyncStatus.FAILED, errorCode: 'RETURN_SCOPE_MISSING' }),
    );
  });

  it('cấu hình thông báo lỗi (Telegram / outbox) ⇒ yêu cầu VẪN được lưu, đồng bộ thành công', async () => {
    const h = build({ notifyEnabled: new Error('telegram config read failed') });
    const result = await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    expect(result).toMatchObject({ status: PodSyncStatus.SUCCESS, created: 1, notified: 0 });
    expect(h.store.size).toBe(1);
  });

  it('tổ chức tắt loại thông báo Return/Refund ⇒ không ghi sự kiện', async () => {
    const h = build({ notifyEnabled: false });
    await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    expect(h.events).toHaveLength(0);
  });

  it('một yêu cầu thiếu định danh ⇒ đếm lỗi, PARTIAL, watermark giữ nguyên để lượt sau đọc lại', async () => {
    const h = build({ pages: [[ret('ok'), ret('bad', { returnId: undefined })]] });
    const result = await h.service.syncShop(shop(), PodSyncTrigger.CRON, null);
    expect(result).toMatchObject({ created: 1, failed: 1, status: PodSyncStatus.PARTIAL });
    expect(h.prisma.podTiktokShop.updateMany).not.toHaveBeenCalled();
  });

  it('shop đang có lượt khác giữ khoá ⇒ SKIPPED, không gọi TikTok', async () => {
    const h = build();
    h.locks.acquire.mockResolvedValueOnce(null);
    const result = await h.service.syncShop(shop(), PodSyncTrigger.MANUAL, null);
    expect(result).toMatchObject({ status: PodSyncStatus.SKIPPED, errorCode: 'ALREADY_RUNNING' });
    expect(h.api.searchReturns).not.toHaveBeenCalled();
  });
});

describe('PodReturnSyncService — shop đủ điều kiện / quyền', () => {
  it('biết chắc thiếu scope Return (granted_scopes) ⇒ FAILED + RETURN_SCOPE_MISSING, KHÔNG gọi TikTok / không refresh token', async () => {
    const h = build();
    const result = await h.service.syncShop(shop({ scopeGranted: false }), PodSyncTrigger.CRON, null);
    expect(result).toMatchObject({ status: PodSyncStatus.FAILED, errorCode: 'RETURN_SCOPE_MISSING', fetched: 0 });
    expect(h.shopContext.resolve).not.toHaveBeenCalled();
    expect(h.api.searchReturns).not.toHaveBeenCalled();
    expect(h.prisma.podTiktokShop.updateMany).not.toHaveBeenCalled();
    // Lỗi vẫn được ghi vào trạng thái đồng bộ để giao diện cảnh báo.
    expect(h.syncStatus.finish).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ errorCode: 'RETURN_SCOPE_MISSING' }));
  });

  it('lượt cron: kết nối có scope ⇒ đồng bộ; kết nối thiếu scope ⇒ bỏ qua không gọi TikTok', async () => {
    const ok = build({ grantedScopes: ['seller.order.info', 'seller.return_refund.basic'] });
    expect((await ok.service.runAll())?.[0]).toMatchObject({ status: PodSyncStatus.SUCCESS, created: 1 });

    const missing = build({ grantedScopes: ['seller.order.info'] });
    expect((await missing.service.runAll())?.[0]).toMatchObject({ errorCode: 'RETURN_SCOPE_MISSING' });
    expect(missing.api.searchReturns).not.toHaveBeenCalled();
  });

  it('chỉ chọn shop như đồng bộ đơn POD: bật sync, không tạm dừng, kết nối ACTIVE, shop chưa mất uỷ quyền', async () => {
    const h = build();
    await h.service.runAll();
    expect(h.prisma.podTiktokShop.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- asymmetric matcher của jest
        where: expect.objectContaining({
          deletedAt: null,
          syncEnabled: true,
          status: { not: 'DEAUTHORIZED' },
          account: { deletedAt: null, status: 'ACTIVE' },
        }),
      }),
    );
  });

  it('hasReturnScope: mảng có scope ⇒ true; thiếu ⇒ false; rỗng / không phải mảng ⇒ null (chưa biết, vẫn thử gọi)', () => {
    expect(hasReturnScope(['seller.return_refund.basic'])).toBe(true);
    expect(hasReturnScope(['seller.order.info'])).toBe(false);
    expect(hasReturnScope([])).toBeNull();
    expect(hasReturnScope(null)).toBeNull();
    expect(hasReturnScope({ scope: 'x' })).toBeNull();
  });
});

describe('PodReturnSyncService.runAll — nhiều instance', () => {
  it('🔴 hai worker cùng chạy cron: chỉ worker giữ khoá toàn cục đồng bộ; không trùng yêu cầu / thông báo', async () => {
    const h = build({ grantedScopes: ['seller.return_refund.basic'] });
    const held = new Set<string>();
    h.locks.acquire.mockImplementation((key: string) => {
      if (held.has(key)) return Promise.resolve(null);
      held.add(key);
      return Promise.resolve({ key, token: 't' });
    });
    h.locks.release.mockImplementation((lock: { key: string }) => {
      held.delete(lock.key);
      return Promise.resolve();
    });
    const [first, second] = await Promise.all([h.service.runAll(), h.service.runAll()]);
    expect([first, second].filter((run) => run === null)).toHaveLength(1);
    expect(h.store.size).toBe(1);
    expect(h.events).toHaveLength(1);
    // Lượt sau (khoá đã nhả) đọc lại cùng yêu cầu ⇒ vẫn không trùng.
    await h.service.runAll();
    expect(h.store.size).toBe(1);
    expect(h.events).toHaveLength(1);
  });
});

describe('PodReturnSyncJob — lịch chạy', () => {
  const ENV = 'TIKTOK_RETURN_SYNC_CRON';
  it('mặc định MỖI 5 PHÚT (cùng nhịp đồng bộ đơn POD), vẫn ghi đè được qua env', () => {
    const saved = process.env[ENV];
    delete process.env[ENV];
    expect(configuration().tiktok.returnSync.cron).toBe('*/5 * * * *');
    expect(configuration().tiktok.returnSync.cron).toBe(configuration().tiktok.sync.cron);
    process.env[ENV] = '*/10 * * * *';
    expect(configuration().tiktok.returnSync.cron).toBe('*/10 * * * *');
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('bật ⇒ đăng ký đúng MỘT cron job với biểu thức cấu hình; tắt ⇒ không đăng ký', () => {
    const registry = { addCronJob: jest.fn() };
    const sync = { runAll: jest.fn(() => Promise.resolve([])) };
    const configOf = (enabled: boolean) => ({
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'tiktok.returnSync.enabled' ? enabled : key === 'tiktok.returnSync.cron' ? '*/5 * * * *' : fallback,
      ),
    });
    new PodReturnSyncJob(configOf(false) as never, registry as never, sync as never).onModuleInit();
    expect(registry.addCronJob).not.toHaveBeenCalled();

    new PodReturnSyncJob(configOf(true) as never, registry as never, sync as never).onModuleInit();
    expect(registry.addCronJob).toHaveBeenCalledTimes(1);
    const [name, job] = registry.addCronJob.mock.calls[0] as [string, { cronTime: { source: string }; stop: () => void }];
    expect(name).toBe(PodReturnSyncJob.JOB_NAME);
    expect(job.cronTime.source).toBe('*/5 * * * *');
    job.stop();
  });
});

describe('PodReturnSyncService.runForShops', () => {
  it('một shop lỗi KHÔNG làm mất kết quả shop khác', async () => {
    const h = build({ shops: [shop({ id: 'shop-ok', name: 'OK' }), shop({ id: 'shop-bad', name: 'BAD' })] });
    h.shopContext.resolve.mockImplementation((_org: string, shopId: string) =>
      shopId === 'shop-bad'
        ? Promise.reject(new TiktokClientError(TiktokErrorClass.AUTH, 105005, 'scope', 200))
        : Promise.resolve({ accessToken: 'tok', shopCipher: 'c', shopId }),
    );
    const results = await h.service.runForShops('org-1', undefined, 'user-1');
    const byShop = Object.fromEntries(results.map((r) => [r.shopId, r]));
    expect(byShop['shop-ok']).toMatchObject({ status: PodSyncStatus.SUCCESS, created: 1 });
    expect(byShop['shop-bad']).toMatchObject({ status: PodSyncStatus.FAILED, errorCode: 'RETURN_SCOPE_MISSING' });
    expect(h.store.size).toBe(1);
  });

  it('chỉ đồng bộ đúng tổ chức + đúng tập shop được phép', async () => {
    const h = build();
    await h.service.runForShops('org-1', ['shop-1'], 'user-1');
    expect(h.prisma.podTiktokShop.findMany).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- asymmetric matcher của jest
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1', id: { in: ['shop-1'] } }) }),
    );
  });
});
