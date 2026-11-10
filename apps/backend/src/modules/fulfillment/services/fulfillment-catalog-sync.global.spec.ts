import type { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, FulfillmentTrigger } from '@prisma/client';
import type { PrismaService } from '../../../database/prisma.service';
import type { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import type { MangoCatalogService } from '../mango/services/mango-catalog.service';
import type { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import type { FulfillmentGlobalCatalogRepository } from '../repositories/fulfillment-global-catalog.repository';
import type { FulfillmentRepository } from '../repositories/fulfillment.repository';
import type { SellerwixCatalogService } from '../sellerwix/services/sellerwix-catalog.service';
import {
  FulfillmentCatalogSyncService,
  GLOBAL_CATALOG_DUAL_WRITE_FLAG,
} from './fulfillment-catalog-sync.service';

/** Trạng thái ghi vào nhật ký đồng bộ ở lần cập nhật cuối. */
function lastLogStatus(syncLog: { update: jest.Mock }): unknown {
  const calls = syncLog.update.mock.calls as Array<[{ data: { status: unknown } }]>;
  return calls[calls.length - 1]?.[0].data.status;
}

const ACCOUNT = {
  id: 'acc-1',
  organizationId: 'org-1',
  provider: FulfillmentProvider.SELLERWIX,
  name: 'Sellerwix',
};

function build(options: { dualWrite: boolean; projection?: 'ok' | 'fail'; legacyFails?: boolean }) {
  const syncLog = {
    create: jest.fn().mockResolvedValue({ id: 'log-1' }),
    update: jest.fn().mockResolvedValue({}),
  };
  const prisma = { fulfillmentSyncLog: syncLog } as unknown as PrismaService;
  const repo = {
    findOwnedAccountById: jest.fn().mockResolvedValue(ACCOUNT),
  } as unknown as FulfillmentRepository;
  const catalogRepo = {
    upsertCatalogues: jest.fn().mockResolvedValue(new Map()),
    upsertProducts: jest.fn().mockResolvedValue(new Map()),
    upsertVariants: options.legacyFails
      ? jest.fn().mockRejectedValue(new Error('legacy write failed'))
      : jest.fn().mockResolvedValue(3),
    archiveStale: jest.fn().mockResolvedValue({ catalogues: 0, products: 0, variants: 0 }),
  };
  const sellerwix = {
    fetchCatalog: jest
      .fn()
      .mockResolvedValue({ catalogues: [], products: [], variants: [], apiCalls: 3, warnings: [] }),
  };
  const locks = {
    acquire: jest.fn().mockResolvedValue({ key: 'k', token: 't' }),
    renew: jest.fn(),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const report = {
    accountId: ACCOUNT.id,
    provider: ACCOUNT.provider,
    catalogues: {},
    products: {},
    variants: {},
  };
  const globalRepo = {
    projectAccount:
      options.projection === 'fail'
        ? jest.fn().mockRejectedValue(new Error('global write failed'))
        : jest.fn().mockResolvedValue({
            ...report,
            catalogues: { conflicts: 0 },
            products: { conflicts: 0 },
            variants: { conflicts: 0 },
          }),
  };
  const config = {
    get: (key: string) => (key === GLOBAL_CATALOG_DUAL_WRITE_FLAG ? options.dualWrite : undefined),
  } as unknown as ConfigService;
  const service = new FulfillmentCatalogSyncService(
    prisma,
    repo,
    catalogRepo as unknown as FulfillmentCatalogRepository,
    {} as MangoCatalogService,
    sellerwix as unknown as SellerwixCatalogService,
    locks as unknown as DistributedLockService,
    globalRepo as unknown as FulfillmentGlobalCatalogRepository,
    config,
  );
  return { service, globalRepo, syncLog, catalogRepo };
}

describe('FulfillmentCatalogSyncService — dual write Global Catalog', () => {
  it('bật ⇒ chiếu SAU khi bảng cũ ghi + archive xong, đúng tài khoản', async () => {
    const { service, globalRepo, catalogRepo } = build({ dualWrite: true, projection: 'ok' });
    const result = await service.syncAccount('org-1', 'acc-1', FulfillmentTrigger.MANUAL);
    expect(result.globalCatalog?.status).toBe('PROJECTED');
    expect(globalRepo.projectAccount).toHaveBeenCalledWith('acc-1', FulfillmentProvider.SELLERWIX);
    const archiveOrder = catalogRepo.archiveStale.mock.invocationCallOrder[0];
    expect(globalRepo.projectAccount.mock.invocationCallOrder[0]).toBeGreaterThan(archiveOrder);
  });

  it('🔴 chiếu LỖI ⇒ lượt đồng bộ vẫn SUCCESS theo bảng cũ, chỉ báo FAILED ở globalCatalog', async () => {
    const { service, syncLog } = build({ dualWrite: true, projection: 'fail' });
    const result = await service.syncAccount('org-1', 'acc-1', FulfillmentTrigger.MANUAL);
    expect(result.complete).toBe(true);
    expect(result.globalCatalog).toEqual({ status: 'FAILED', error: 'global write failed' });
    expect(lastLogStatus(syncLog)).toBe('SUCCESS');
  });

  it('bảng cũ LỖI ⇒ không chiếu, lượt đồng bộ thất bại như trước', async () => {
    const { service, globalRepo, syncLog } = build({ dualWrite: true, legacyFails: true });
    await expect(service.syncAccount('org-1', 'acc-1', FulfillmentTrigger.MANUAL)).rejects.toThrow(
      'legacy write failed',
    );
    expect(globalRepo.projectAccount).not.toHaveBeenCalled();
    expect(lastLogStatus(syncLog)).toBe('FAILED');
  });

  it('tắt cờ dual write ⇒ không chiếu', async () => {
    const { service, globalRepo } = build({ dualWrite: false });
    const result = await service.syncAccount('org-1', 'acc-1', FulfillmentTrigger.MANUAL);
    expect(result.globalCatalog).toEqual({ status: 'DISABLED' });
    expect(globalRepo.projectAccount).not.toHaveBeenCalled();
  });
});
