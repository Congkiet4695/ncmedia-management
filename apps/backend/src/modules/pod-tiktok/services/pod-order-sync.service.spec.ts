import { ConfigService } from '@nestjs/config';
import { PodSyncStatus, PodSyncTrigger } from '@prisma/client';
import { TiktokOrderClient } from '../clients/tiktok-order.client';
import { TiktokErrorClass } from '../constants/tiktok-error-code.constants';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import { OrderSyncHookRegistry } from '../../../common/hooks/order-sync-hook.registry';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodSyncLogRepository } from '../repositories/pod-sync-log.repository';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodOrderIngestionService } from './pod-order-ingestion.service';
import { PodOrderSyncService, SyncShopTarget } from './pod-order-sync.service';
import { PodTiktokTokenService } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';
import { callArg } from '../../../testing/mock-call.util';

const ORG_ID = '11111111-1111-1111-1111-111111111111';

const CONFIG_VALUES: Record<string, number | boolean> = {
  'tiktok.sync.pageSize': 100,
  'tiktok.sync.maxPagesPerRun': 50,
  'tiktok.sync.lagSeconds': 60,
  'tiktok.sync.overlapSeconds': 300,
  'tiktok.sync.maxWindowSeconds': 86_400,
  'tiktok.sync.initialLookbackSeconds': 2_592_000,
  'tiktok.sync.runDeadlineMs': 240_000,
  'tiktok.sync.failureThreshold': 5,
  'tiktok.sync.backfill.enabled': true,
  'tiktok.sync.backfill.fromDays': 0,
  'tiktok.sync.backfill.maxPagesPerRun': 200,
};

function buildTarget(overrides: Partial<SyncShopTarget> = {}): SyncShopTarget {
  return {
    id: 'shop-uuid',
    organizationId: ORG_ID,
    accountId: 'account-uuid',
    tiktokShopId: '7000714532876273420',
    shopCipherEnc: 'v1.cipher',
    name: 'NCMedia US Store',
    lastOrderSyncCursor: 1_700_000_000n,
    backfillDone: true,
    backfillCursor: null,
    account: {
      id: 'account-uuid',
      organizationId: ORG_ID,
      accountName: 'NCMedia US Store',
      accessTokenEnc: 'v1.access',
      accessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      refreshTokenEnc: 'v1.refresh',
      refreshTokenExpiresAt: new Date(Date.now() + 180 * 24 * 3600 * 1000),
    },
    ...overrides,
  };
}

/** Kết quả ingest rỗng dùng cho mock. */
function ingestResult(over: Partial<Record<string, number | bigint>> = {}) {
  return {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    maxUpdateTime: 0n,
    ...over,
  };
}

describe('PodOrderSyncService', () => {
  let service: PodOrderSyncService;
  let config: { get: jest.Mock };
  let orderClient: { searchOrders: jest.Mock };
  let ingestion: { ingestBatch: jest.Mock };
  let tokenService: { ensureValidAccessToken: jest.Mock };
  let accountRepo: {
    advanceSyncCursor: jest.Mock;
    advanceBackfillCursor: jest.Mock;
    completeBackfill: jest.Mock;
    resetBackfill: jest.Mock;
    touchLastSyncedAt: jest.Mock;
    recordShopSyncFailure: jest.Mock;
    pauseShopSync: jest.Mock;
  };
  let syncLogRepo: { start: jest.Mock; finish: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };
  let syncHooks: { notifyOrdersSynced: jest.Mock };

  beforeEach(() => {
    config = {
      get: jest.fn((key: string, fallback?: unknown) => CONFIG_VALUES[key] ?? fallback),
    };
    orderClient = {
      searchOrders: jest.fn().mockResolvedValue({ orders: [], nextPageToken: undefined }),
    };
    ingestion = { ingestBatch: jest.fn().mockResolvedValue(ingestResult()) };
    tokenService = {
      ensureValidAccessToken: jest
        .fn()
        .mockResolvedValue({ ok: true, accessToken: 'plain-access-token', refreshed: false }),
    };
    accountRepo = {
      advanceSyncCursor: jest.fn().mockResolvedValue(undefined),
      advanceBackfillCursor: jest.fn().mockResolvedValue(undefined),
      completeBackfill: jest.fn().mockResolvedValue(undefined),
      resetBackfill: jest.fn().mockResolvedValue(undefined),
      touchLastSyncedAt: jest.fn().mockResolvedValue(undefined),
      recordShopSyncFailure: jest.fn().mockResolvedValue(1),
      pauseShopSync: jest.fn().mockResolvedValue(undefined),
    };
    syncLogRepo = {
      start: jest.fn().mockResolvedValue({ id: 'log-uuid' }),
      finish: jest.fn().mockResolvedValue(undefined),
    };
    lock = {
      acquire: jest.fn().mockResolvedValue({ key: 'k', fenceToken: 'f' }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    syncHooks = { notifyOrdersSynced: jest.fn().mockResolvedValue(undefined) };

    service = new PodOrderSyncService(
      config as unknown as ConfigService,
      orderClient as unknown as TiktokOrderClient,
      ingestion as unknown as PodOrderIngestionService,
      tokenService as unknown as PodTiktokTokenService,
      accountRepo as unknown as PodTiktokAccountRepository,
      syncLogRepo as unknown as PodSyncLogRepository,
      { decrypt: () => 'PLAIN_SHOP_CIPHER' } as unknown as TiktokEncryptionService,
      lock as unknown as DistributedLockService,
      // Hook sau đồng bộ (ánh xạ tự động của Fulfillment) — không thuộc phạm vi bộ test này.
      syncHooks as unknown as OrderSyncHookRegistry,
    );
  });

  describe('Get Orders — gọi API đúng tài liệu', () => {
    it('dùng shop_cipher đã giải mã, sort theo update_time ASC, page_size từ config', async () => {
      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      const params = callArg<Record<string, unknown>>(orderClient.searchOrders, 0, 0);
      expect(params.shopCipher).toBe('PLAIN_SHOP_CIPHER');
      expect(params.accessToken).toBe('plain-access-token');
      expect(params.query).toEqual({
        page_size: 100,
        page_token: undefined,
        sort_field: 'update_time',
        sort_order: 'ASC',
      });
      const body = params.body as Record<string, number>;
      expect(body.update_time_ge).toBeLessThan(body.update_time_lt);
    });

    it('cửa sổ quét lùi thêm overlap so với watermark (bù cảnh báo của TikTok)', async () => {
      const target = buildTarget({ lastOrderSyncCursor: 1_700_000_000n });
      await service.syncShop(target, { trigger: PodSyncTrigger.CRON });

      const body = callArg<{ body: Record<string, number> }>(orderClient.searchOrders, 0, 0).body;
      expect(body.update_time_ge).toBe(1_700_000_000 - 300);
    });

    it('mất watermark ở pha incremental → quét lùi theo initialLookbackSeconds', async () => {
      const target = buildTarget({ lastOrderSyncCursor: null, backfillDone: true });
      await service.syncShop(target, { trigger: PodSyncTrigger.CRON });

      const body = callArg<{ body: Record<string, number> }>(orderClient.searchOrders, 0, 0).body;
      const nowSec = Math.floor(Date.now() / 1000);
      expect(nowSec - body.update_time_ge).toBeGreaterThanOrEqual(2_592_000 - 120);
    });

    it('lookbackMinutes (sync thủ công) ghi đè watermark', async () => {
      await service.syncShop(buildTarget(), {
        trigger: PodSyncTrigger.MANUAL,
        lookbackMinutes: 60,
      });
      const body = callArg<{ body: Record<string, number> }>(orderClient.searchOrders, 0, 0).body;
      const nowSec = Math.floor(Date.now() / 1000);
      expect(nowSec - body.update_time_ge).toBeGreaterThanOrEqual(3_590);
      expect(nowSec - body.update_time_ge).toBeLessThanOrEqual(3_610);
    });
  });

  /**
   * Hồi quy cho bug "55/143": chỉ quét `update_time` thì đơn cũ (đã COMPLETED lâu,
   * `update_time` nằm ngoài mọi cửa sổ tương lai) KHÔNG BAO GIỜ được kéo về.
   */
  describe('Pha BACKFILL — kéo đủ lịch sử theo create_time', () => {
    const backfillTarget = () => buildTarget({ backfillDone: false, backfillCursor: null });

    it('🔴 shop chưa backfill → lọc theo create_time, KHÔNG phải update_time', async () => {
      await service.syncShop(backfillTarget(), { trigger: PodSyncTrigger.CRON });

      const params = callArg<{ query: Record<string, unknown>; body: Record<string, number> }>(
        orderClient.searchOrders,
        0,
        0,
      );
      expect(params.query.sort_field).toBe('create_time');
      expect(params.query.sort_order).toBe('ASC');
      expect(params.body.update_time_ge).toBeUndefined();
      expect(params.body.update_time_lt).toBeUndefined();
      expect(params.body.create_time_lt).toBeGreaterThan(0);
    });

    it('🔴 fromDays = 0 → kéo TOÀN BỘ lịch sử shop (create_time_ge = 0)', async () => {
      await service.syncShop(backfillTarget(), { trigger: PodSyncTrigger.CRON });
      const body = callArg<{ body: Record<string, number> }>(orderClient.searchOrders, 0, 0).body;
      expect(body.create_time_ge).toBe(0);
    });

    it('fromDays > 0 → chỉ kéo lùi đúng số ngày cấu hình', async () => {
      CONFIG_VALUES['tiktok.sync.backfill.fromDays'] = 90;
      try {
        await service.syncShop(backfillTarget(), { trigger: PodSyncTrigger.CRON });
        const body = callArg<{ body: Record<string, number> }>(orderClient.searchOrders, 0, 0).body;
        const nowSec = Math.floor(Date.now() / 1000);
        expect(nowSec - body.create_time_ge).toBeGreaterThanOrEqual(90 * 86_400 - 5);
        expect(nowSec - body.create_time_ge).toBeLessThanOrEqual(90 * 86_400 + 5);
      } finally {
        CONFIG_VALUES['tiktok.sync.backfill.fromDays'] = 0;
      }
    });

    it('đang kéo dở → tiếp tục từ backfillCursor, không quét lại từ đầu', async () => {
      await service.syncShop(buildTarget({ backfillDone: false, backfillCursor: 1_750_000_000n }), {
        trigger: PodSyncTrigger.CRON,
      });
      const body = callArg<{ body: Record<string, number> }>(orderClient.searchOrders, 0, 0).body;
      expect(body.create_time_ge).toBe(1_750_000_000);
    });

    it('🔴 quét hết → bật cờ backfillDone và bàn giao watermark cho pha incremental', async () => {
      const outcome = await service.syncShop(backfillTarget(), { trigger: PodSyncTrigger.CRON });

      expect(outcome.phase).toBe('BACKFILL');
      expect(accountRepo.completeBackfill).toHaveBeenCalledWith(
        'shop-uuid',
        outcome.windowTo,
        expect.any(Date),
      );
      // Pha backfill KHÔNG được tự đẩy watermark update_time bằng advanceSyncCursor.
      expect(accountRepo.advanceSyncCursor).not.toHaveBeenCalled();
    });

    it('🔴 chưa quét hết → KHÔNG bật cờ, chỉ lưu cursor create_time để lượt sau chạy tiếp', async () => {
      CONFIG_VALUES['tiktok.sync.backfill.maxPagesPerRun'] = 1;
      try {
        orderClient.searchOrders.mockResolvedValue({
          orders: [{ id: 'a', create_time: 1_760_000_000 }],
          nextPageToken: 'next',
        });
        ingestion.ingestBatch.mockResolvedValue(ingestResult({ total: 1, created: 1 }));

        const outcome = await service.syncShop(backfillTarget(), { trigger: PodSyncTrigger.CRON });

        expect(outcome.status).toBe(PodSyncStatus.PARTIAL);
        expect(accountRepo.completeBackfill).not.toHaveBeenCalled();
        expect(accountRepo.advanceBackfillCursor).toHaveBeenCalledWith(
          'shop-uuid',
          1_760_000_000n,
          expect.any(Date),
        );
      } finally {
        CONFIG_VALUES['tiktok.sync.backfill.maxPagesPerRun'] = 200;
      }
    });

    it('🔴 có đơn ghi lỗi → KHÔNG đẩy cursor (lượt sau quét lại, không mất đơn)', async () => {
      CONFIG_VALUES['tiktok.sync.backfill.maxPagesPerRun'] = 1;
      try {
        orderClient.searchOrders.mockResolvedValue({
          orders: [{ id: 'a', create_time: 1_760_000_000 }],
          nextPageToken: 'next',
        });
        ingestion.ingestBatch.mockResolvedValue(ingestResult({ total: 1, failed: 1 }));

        await service.syncShop(backfillTarget(), { trigger: PodSyncTrigger.CRON });

        expect(accountRepo.advanceBackfillCursor).not.toHaveBeenCalled();
        expect(accountRepo.completeBackfill).not.toHaveBeenCalled();
      } finally {
        CONFIG_VALUES['tiktok.sync.backfill.maxPagesPerRun'] = 200;
      }
    });

    it('shop đã backfill xong → quay lại pha incremental theo update_time', async () => {
      const outcome = await service.syncShop(buildTarget({ backfillDone: true }), {
        trigger: PodSyncTrigger.CRON,
      });
      const params = callArg<{ query: Record<string, unknown>; body: Record<string, number> }>(
        orderClient.searchOrders,
        0,
        0,
      );
      expect(outcome.phase).toBe('INCREMENTAL');
      expect(params.query.sort_field).toBe('update_time');
      expect(params.body.create_time_ge).toBeUndefined();
    });

    it('tắt backfill qua ENV → giữ nguyên hành vi incremental', async () => {
      CONFIG_VALUES['tiktok.sync.backfill.enabled'] = false;
      try {
        const outcome = await service.syncShop(backfillTarget(), { trigger: PodSyncTrigger.CRON });
        expect(outcome.phase).toBe('INCREMENTAL');
      } finally {
        CONFIG_VALUES['tiktok.sync.backfill.enabled'] = true;
      }
    });

    it('option backfill=true → đặt lại cờ rồi chạy lại pha BACKFILL', async () => {
      const outcome = await service.syncShop(buildTarget({ backfillDone: true }), {
        trigger: PodSyncTrigger.BACKFILL,
        backfill: true,
      });

      expect(accountRepo.resetBackfill).toHaveBeenCalledWith('shop-uuid');
      expect(outcome.phase).toBe('BACKFILL');
    });
  });

  describe('Pagination — lấy TOÀN BỘ đơn, không dừng ở trang đầu', () => {
    it('đi hết các trang theo next_page_token', async () => {
      orderClient.searchOrders
        .mockResolvedValueOnce({ orders: [{ id: 'a' }], nextPageToken: 'p2' })
        .mockResolvedValueOnce({ orders: [{ id: 'b' }], nextPageToken: 'p3' })
        .mockResolvedValueOnce({ orders: [{ id: 'c' }], nextPageToken: undefined });
      ingestion.ingestBatch.mockResolvedValue(
        ingestResult({ total: 1, created: 1, maxUpdateTime: 10n }),
      );

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(orderClient.searchOrders).toHaveBeenCalledTimes(3);
      expect(outcome.pagesFetched).toBe(3);
      expect(outcome.apiCalls).toBe(3);
      expect(outcome.created).toBe(3);
      expect(outcome.status).toBe(PodSyncStatus.SUCCESS);
    });

    it('truyền page_token của trang trước sang trang sau', async () => {
      orderClient.searchOrders
        .mockResolvedValueOnce({ orders: [], nextPageToken: 'TOKEN_2' })
        .mockResolvedValueOnce({ orders: [], nextPageToken: undefined });

      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(
        callArg<{ query: { page_token?: string } }>(orderClient.searchOrders, 0, 0).query
          .page_token,
      ).toBeUndefined();
      expect(
        callArg<{ query: { page_token?: string } }>(orderClient.searchOrders, 1, 0).query
          .page_token,
      ).toBe('TOKEN_2');
    });

    it('next_page_token rỗng "" được coi là hết trang', async () => {
      orderClient.searchOrders.mockResolvedValueOnce({ orders: [], nextPageToken: undefined });
      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });
      expect(orderClient.searchOrders).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe(PodSyncStatus.SUCCESS);
    });

    it('🔴 next_page_token lặp lại → dừng, KHÔNG lặp vô hạn', async () => {
      orderClient.searchOrders.mockResolvedValue({ orders: [], nextPageToken: 'SAME' });

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      // Trang 1 lấy SAME, trang 2 lại SAME ⇒ dừng ở trang 2.
      expect(orderClient.searchOrders).toHaveBeenCalledTimes(2);
      expect(outcome.status).toBe(PodSyncStatus.PARTIAL);
    });

    it('chạm giới hạn maxPagesPerRun → PARTIAL, watermark KHÔNG tiến', async () => {
      config.get.mockImplementation((key: string, fallback?: number) =>
        key === 'tiktok.sync.maxPagesPerRun' ? 2 : (CONFIG_VALUES[key] ?? fallback),
      );
      orderClient.searchOrders.mockResolvedValue({ orders: [], nextPageToken: 'next' });

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(outcome.status).toBe(PodSyncStatus.PARTIAL);
      expect(accountRepo.advanceSyncCursor).not.toHaveBeenCalled();
    });
  });

  describe('Watermark — không mất đơn', () => {
    it('quét hết và không lỗi → watermark tiến tới windowTo', async () => {
      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(accountRepo.advanceSyncCursor).toHaveBeenCalledWith(
        'shop-uuid',
        outcome.windowTo,
        expect.any(Date),
      );
      expect(accountRepo.touchLastSyncedAt).toHaveBeenCalled();
    });

    it('🔴 có đơn ghi lỗi → GIỮ NGUYÊN watermark để lượt sau quét lại', async () => {
      ingestion.ingestBatch.mockResolvedValue(ingestResult({ total: 2, created: 1, failed: 1 }));

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(outcome.status).toBe(PodSyncStatus.PARTIAL);
      expect(accountRepo.advanceSyncCursor).not.toHaveBeenCalled();
    });
  });

  describe('Token', () => {
    it('kiểm tra token TRƯỚC khi gọi API', async () => {
      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });
      expect(tokenService.ensureValidAccessToken).toHaveBeenCalled();
    });

    it('refresh thất bại → KHÔNG gọi Get Orders, log lỗi, trả FAILED', async () => {
      tokenService.ensureValidAccessToken.mockResolvedValue({
        ok: false,
        reason: 'REAUTH_REQUIRED',
        message: 'Uỷ quyền đã hết hạn',
      });

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(orderClient.searchOrders).not.toHaveBeenCalled();
      expect(outcome.status).toBe(PodSyncStatus.FAILED);
      expect(outcome.errorCode).toBe('REAUTH_REQUIRED');
      expect(syncLogRepo.finish).toHaveBeenCalled();
    });
  });

  describe('Error handling — fail-soft', () => {
    it('API timeout → KHÔNG ném lỗi ra ngoài, trả FAILED có mã lỗi', async () => {
      orderClient.searchOrders.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'Request timeout', 0),
      );

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(outcome.status).toBe(PodSyncStatus.FAILED);
      expect(outcome.errorMessage).toContain('Request timeout');
      expect(accountRepo.advanceSyncCursor).not.toHaveBeenCalled();
    });

    it('rate limit → FAILED kèm mã 36009002, ghi sync log', async () => {
      orderClient.searchOrders.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.RATE_LIMIT, 36009002, 'Too many requests', 429),
      );

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(outcome.errorCode).toBe('36009002');
      expect(syncLogRepo.finish).toHaveBeenCalledWith(
        'log-uuid',
        expect.any(Date),
        expect.objectContaining({ status: PodSyncStatus.FAILED, errorCode: '36009002' }),
      );
    });

    it('luôn giải phóng khoá kể cả khi lỗi', async () => {
      orderClient.searchOrders.mockRejectedValue(new Error('boom'));
      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });
      expect(lock.release).toHaveBeenCalledTimes(1);
    });

    it('lỗi → ghi nhận thất bại cho shop', async () => {
      orderClient.searchOrders.mockRejectedValue(new Error('boom'));
      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });
      expect(accountRepo.recordShopSyncFailure).toHaveBeenCalledWith('shop-uuid', null);
    });

    it('chưa đủ ngưỡng lỗi liên tiếp → CHƯA tạm ngưng shop', async () => {
      orderClient.searchOrders.mockRejectedValue(new Error('boom'));
      accountRepo.recordShopSyncFailure.mockResolvedValue(4);

      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(accountRepo.pauseShopSync).not.toHaveBeenCalled();
    });

    it('🔴 đủ ngưỡng lỗi liên tiếp → tạm ngưng shop (circuit breaker thực sự nổ)', async () => {
      orderClient.searchOrders.mockRejectedValue(new Error('boom'));
      accountRepo.recordShopSyncFailure.mockResolvedValue(5);

      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(accountRepo.pauseShopSync).toHaveBeenCalledWith('shop-uuid', expect.any(Date));
    });

    it('lỗi liên tiếp càng nhiều → thời gian tạm ngưng càng dài (backoff)', async () => {
      orderClient.searchOrders.mockRejectedValue(new Error('boom'));
      accountRepo.recordShopSyncFailure.mockResolvedValue(5);
      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });
      const first = callArg<Date>(accountRepo.pauseShopSync, 0, 1).getTime();

      accountRepo.recordShopSyncFailure.mockResolvedValue(8);
      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });
      const later = callArg<Date>(accountRepo.pauseShopSync, 1, 1).getTime();

      expect(later).toBeGreaterThan(first);
    });
  });

  describe('Đối soát số lượng với TikTok', () => {
    it('ghi lại total_count TikTok báo để phát hiện đồng bộ thiếu', async () => {
      orderClient.searchOrders.mockResolvedValue({
        orders: [{ id: 'a' }],
        nextPageToken: undefined,
        totalCount: 143,
      });
      ingestion.ingestBatch.mockResolvedValue(ingestResult({ total: 1, created: 1 }));

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(outcome.tiktokTotalCount).toBe(143);
      expect(syncLogRepo.finish).toHaveBeenCalledWith(
        'log-uuid',
        expect.any(Date),
        expect.objectContaining({ tiktokTotalCount: 143, totalOrders: 1 }),
      );
    });
  });

  describe('Chống chạy trùng', () => {
    it('không giành được khoá → SKIPPED, không gọi TikTok', async () => {
      lock.acquire.mockResolvedValue(null);

      const outcome = await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(outcome.status).toBe(PodSyncStatus.SKIPPED);
      expect(orderClient.searchOrders).not.toHaveBeenCalled();
      expect(syncLogRepo.start).not.toHaveBeenCalled();
    });
  });

  describe('Sync log', () => {
    it('ghi số liệu created/updated/skipped/failed và số lần gọi API', async () => {
      orderClient.searchOrders.mockResolvedValue({
        orders: [{ id: 'a' }],
        nextPageToken: undefined,
      });
      ingestion.ingestBatch.mockResolvedValue(
        ingestResult({
          total: 10,
          created: 4,
          updated: 3,
          skipped: 2,
          failed: 0,
          maxUpdateTime: 99n,
        }),
      );

      await service.syncShop(buildTarget(), { trigger: PodSyncTrigger.CRON });

      expect(syncLogRepo.finish).toHaveBeenCalledWith(
        'log-uuid',
        expect.any(Date),
        expect.objectContaining({
          status: PodSyncStatus.SUCCESS,
          totalOrders: 10,
          createdCount: 4,
          updatedCount: 3,
          skippedCount: 2,
          failedCount: 0,
          pagesFetched: 1,
          apiCalls: 1,
        }),
      );
    });
  });
});
