import { ConfigService } from '@nestjs/config';
import { PodSyncPhase, PodSyncStatus, PodSyncTrigger } from '@prisma/client';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodSyncLogRepository } from '../repositories/pod-sync-log.repository';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodOrderSyncService, ShopSyncOutcome } from './pod-order-sync.service';
import { PodPayoutSyncService } from './pod-payout-sync.service';
import { PodSyncOrchestratorService } from './pod-sync-orchestrator.service';
import { callArg, callArgs } from '../../../testing/mock-call.util';

const CONFIG_VALUES: Record<string, number | boolean> = {
  'tiktok.sync.runDeadlineMs': 240_000,
  'tiktok.sync.maxConcurrency': 4,
  // Payout chạy kèm trong cùng lượt cron — bật để bao phủ cả nhánh này.
  'tiktok.payout.enabled': true,
};

function shop(id: string, organizationId: string) {
  return {
    id,
    organizationId,
    accountId: `acc-${id}`,
    tiktokShopId: `tts-${id}`,
    shopCipherEnc: 'v1.x',
    name: `Shop ${id}`,
    lastOrderSyncCursor: 1000n,
    backfillDone: true,
    backfillCursor: null,
    account: {
      id: `acc-${id}`,
      organizationId,
      accountName: `Acc ${id}`,
      accessTokenEnc: 'v1.a',
      accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
      refreshTokenEnc: 'v1.r',
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000 * 30),
    },
  };
}

function outcome(shopId: string, over: Partial<ShopSyncOutcome> = {}): ShopSyncOutcome {
  return {
    shopId,
    shopName: `Shop ${shopId}`,
    status: PodSyncStatus.SUCCESS,
    phase: PodSyncPhase.INCREMENTAL,
    pagesFetched: 1,
    apiCalls: 1,
    totalOrders: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    windowFrom: 0n,
    windowTo: 0n,
    ...over,
  };
}

describe('PodSyncOrchestratorService — Scheduler Flow', () => {
  let service: PodSyncOrchestratorService;
  let config: { get: jest.Mock };
  let accountRepo: { listShopsForSync: jest.Mock };
  let syncLogRepo: { failStaleRuns: jest.Mock };
  let syncService: { syncShop: jest.Mock };
  let payoutSyncService: { syncShop: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    config = { get: jest.fn((key: string, fallback?: unknown) => CONFIG_VALUES[key] ?? fallback) };
    accountRepo = { listShopsForSync: jest.fn().mockResolvedValue([]) };
    syncLogRepo = { failStaleRuns: jest.fn().mockResolvedValue(0) };
    syncService = {
      syncShop: jest.fn((target: { id: string }) => Promise.resolve(outcome(target.id))),
    };
    payoutSyncService = {
      syncShop: jest.fn((target: { id: string }) => Promise.resolve({ shopId: target.id, ok: true })),
    };
    lock = {
      acquire: jest.fn().mockResolvedValue({ key: 'k', fenceToken: 'f' }),
      release: jest.fn().mockResolvedValue(undefined),
    };

    service = new PodSyncOrchestratorService(
      config as unknown as ConfigService,
      accountRepo as unknown as PodTiktokAccountRepository,
      syncLogRepo as unknown as PodSyncLogRepository,
      syncService as unknown as PodOrderSyncService,
      payoutSyncService as unknown as PodPayoutSyncService,
      lock as unknown as DistributedLockService,
    );
  });

  describe('Chống chạy trùng', () => {
    it('không giành được khoá toàn cục → bỏ qua, KHÔNG đụng tới shop nào', async () => {
      lock.acquire.mockResolvedValue(null);

      const result = await service.runAll();

      expect(result.skippedByLock).toBe(true);
      expect(accountRepo.listShopsForSync).not.toHaveBeenCalled();
      expect(syncService.syncShop).not.toHaveBeenCalled();
    });

    it('luôn giải phóng khoá sau khi chạy xong', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([shop('s1', 'org-a')]);
      await service.runAll();
      expect(lock.release).toHaveBeenCalledTimes(1);
    });

    it('dọn nhật ký bị treo trước khi chạy', async () => {
      await service.runAll();
      expect(syncLogRepo.failStaleRuns).toHaveBeenCalledWith(expect.any(Date));
    });
  });

  describe('Fail-soft — một account lỗi không dừng scheduler', () => {
    it('shop giữa bị lỗi → các shop còn lại vẫn được xử lý', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([
        shop('s1', 'org-a'),
        shop('s2', 'org-a'),
        shop('s3', 'org-a'),
      ]);
      syncService.syncShop.mockImplementation((target: { id: string }) =>
        target.id === 's2'
          ? Promise.resolve(outcome('s2', { status: PodSyncStatus.FAILED, errorCode: 'BOOM' }))
          : Promise.resolve(outcome(target.id)),
      );

      const result = await service.runAll();

      expect(syncService.syncShop).toHaveBeenCalledTimes(3);
      expect(result.shopsTotal).toBe(3);
      expect(result.shopsSucceeded).toBe(2);
      expect(result.shopsFailed).toBe(1);
    });

    it('🔴 syncShop NÉM lỗi ngoài dự kiến → vẫn tiếp tục shop kế tiếp', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([
        shop('s1', 'org-a'),
        shop('s2', 'org-a'),
        shop('s3', 'org-a'),
      ]);
      syncService.syncShop.mockImplementation((target: { id: string }) =>
        target.id === 's1'
          ? Promise.reject(new Error('lỗi không lường trước'))
          : Promise.resolve(outcome(target.id)),
      );

      const result = await service.runAll();

      expect(syncService.syncShop).toHaveBeenCalledTimes(3);
      expect(result.shopsTotal).toBe(2); // s1 không tạo outcome
      expect(lock.release).toHaveBeenCalled();
    });
  });

  describe('Fair-share giữa các Organization', () => {
    it('xếp xen kẽ theo org thay vì chạy hết org này rồi mới tới org khác', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([
        shop('a1', 'org-a'),
        shop('a2', 'org-a'),
        shop('a3', 'org-a'),
        shop('b1', 'org-b'),
        shop('c1', 'org-c'),
      ]);
      // Concurrency = 1 để thứ tự gọi phản ánh đúng thứ tự xếp hàng.
      config.get.mockImplementation((key: string, fallback?: number) =>
        key === 'tiktok.sync.maxConcurrency' ? 1 : (CONFIG_VALUES[key] ?? fallback),
      );

      await service.runAll();

      const order = callArgs<{ id: string }>(syncService.syncShop, 0).map((s) => s.id);
      expect(order).toEqual(['a1', 'b1', 'c1', 'a2', 'a3']);
    });
  });

  describe('Đồng bộ nhiều account', () => {
    it('tổng hợp số liệu của tất cả shop', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([
        shop('s1', 'org-a'),
        shop('s2', 'org-b'),
      ]);
      syncService.syncShop.mockImplementation((target: { id: string }) =>
        Promise.resolve(
          outcome(target.id, { totalOrders: 5, created: 2, updated: 2, skipped: 1 }),
        ),
      );

      const result = await service.runAll();

      expect(result.ordersCreated).toBe(4);
      expect(result.ordersUpdated).toBe(4);
      expect(result.ordersSkipped).toBe(2);
      expect(result.shopsSucceeded).toBe(2);
    });

    it('không có shop nào → kết thúc êm, không lỗi', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([]);
      const result = await service.runAll();
      expect(result.shopsTotal).toBe(0);
      expect(result.skippedByLock).toBe(false);
    });

    it('truyền đúng trigger xuống từng shop', async () => {
      accountRepo.listShopsForSync.mockResolvedValue([shop('s1', 'org-a')]);
      await service.runAll(PodSyncTrigger.MANUAL);
      expect(syncService.syncShop).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1' }),
        expect.objectContaining({ trigger: PodSyncTrigger.MANUAL }),
      );
    });

    it('scheduler (không có organizationId) → quét TOÀN hệ thống', async () => {
      await service.runAll(PodSyncTrigger.CRON);
      expect(accountRepo.listShopsForSync).toHaveBeenCalledWith(expect.any(Date), undefined);
    });

    it('🔴 đồng bộ thủ công → CHỈ quét shop của tổ chức người dùng', async () => {
      await service.runAll(PodSyncTrigger.MANUAL, 'org-a');
      expect(accountRepo.listShopsForSync).toHaveBeenCalledWith(expect.any(Date), 'org-a');
    });

    it('🔴 khoá riêng theo tổ chức — org này không chặn org kia', async () => {
      await service.runAll(PodSyncTrigger.MANUAL, 'org-a');
      const keyA = callArg<string>(lock.acquire, 0, 0);

      lock.acquire.mockClear();
      await service.runAll(PodSyncTrigger.MANUAL, 'org-b');
      const keyB = callArg<string>(lock.acquire, 0, 0);

      expect(keyA).toContain('org-a');
      expect(keyB).toContain('org-b');
      expect(keyA).not.toBe(keyB);
    });

    it('chạy song song tối đa maxConcurrency shop', async () => {
      const shops = Array.from({ length: 10 }, (_, i) => shop(`s${i}`, 'org-a'));
      accountRepo.listShopsForSync.mockResolvedValue(shops);

      let active = 0;
      let peak = 0;
      syncService.syncShop.mockImplementation(async (target: { id: string }) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return outcome(target.id);
      });

      await service.runAll();

      expect(peak).toBeLessThanOrEqual(4);
      expect(syncService.syncShop).toHaveBeenCalledTimes(10);
    });
  });
});
