import { ConfigService } from '@nestjs/config';
import { TiktokOrderClient } from '../clients/tiktok-order.client';
import { TiktokErrorClass } from '../constants/tiktok-error-code.constants';
import { TiktokClientError } from '../exceptions/pod-tiktok.exceptions';
import { OrderSyncHookRegistry } from '../../../common/hooks/order-sync-hook.registry';
import { DistributedLockService } from '../infra/distributed-lock.service';
import { PodShopSyncStatusRepository } from '../repositories/pod-shop-sync-status.repository';
import { PodTiktokAccountRepository } from '../repositories/pod-tiktok-account.repository';
import { PodOrderIngestionService } from './pod-order-ingestion.service';
import { PodOrderSyncService, SelectedOrderRef, SyncShopTarget } from './pod-order-sync.service';
import { PodTiktokTokenService } from './pod-tiktok-token.service';
import { TiktokEncryptionService } from './tiktok-encryption.service';
import { callArg } from '../../../testing/mock-call.util';

/**
 * "Sync Orders" theo lựa chọn — `PodOrderSyncService.syncSelectedOrders`.
 * Luật được khoá: lô ≤ 50, khoá shop dùng chung, thành công một phần, KHÔNG chạm lịch đồng bộ shop.
 */
const ORG_ID = '11111111-1111-1111-1111-111111111111';

function target(): SyncShopTarget {
  return {
    id: 'shop-uuid',
    organizationId: ORG_ID,
    accountId: 'account-uuid',
    tiktokShopId: '7000714532876273420',
    shopCipherEnc: 'v1.cipher',
    name: 'Store',
    lastOrderSyncCursor: 1_700_000_000n,
    backfillDone: true,
    backfillCursor: null,
    account: {
      id: 'account-uuid',
      organizationId: ORG_ID,
      accountName: 'Store',
      accessTokenEnc: 'v1.access',
      accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
      refreshTokenEnc: 'v1.refresh',
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000 * 30),
    },
  };
}

function refs(count: number): SelectedOrderRef[] {
  return Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, tiktokOrderId: `T${i}` }));
}

/** Đơn TikTok tối thiểu — ingest được mock nên chỉ cần `id`. */
const tiktokOrder = (id: string) => ({
  id,
  status: 'AWAITING_SHIPMENT',
  create_time: 1,
  update_time: 2,
});

describe('PodOrderSyncService.syncSelectedOrders', () => {
  let service: PodOrderSyncService;
  let orderClient: { searchOrders: jest.Mock; getOrderDetails: jest.Mock };
  let ingestion: { ingestBatch: jest.Mock };
  let tokenService: { ensureValidAccessToken: jest.Mock };
  let accountRepo: Record<string, jest.Mock>;
  let syncStatusRepo: { start: jest.Mock; finish: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };
  let syncHooks: { notifyOrdersSynced: jest.Mock };

  beforeEach(() => {
    orderClient = {
      searchOrders: jest.fn(),
      // Mặc định: TikTok trả về đúng mọi ID được hỏi.
      getOrderDetails: jest.fn(({ ids }: { ids: string[] }) =>
        Promise.resolve({ orders: ids.map(tiktokOrder) }),
      ),
    };
    ingestion = {
      ingestBatch: jest.fn((orders: unknown[]) =>
        Promise.resolve({
          total: orders.length,
          created: 0,
          updated: orders.length,
          skipped: 0,
          failed: 0,
          maxUpdateTime: 0n,
          failedTiktokOrderIds: [],
        }),
      ),
    };
    tokenService = {
      ensureValidAccessToken: jest
        .fn()
        .mockResolvedValue({ ok: true, accessToken: 'plain-access', refreshed: false }),
    };
    accountRepo = {
      advanceSyncCursor: jest.fn(),
      advanceBackfillCursor: jest.fn(),
      completeBackfill: jest.fn(),
      resetBackfill: jest.fn(),
      touchLastSyncedAt: jest.fn(),
      recordShopSyncFailure: jest.fn(),
      pauseShopSync: jest.fn(),
    };
    syncStatusRepo = { start: jest.fn(), finish: jest.fn() };
    lock = {
      acquire: jest.fn().mockResolvedValue({ key: 'k', fenceToken: 'f' }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    syncHooks = { notifyOrdersSynced: jest.fn() };

    service = new PodOrderSyncService(
      { get: jest.fn((_key: string, fallback?: unknown) => fallback) } as unknown as ConfigService,
      orderClient as unknown as TiktokOrderClient,
      ingestion as unknown as PodOrderIngestionService,
      tokenService as unknown as PodTiktokTokenService,
      accountRepo as unknown as PodTiktokAccountRepository,
      syncStatusRepo as unknown as PodShopSyncStatusRepository,
      { decrypt: () => 'PLAIN_SHOP_CIPHER' } as unknown as TiktokEncryptionService,
      lock as unknown as DistributedLockService,
      syncHooks as unknown as OrderSyncHookRegistry,
    );
  });

  it('gọi Get Order Detail với shop_cipher đã giải mã và ĐÚNG các TikTok order ID đã chọn', async () => {
    const outcome = await service.syncSelectedOrders(target(), refs(3));

    expect(orderClient.getOrderDetails).toHaveBeenCalledTimes(1);
    expect(orderClient.getOrderDetails).toHaveBeenCalledWith({
      shopCipher: 'PLAIN_SHOP_CIPHER',
      accessToken: 'plain-access',
      ids: ['T0', 'T1', 'T2'],
    });
    expect(outcome.results.map((r) => r.status)).toEqual(['SYNCED', 'SYNCED', 'SYNCED']);
    expect(outcome.updated).toBe(3);
    // Ghi qua cửa ingest duy nhất, nguồn MANUAL, đúng tenant/shop.
    expect(ingestion.ingestBatch).toHaveBeenCalledWith(expect.any(Array), {
      organizationId: ORG_ID,
      accountId: 'account-uuid',
      shopId: 'shop-uuid',
      source: 'MANUAL',
    });
  });

  it('🔴 chia lô ≤ 50 ID mỗi lời gọi, gọi TUẦN TỰ (120 đơn ⇒ 3 lời gọi 50/50/20)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    orderClient.getOrderDetails.mockImplementation(async ({ ids }: { ids: string[] }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { orders: ids.map(tiktokOrder) };
    });

    const outcome = await service.syncSelectedOrders(target(), refs(120));

    const sizes = orderClient.getOrderDetails.mock.calls.map(
      (call: [{ ids: string[] }]) => call[0].ids.length,
    );
    expect(sizes).toEqual([50, 50, 20]);
    expect(maxInFlight).toBe(1);
    expect(outcome.results).toHaveLength(120);
  });

  it('🔴 dùng CHUNG khoá shop với cron/sync thủ công — shop đang bận ⇒ SYNC_IN_PROGRESS, không gọi TikTok', async () => {
    lock.acquire.mockResolvedValueOnce(null);

    const outcome = await service.syncSelectedOrders(target(), refs(2));

    expect(lock.acquire).toHaveBeenCalledWith('pod:tiktok:sync:shop:shop-uuid', expect.any(Number));
    expect(orderClient.getOrderDetails).not.toHaveBeenCalled();
    expect(
      outcome.results.every((r) => r.status === 'FAILED' && r.errorCode === 'SYNC_IN_PROGRESS'),
    ).toBe(true);
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('thành công một phần: đơn TikTok không trả về ⇒ NOT_FOUND_ON_TIKTOK; đơn ghi lỗi ⇒ INGEST_FAILED', async () => {
    orderClient.getOrderDetails.mockResolvedValueOnce({
      orders: [tiktokOrder('T0'), tiktokOrder('T2')],
    });
    ingestion.ingestBatch.mockResolvedValueOnce({
      total: 2,
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 1,
      maxUpdateTime: 0n,
      failedTiktokOrderIds: ['T2'],
    });

    const outcome = await service.syncSelectedOrders(target(), refs(3));

    expect(outcome.results).toEqual([
      { id: 'id-0', tiktokOrderId: 'T0', status: 'SYNCED' },
      expect.objectContaining({ id: 'id-1', status: 'FAILED', errorCode: 'NOT_FOUND_ON_TIKTOK' }),
      expect.objectContaining({ id: 'id-2', status: 'FAILED', errorCode: 'INGEST_FAILED' }),
    ]);
  });

  it('🔴 lỗi TikTok (vd rate limit) ở MỘT lô chỉ làm hỏng lô đó — lô sau vẫn chạy', async () => {
    orderClient.getOrderDetails
      .mockRejectedValueOnce(
        new TiktokClientError(
          TiktokErrorClass.RATE_LIMIT,
          36009002,
          'Too many requests',
          429,
          undefined,
          'GET_ORDER_DETAIL',
        ),
      )
      .mockImplementationOnce(({ ids }: { ids: string[] }) =>
        Promise.resolve({ orders: ids.map(tiktokOrder) }),
      );

    const outcome = await service.syncSelectedOrders(target(), refs(60));

    const failed = outcome.results.filter((r) => r.status === 'FAILED');
    const synced = outcome.results.filter((r) => r.status === 'SYNCED');
    expect(failed).toHaveLength(50);
    expect(synced).toHaveLength(10);
    expect(failed[0].errorCode).toBe('36009002');
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('chỉ ghi đơn ĐƯỢC YÊU CẦU — đơn lạ trong phản hồi bị bỏ qua', async () => {
    orderClient.getOrderDetails.mockResolvedValueOnce({
      orders: [tiktokOrder('T0'), tiktokOrder('NOT_REQUESTED')],
    });

    await service.syncSelectedOrders(target(), refs(1));

    const written = callArg<Array<{ id: string }>>(ingestion.ingestBatch, 0, 0);
    expect(written.map((order) => order.id)).toEqual(['T0']);
  });

  it('token hỏng (cần kết nối lại) ⇒ mọi đơn của shop FAILED với lý do token, không gọi TikTok', async () => {
    tokenService.ensureValidAccessToken.mockResolvedValueOnce({
      ok: false,
      reason: 'REAUTH_REQUIRED',
      message: 'Cần kết nối lại',
    });

    const outcome = await service.syncSelectedOrders(target(), refs(2));

    expect(orderClient.getOrderDetails).not.toHaveBeenCalled();
    expect(outcome.results.map((r) => r.errorCode)).toEqual(['REAUTH_REQUIRED', 'REAUTH_REQUIRED']);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('🔴 KHÔNG chạm watermark / backfill / circuit breaker / Latest Sync Status, KHÔNG tự gọi hook', async () => {
    await service.syncSelectedOrders(target(), refs(5));

    for (const mock of Object.values(accountRepo)) expect(mock).not.toHaveBeenCalled();
    expect(syncStatusRepo.start).not.toHaveBeenCalled();
    expect(syncStatusRepo.finish).not.toHaveBeenCalled();
    expect(syncHooks.notifyOrdersSynced).not.toHaveBeenCalled();
    expect(orderClient.searchOrders).not.toHaveBeenCalled();
  });

  it('danh sách rỗng ⇒ không khoá, không gọi gì', async () => {
    const outcome = await service.syncSelectedOrders(target(), []);
    expect(outcome.results).toEqual([]);
    expect(lock.acquire).not.toHaveBeenCalled();
  });
});
