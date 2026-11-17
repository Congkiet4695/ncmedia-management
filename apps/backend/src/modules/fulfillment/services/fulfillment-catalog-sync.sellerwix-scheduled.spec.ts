import { FulfillmentCatalogItemStatus, FulfillmentProvider, FulfillmentTrigger } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../database/prisma.service';
import type { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { FulfillmentClientError, FulfillmentErrorClass } from '../exceptions/fulfillment.exceptions';
import type { MangoCatalogService } from '../mango/services/mango-catalog.service';
import type { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import type { FulfillmentGlobalCatalogRepository } from '../repositories/fulfillment-global-catalog.repository';
import type { FulfillmentRepository } from '../repositories/fulfillment.repository';
import type { SellerwixCatalogService, SellerwixCatalogSnapshot } from '../sellerwix/services/sellerwix-catalog.service';
import { FulfillmentCatalogSyncService, GLOBAL_CATALOG_DUAL_WRITE_FLAG } from './fulfillment-catalog-sync.service';

/**
 * **Đồng bộ danh mục Sellerwix theo lịch (1 lần/ngày)** — đọc API MỘT lần cho mỗi nhóm thông tin xác thực, ghi cho
 * TỪNG tài khoản vào bảng của chính nó; bỏ qua tài khoản đã đồng bộ trong ngày; lỗi một tài khoản không dừng lượt chạy.
 *
 * Production 2026-11: 5 tài khoản Sellerwix × ~1.335 lời gọi × 4 lần/ngày; 4 tài khoản đọc ra danh mục y hệt
 * (973 sản phẩm, 34.002 biến thể, 0 khác biệt giá).
 */

interface AccountFixture {
  id: string;
  org: string;
  /** Dấu vân tay thông tin xác thực (giả lập API key). `null` ⇒ không tính được (thiếu key). */
  key: string | null;
  /** Lỗi khi đọc danh mục bằng tài khoản này. */
  fetchError?: Error;
}

function snapshot(price: string, warnings: string[] = [], apiCalls = 1344): SellerwixCatalogSnapshot {
  return {
    catalogues: [{ externalCatalogueId: '7', name: 'T-shirts', rawData: {} }],
    products: [
      {
        externalProductId: 'SW-MD-MPT',
        externalCatalogueId: '7',
        name: 'Tee',
        sku: 'SW-MD-MPT',
        image: null,
        basePrice: null,
        currency: 'USD',
        variationsCount: null,
        status: FulfillmentCatalogItemStatus.ACTIVE,
        rawData: {},
      },
    ],
    variants: [
      {
        externalProductId: 'SW-MD-MPT',
        externalVariantId: 'SW-MD-MPT-BLK-L',
        sku: 'SW-MD-MPT-BLK-L',
        name: 'Black / L',
        color: 'Black',
        size: 'L',
        price,
        status: FulfillmentCatalogItemStatus.ACTIVE,
        rawData: {},
      },
    ],
    apiCalls,
    warnings,
  };
}

function build(
  accounts: AccountFixture[],
  options: { doneToday?: string[]; snapshots?: Record<string, SellerwixCatalogSnapshot>; globalCatalog?: boolean } = {},
) {
  const rows = accounts.map((account) => ({
    id: account.id,
    organizationId: account.org,
    name: `Sellerwix ${account.id}`,
    provider: FulfillmentProvider.SELLERWIX,
    isActive: true,
  }));
  const syncLogs: Array<Record<string, unknown>> = [];
  const prisma = {
    fulfillmentAccount: { findMany: jest.fn().mockResolvedValue(rows) },
    fulfillmentSyncLog: {
      findMany: jest.fn().mockResolvedValue((options.doneToday ?? []).map((accountId) => ({ accountId }))),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        syncLogs.push({ id: `log-${syncLogs.length}`, ...args.data });
        return Promise.resolve({ id: `log-${syncLogs.length - 1}` });
      }),
      update: jest.fn((args: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(syncLogs.find((log) => log.id === args.where.id) ?? {}, args.data);
        return Promise.resolve({});
      }),
    },
  };
  const repo = {
    findOwnedAccountById: jest.fn((_org: string, id: string) => Promise.resolve(rows.find((row) => row.id === id) ?? null)),
  };
  const writes: Array<{ accountId: string; prices: unknown[] }> = [];
  const catalogRepo = {
    upsertCatalogues: jest.fn().mockResolvedValue(new Map([['7', 'cat-1']])),
    upsertProducts: jest.fn().mockResolvedValue(new Map([['SW-MD-MPT', 'prod-1']])),
    upsertVariants: jest.fn((scope: { accountId: string }, variants: Array<{ price: unknown }>) => {
      writes.push({ accountId: scope.accountId, prices: variants.map((variant) => variant.price) });
      return Promise.resolve(variants.length);
    }),
    archiveStale: jest.fn().mockResolvedValue({ catalogues: 0, products: 0, variants: 0 }),
  };
  const fixtureOf = (id: string) => accounts.find((account) => account.id === id)!;
  const sellerwixCatalog = {
    credentialFingerprint: jest.fn((account: { id: string }) => {
      const key = fixtureOf(account.id).key;
      if (!key) throw new Error('Thiếu API Key');
      return key;
    }),
    fetchCatalog: jest.fn((account: { id: string }) => {
      const fixture = fixtureOf(account.id);
      if (fixture.fetchError) return Promise.reject(fixture.fetchError);
      return Promise.resolve(options.snapshots?.[fixture.key ?? ''] ?? snapshot('8.22'));
    }),
  };
  const locks = {
    acquire: jest.fn((key: string): Promise<{ key: string; token: string } | null> => Promise.resolve({ key, token: 't' })),
    release: jest.fn().mockResolvedValue(undefined),
    renew: jest.fn().mockResolvedValue(true),
  };
  const globalCatalog = {
    projectAccount: jest.fn<Promise<unknown>, [string]>((accountId: string) =>
      Promise.resolve({
        catalogues: { conflicts: 0 },
        products: { conflicts: 0 },
        variants: { conflicts: 0 },
        accountProducts: 1,
        accountVariants: 1,
        durationMs: 1,
        accountId,
      }),
    ),
  };
  const service = new FulfillmentCatalogSyncService(
    prisma as unknown as PrismaService,
    repo as unknown as FulfillmentRepository,
    catalogRepo as unknown as FulfillmentCatalogRepository,
    {} as MangoCatalogService,
    sellerwixCatalog as unknown as SellerwixCatalogService,
    locks as unknown as DistributedLockService,
    options.globalCatalog ? (globalCatalog as unknown as FulfillmentGlobalCatalogRepository) : undefined,
    options.globalCatalog
      ? ({ get: (key: string) => key === GLOBAL_CATALOG_DUAL_WRITE_FLAG } as unknown as ConfigService)
      : undefined,
  );
  return { service, prisma, catalogRepo, sellerwixCatalog, locks, globalCatalog, writes, syncLogs };
}

const SHARED = 'key-shared';

describe('FulfillmentCatalogSyncService.syncSellerwixAccounts — đọc MỘT lần, ghi cho TỪNG tài khoản', () => {
  it('🔴 4 tài khoản CÙNG thông tin xác thực ⇒ đọc API 1 lần; mỗi tài khoản vẫn được ghi vào bảng của chính nó', async () => {
    const { service, sellerwixCatalog, writes, syncLogs } = build(
      ['a', 'b', 'c', 'd'].map((id, index) => ({ id, org: `org-${index}`, key: SHARED })),
    );

    const result = await service.syncSellerwixAccounts(new Date('2026-11-18T00:00:05Z'));

    expect(sellerwixCatalog.fetchCatalog).toHaveBeenCalledTimes(1);
    expect(writes.map((write) => write.accountId)).toEqual(['a', 'b', 'c', 'd']);
    expect(result).toMatchObject({ accounts: 4, succeeded: 4, failed: 0, credentialGroups: 1, fetches: 1, sharedProjections: 3, apiCalls: 1344 });
    // Nhật ký riêng cho TỪNG tài khoản; tài khoản theo sau ghi 0 lời gọi API (số liệu đối soát trung thực).
    expect(syncLogs.map((log) => [log.accountId, log.trigger, log.status, log.apiCalls])).toEqual([
      ['a', FulfillmentTrigger.CRON, 'SUCCESS', 1344],
      ['b', FulfillmentTrigger.CRON, 'SUCCESS', 0],
      ['c', FulfillmentTrigger.CRON, 'SUCCESS', 0],
      ['d', FulfillmentTrigger.CRON, 'SUCCESS', 0],
    ]);
  });

  it('🔴 KHÁC thông tin xác thực ⇒ tự đọc; giá của nhóm này KHÔNG BAO GIỜ ghi sang tài khoản nhóm kia', async () => {
    const { service, sellerwixCatalog, writes } = build(
      [
        { id: 'a', org: 'org-1', key: SHARED },
        { id: 'x', org: 'org-2', key: 'key-other' },
        { id: 'b', org: 'org-3', key: SHARED },
      ],
      { snapshots: { [SHARED]: snapshot('8.22'), 'key-other': snapshot('9.99') } },
    );

    const result = await service.syncSellerwixAccounts();

    expect(sellerwixCatalog.fetchCatalog).toHaveBeenCalledTimes(2);
    expect(Object.fromEntries(writes.map((write) => [write.accountId, write.prices]))).toEqual({
      a: ['8.22'],
      b: ['8.22'],
      x: ['9.99'],
    });
    expect(result).toMatchObject({ credentialGroups: 2, fetches: 2, sharedProjections: 1 });
  });

  it('Global Catalog: chiếu theo TỪNG tài khoản (lớp fulfillment_account_* riêng), không chiếu một lần cho tất cả', async () => {
    const { service, globalCatalog } = build(
      ['a', 'b', 'c'].map((id) => ({ id, org: `org-${id}`, key: SHARED })),
      { globalCatalog: true },
    );
    await service.syncSellerwixAccounts();
    expect(globalCatalog.projectAccount.mock.calls.map((call) => call[0])).toEqual(['a', 'b', 'c']);
  });

  it('🔴 tài khoản API key hỏng (Invalid Token) ⇒ chỉ nó FAILED; tài khoản khác vẫn đồng bộ, lượt chạy không dừng', async () => {
    const invalid = new FulfillmentClientError(FulfillmentErrorClass.AUTH, 'Invalid Token', 401);
    const { service, writes, syncLogs } = build([
      { id: 'bad', org: 'org-1', key: 'key-revoked', fetchError: invalid },
      { id: 'a', org: 'org-2', key: SHARED },
      { id: 'b', org: 'org-3', key: SHARED },
    ]);

    const result = await service.syncSellerwixAccounts();

    expect(result).toMatchObject({ succeeded: 2, failed: 1, fetches: 1, sharedProjections: 1 });
    expect(writes.map((write) => write.accountId)).toEqual(['a', 'b']);
    expect(syncLogs.find((log) => log.accountId === 'bad')).toMatchObject({ status: 'FAILED', errorMessage: 'Invalid Token' });
  });

  it('tài khoản dẫn đầu đọc lỗi ⇒ tài khoản kế tiếp CÙNG nhóm tự đọc (không mất danh mục của cả nhóm)', async () => {
    const { service, sellerwixCatalog, writes } = build([
      { id: 'a', org: 'org-1', key: SHARED, fetchError: new FulfillmentClientError(FulfillmentErrorClass.NETWORK, 'timeout') },
      { id: 'b', org: 'org-2', key: SHARED },
      { id: 'c', org: 'org-3', key: SHARED },
    ]);

    const result = await service.syncSellerwixAccounts();

    expect(sellerwixCatalog.fetchCatalog).toHaveBeenCalledTimes(2);
    expect(writes.map((write) => write.accountId)).toEqual(['b', 'c']);
    expect(result).toMatchObject({ succeeded: 2, failed: 1, fetches: 1, sharedProjections: 1 });
  });

  it('không tính được dấu vân tay (thiếu API key) ⇒ nhóm riêng, chính lượt đồng bộ của nó báo lỗi', async () => {
    const { service, sellerwixCatalog } = build([
      { id: 'nokey', org: 'org-1', key: null, fetchError: new Error('Thiếu API Key') },
      { id: 'a', org: 'org-2', key: SHARED },
    ]);
    const result = await service.syncSellerwixAccounts();
    expect(result).toMatchObject({ credentialGroups: 2, succeeded: 1, failed: 1 });
    expect(sellerwixCatalog.fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it('ảnh chụp đọc THIẾU (có cảnh báo) ⇒ chia sẻ nguyên trạng: KHÔNG tài khoản nào archive (cùng luật như tự đọc)', async () => {
    const { service, catalogRepo, syncLogs } = build(['a', 'b'].map((id) => ({ id, org: `org-${id}`, key: SHARED })), {
      snapshots: { [SHARED]: snapshot('8.22', ['Biến thể của SW-X đọc THIẾU (0/?): Too many requests']) },
    });
    await service.syncSellerwixAccounts();
    expect(catalogRepo.archiveStale).not.toHaveBeenCalled();
    expect(syncLogs.map((log) => log.status)).toEqual(['PARTIAL', 'PARTIAL']);
  });

  it('ảnh chụp ĐỦ ⇒ mỗi tài khoản archive phần đã ngừng bán của CHÍNH nó', async () => {
    const { service, catalogRepo } = build(['a', 'b'].map((id) => ({ id, org: `org-${id}`, key: SHARED })));
    await service.syncSellerwixAccounts();
    const archivedFor = (catalogRepo.archiveStale.mock.calls as Array<[{ accountId: string }]>).map(([scope]) => scope.accountId);
    expect(archivedFor).toEqual(['a', 'b']);
  });
});

describe('FulfillmentCatalogSyncService.syncSellerwixAccounts — không chạy trùng trong ngày', () => {
  it('🔴 tài khoản đã có lượt CRON SUCCESS/PARTIAL từ 00:00 UTC hôm nay ⇒ bỏ qua (restart / lịch bắn lặp)', async () => {
    const { service, prisma, sellerwixCatalog, writes } = build(
      ['a', 'b'].map((id) => ({ id, org: `org-${id}`, key: SHARED })),
      { doneToday: ['a', 'b'] },
    );

    const result = await service.syncSellerwixAccounts(new Date('2026-11-18T07:30:00Z'));

    expect(result).toMatchObject({ skippedToday: 2, succeeded: 0, fetches: 0 });
    expect(sellerwixCatalog.fetchCatalog).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    expect(prisma.fulfillmentSyncLog.findMany).toHaveBeenCalledWith({
      where: {
        accountId: { in: ['a', 'b'] },
        trigger: FulfillmentTrigger.CRON,
        status: { in: ['SUCCESS', 'PARTIAL'] },
        startedAt: { gte: new Date('2026-11-18T00:00:00.000Z') },
      },
      select: { accountId: true },
    });
  });

  it('chỉ một phần đã xong ⇒ phần còn lại vẫn chạy (lượt trước bị cắt ngang giữa chừng)', async () => {
    const { service, writes } = build(['a', 'b', 'c'].map((id) => ({ id, org: `org-${id}`, key: SHARED })), {
      doneToday: ['a'],
    });
    const result = await service.syncSellerwixAccounts();
    expect(writes.map((write) => write.accountId)).toEqual(['b', 'c']);
    expect(result).toMatchObject({ skippedToday: 1, fetches: 1, sharedProjections: 1 });
  });

  it('khoá theo tài khoản đang bị giữ (người dùng đang bấm Sync tay) ⇒ tài khoản đó báo bận, phần còn lại vẫn chạy', async () => {
    const { service, locks, writes } = build(['a', 'b'].map((id) => ({ id, org: `org-${id}`, key: SHARED })));
    locks.acquire.mockImplementation((key: string) => Promise.resolve(key.endsWith(':a') ? null : { key, token: 't' }));
    const result = await service.syncSellerwixAccounts();
    expect(result).toMatchObject({ failed: 1, succeeded: 1, fetches: 1 });
    expect(writes.map((write) => write.accountId)).toEqual(['b']);
  });
});

describe('FulfillmentCatalogSyncService.syncAllAccounts — lịch Mango / Pressify', () => {
  it('loại Sellerwix khỏi lịch 6 giờ (Sellerwix có lịch riêng 1 lần/ngày); Mango / Pressify giữ nguyên', async () => {
    const { service, prisma } = build([]);
    await service.syncAllAccounts({ excludeProviders: [FulfillmentProvider.SELLERWIX] });
    expect(prisma.fulfillmentAccount.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, isActive: true, provider: { notIn: [FulfillmentProvider.SELLERWIX] } },
      select: { id: true, organizationId: true, name: true },
    });
  });

  it('không truyền bộ lọc ⇒ như cũ (mọi nhà cung cấp)', async () => {
    const { service, prisma } = build([]);
    await service.syncAllAccounts();
    expect(prisma.fulfillmentAccount.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, isActive: true },
      select: { id: true, organizationId: true, name: true },
    });
  });
});
