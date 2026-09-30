import {
  PodProductSyncAction,
  PodProductSyncScope,
  PodProductSyncStatus,
  PodProductSyncTrigger,
} from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodTiktokTokenService } from '../../pod-tiktok/services/pod-tiktok-token.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { TiktokProductApiService } from '../../tiktok-sdk/tiktok-product-api.service';
import { PodProductMapper } from '../mappers/pod-product.mapper';
import { PodProductRepository } from '../repositories/pod-product.repository';
import {
  PodProductSyncRepository,
  type ProductSyncTarget,
} from '../repositories/pod-product-sync.repository';
import { PodProductSyncQueue } from './pod-product-sync.queue';
import { PodProductSyncService } from './pod-product-sync.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const SHOP = '22222222-2222-2222-2222-222222222222';
const ACCOUNT = '33333333-3333-3333-3333-333333333333';
const HISTORY = '44444444-4444-4444-4444-444444444444';

const TARGET: ProductSyncTarget = {
  id: SHOP,
  organizationId: ORG,
  accountId: ACCOUNT,
  tiktokShopId: '7000714532876273420',
  shopCipherEnc: 'v1.cipher',
  name: 'NCMedia US Store',
  productSyncCursor: 1_700_000_000n,
  account: {
    id: ACCOUNT,
    organizationId: ORG,
    accountName: 'NCMedia US Store',
    accessTokenEnc: 'v1.access',
    accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
    refreshTokenEnc: 'v1.refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000),
  },
};

/** Shop đủ điều kiện ở dạng "ứng viên" (kèm trạng thái shop + kết nối) của `findSyncCandidates`. */
function candidate(
  overrides: {
    id?: string;
    name?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'DEAUTHORIZED';
    accountStatus?: 'ACTIVE' | 'REAUTH_REQUIRED' | 'DISCONNECTED';
    productSyncEnabled?: boolean;
  } = {},
) {
  return {
    ...TARGET,
    id: overrides.id ?? TARGET.id,
    name: overrides.name ?? TARGET.name,
    status: overrides.status ?? 'ACTIVE',
    productSyncEnabled: overrides.productSyncEnabled ?? true,
    account: { ...TARGET.account, status: overrides.accountStatus ?? 'ACTIVE' },
  };
}

/** Thứ tự trạng thái TikTok được quét — nguồn: `POD_PRODUCT_STATUS_MAP`. */
const MANAGED_TIKTOK_STATUSES = [
  'ACTIVATE',
  'PENDING',
  'SELLER_DEACTIVATED',
  'PLATFORM_DEACTIVATED',
  'FAILED',
  'FREEZE',
];

function detail(id: string, updateTime = 1_700_600_000, status = 'ACTIVATE') {
  return { id, title: `SP ${id}`, status, updateTime, skus: [] };
}

describe('PodProductSyncService', () => {
  let service: PodProductSyncService;
  let repo: {
    findHashes: jest.Mock;
    upsertAggregate: jest.Mock;
    saveRawData: jest.Mock;
    deactivateMissing: jest.Mock;
    reactivateSeen: jest.Mock;
  };
  let syncRepo: {
    findSyncTargets: jest.Mock;
    findSyncCandidates: jest.Mock;
    startHistory: jest.Mock;
    finishHistory: jest.Mock;
    insertLogs: jest.Mock;
    updateWatermark: jest.Mock;
    incrementFailure: jest.Mock;
  };
  let productApi: { searchAllProducts: jest.Mock; getProduct: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };
  /** Hàng đợi hoãn theo shop — kiểm chứng "publish shop nào thì hẹn đúng shop đó". */
  let queue: { schedule: jest.Mock; claimDue: jest.Mock; requeue: jest.Mock };

  beforeEach(() => {
    repo = {
      findHashes: jest.fn().mockResolvedValue(new Map()),
      upsertAggregate: jest.fn().mockResolvedValue({ id: 'product-uuid', created: true }),
      saveRawData: jest.fn().mockResolvedValue(undefined),
      deactivateMissing: jest.fn().mockResolvedValue(0),
      reactivateSeen: jest.fn().mockResolvedValue(0),
    };
    syncRepo = {
      findSyncTargets: jest.fn().mockResolvedValue([TARGET]),
      findSyncCandidates: jest.fn().mockResolvedValue([candidate()]),
      startHistory: jest.fn().mockResolvedValue(HISTORY),
      finishHistory: jest.fn().mockResolvedValue(undefined),
      insertLogs: jest.fn().mockResolvedValue(undefined),
      updateWatermark: jest.fn().mockResolvedValue(undefined),
      incrementFailure: jest.fn().mockResolvedValue(1),
    };
    productApi = {
      searchAllProducts: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
      getProduct: jest.fn((_ctx: unknown, id: string) =>
        Promise.resolve({ data: detail(id), requestId: `req-${id}` }),
      ),
    };
    queue = {
      schedule: jest.fn().mockResolvedValue(new Date()),
      claimDue: jest.fn().mockResolvedValue([]),
      requeue: jest.fn().mockResolvedValue(undefined),
    };
    lock = {
      acquire: jest.fn().mockResolvedValue({ key: 'k', fenceToken: 'f' }),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const tokenService = {
      ensureValidAccessToken: jest.fn().mockResolvedValue({ ok: true, accessToken: 'token' }),
    } as unknown as PodTiktokTokenService;
    const encryption = {
      decrypt: jest.fn(() => 'shop-cipher'),
    } as unknown as TiktokEncryptionService;

    service = new PodProductSyncService(
      repo as unknown as PodProductRepository,
      syncRepo as unknown as PodProductSyncRepository,
      new PodProductMapper(),
      productApi as unknown as TiktokProductApiService,
      tokenService,
      encryption,
      lock as unknown as DistributedLockService,
      queue as unknown as PodProductSyncQueue,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);
  });

  describe('phạm vi đồng bộ', () => {
    it('đã có watermark → INCREMENTAL và truyền `updateTimeGe` có trừ overlap', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(callArg<{ scope: PodProductSyncScope }>(syncRepo.startHistory, 0, 0).scope).toBe(
        PodProductSyncScope.INCREMENTAL,
      );
      const filter = callArg<{ updateTimeGe?: number }>(productApi.searchAllProducts, 0, 1);
      // 1_700_000_000 − 300 giây overlap.
      expect(filter.updateTimeGe).toBe(1_699_999_700);
    });

    it('chưa có watermark → FULL và KHÔNG lọc theo thời gian', async () => {
      await service.syncShop(
        { ...TARGET, productSyncCursor: null },
        { trigger: PodProductSyncTrigger.SCHEDULER },
      );

      expect(callArg<{ scope: PodProductSyncScope }>(syncRepo.startHistory, 0, 0).scope).toBe(
        PodProductSyncScope.FULL,
      );
      // 🔴 Không còn `{}`: bộ lọc trạng thái được áp NGAY TẠI REQUEST, không có `updateTimeGe`.
      expect(callArg<Record<string, unknown>>(productApi.searchAllProducts, 0, 1)).toEqual({
        status: 'ACTIVATE',
      });
    });

    it('chỉ định một sản phẩm → SINGLE, KHÔNG gọi Search Products', async () => {
      await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.MANUAL,
        tiktokProductId: 'p9',
      });

      expect(productApi.searchAllProducts).not.toHaveBeenCalled();
      expect(productApi.getProduct).toHaveBeenCalledWith(expect.anything(), 'p9');
    });
  });

  describe('trạng thái được quản lý (ACTIVE · REVIEWING · DEACTIVATED · NEEDS_ATTENTION)', () => {
    it('🔴 MỖI trạng thái TikTok được quản lý MỘT lượt Search — lọc tại request, KHÔNG dùng ALL', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      const statuses = productApi.searchAllProducts.mock.calls.map(
        (_call, index) => callArg<{ status?: string }>(productApi.searchAllProducts, index, 1).status,
      );
      expect(statuses).toEqual(MANAGED_TIKTOK_STATUSES);
      // DRAFT / DELETED không bao giờ được kéo về (82% bản ghi thật là DELETED).
      expect(statuses).not.toContain('DRAFT');
      expect(statuses).not.toContain('DELETED');
      expect(statuses).not.toContain('ALL');
    });

    it('lượt INCREMENTAL: mọi lượt quét giữ cả `status` lẫn `updateTimeGe`', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      productApi.searchAllProducts.mock.calls.forEach((_call, index) => {
        expect(
          callArg<{ status?: string; updateTimeGe?: number }>(productApi.searchAllProducts, index, 1),
        ).toEqual({ status: MANAGED_TIKTOK_STATUSES[index], updateTimeGe: 1_699_999_700 });
      });
    });

    it('🔴 sản phẩm xuất hiện ở HAI danh sách (đổi trạng thái giữa lúc quét) ⇒ chỉ đọc/ghi MỘT lần', async () => {
      productApi.searchAllProducts.mockResolvedValue([{ id: 'p1' }]);

      const outcome = await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(productApi.getProduct).toHaveBeenCalledTimes(1);
      expect(repo.upsertAggregate).toHaveBeenCalledTimes(1);
      expect(outcome.fetched).toBe(1);
    });

    it.each([
      ['ACTIVATE'],
      ['PENDING'],
      ['SELLER_DEACTIVATED'],
      ['PLATFORM_DEACTIVATED'],
      ['FAILED'],
      ['FREEZE'],
    ])('🔴 status %s ⇒ lưu NGUYÊN chuỗi TikTok (nhóm tính khi đọc)', async (status) => {
      productApi.searchAllProducts.mockResolvedValue([{ id: 'p1' }]);
      productApi.getProduct.mockResolvedValue({ data: detail('p1', 1, status), requestId: 'r' });

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      const mapped = callArg<{ product: { status: string } }>(repo.upsertAggregate, 0, 3);
      expect(mapped.product.status).toBe(status);
    });

    it('🔴 status ngoài bảng ánh xạ ⇒ log/flag, KHÔNG quy về ACTIVATE', async () => {
      productApi.searchAllProducts.mockResolvedValue([{ id: 'p1' }]);
      productApi.getProduct.mockResolvedValue({ data: detail('p1', 1, 'SOMETHING_NEW'), requestId: 'r' });
      const warn = jest.spyOn(service['logger'], 'warn');

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      const mapped = callArg<{ product: { status: string } }>(repo.upsertAggregate, 0, 3);
      expect(mapped.product.status).toBe('SOMETHING_NEW');
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'sync.product.status.unmapped',
          tiktokStatus: 'SOMETHING_NEW',
        }),
      );
    });

    it('🔴 lượt FULL: sản phẩm không còn trong danh sách nào ⇒ đánh dấu rời tập quản lý', async () => {
      productApi.searchAllProducts.mockResolvedValue([detail('p1'), detail('p2')]);
      repo.deactivateMissing.mockResolvedValue(7);

      const outcome = await service.syncShop(
        { ...TARGET, productSyncCursor: null },
        { trigger: PodProductSyncTrigger.MANUAL },
      );

      // Chỉ đụng đúng shop này, và chỉ những sản phẩm KHÔNG nằm trong lượt quét.
      expect(repo.deactivateMissing).toHaveBeenCalledWith(ORG, SHOP, ['p1', 'p2']);
      expect(outcome.deactivated).toBe(7);
      expect(
        callArg<{ productsDeactivated?: number }>(syncRepo.finishHistory, 0, 1)
          .productsDeactivated,
      ).toBe(7);
    });

    it('🔴 lượt INCREMENTAL KHÔNG đối soát — "không đổi" không đồng nghĩa "ngừng bán"', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(repo.deactivateMissing).not.toHaveBeenCalled();
    });

    it('🔴 sản phẩm bán lại nhưng nội dung KHÔNG đổi ⇒ vẫn được gỡ dấu ngừng bán', async () => {
      // Đường ghi bỏ qua sản phẩm có payloadHash không đổi, nên nếu chỉ dựa vào
      // `upsertAggregate` thì sản phẩm này mắc kẹt ở trạng thái ngừng bán vĩnh viễn.
      const mapper = new PodProductMapper();
      const knownHash = mapper.toWriteData(detail('p1'), detail('p1')).product.payloadHash;
      productApi.searchAllProducts.mockResolvedValue([detail('p1')]);
      repo.findHashes.mockResolvedValue(new Map([['p1', knownHash]]));
      repo.reactivateSeen.mockResolvedValue(1);

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(repo.reactivateSeen).toHaveBeenCalledWith(ORG, SHOP, ['p1']);
      expect(repo.upsertAggregate).not.toHaveBeenCalled();
    });

    it('gỡ dấu ngừng bán chạy ở MỌI phạm vi, kể cả INCREMENTAL', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(repo.reactivateSeen).toHaveBeenCalled();
      expect(repo.deactivateMissing).not.toHaveBeenCalled();
    });

    it('lượt SINGLE cũng KHÔNG đối soát', async () => {
      await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.MANUAL,
        tiktokProductId: 'p9',
      });

      expect(repo.deactivateMissing).not.toHaveBeenCalled();
    });
  });

  describe('ghi dữ liệu', () => {
    it('sản phẩm mới → tạo bản ghi, lưu payload gốc, ghi log CREATED', async () => {
      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.SCHEDULER,
      });

      expect(outcome.created).toBe(2);
      expect(repo.upsertAggregate).toHaveBeenCalledTimes(2);
      expect(repo.saveRawData).toHaveBeenCalledTimes(2);

      const logs = callArg<Array<{ action: PodProductSyncAction }>>(syncRepo.insertLogs, 0, 0);
      expect(logs).toHaveLength(2);
      expect(logs.every((log) => log.action === PodProductSyncAction.CREATED)).toBe(true);
    });

    it('🔴 payload không đổi → BỎ QUA, không ghi DB (tiết kiệm ghi + giữ idempotent)', async () => {
      const mapper = new PodProductMapper();
      const knownHash = mapper.toWriteData(detail('p1'), detail('p1')).product.payloadHash;
      repo.findHashes.mockResolvedValue(new Map([['p1', knownHash]]));
      productApi.searchAllProducts.mockResolvedValue([{ id: 'p1' }]);

      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.SCHEDULER,
      });

      expect(outcome.skipped).toBe(1);
      expect(repo.upsertAggregate).not.toHaveBeenCalled();
    });
  });

  describe('fail-soft & watermark', () => {
    it('một sản phẩm lỗi → các sản phẩm còn lại vẫn được ghi, trạng thái PARTIAL', async () => {
      productApi.getProduct.mockImplementation((_ctx: unknown, id: string) =>
        id === 'p1'
          ? Promise.reject(
              new TiktokClientError(
                TiktokErrorClass.BUSINESS,
                12345,
                'Không đọc được',
                200,
                'req-x',
              ),
            )
          : Promise.resolve({ data: detail(id), requestId: 'req-ok' }),
      );

      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.SCHEDULER,
      });

      expect(outcome.failed).toBe(1);
      expect(outcome.created).toBe(1);
      expect(outcome.status).toBe(PodProductSyncStatus.PARTIAL);
      // 🔴 Còn sản phẩm lỗi ⇒ KHÔNG được đẩy watermark, nếu không sẽ bỏ sót vĩnh viễn.
      expect(syncRepo.updateWatermark).not.toHaveBeenCalled();
    });

    it('mọi sản phẩm thành công → SUCCESS và đẩy watermark', async () => {
      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.SCHEDULER,
      });

      expect(outcome.status).toBe(PodProductSyncStatus.SUCCESS);
      expect(syncRepo.updateWatermark).toHaveBeenCalledWith(SHOP, expect.any(BigInt));
    });

    it('lượt SINGLE thành công cũng KHÔNG đẩy watermark (chỉ đồng bộ một sản phẩm)', async () => {
      await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.MANUAL,
        tiktokProductId: 'p9',
      });

      expect(syncRepo.updateWatermark).not.toHaveBeenCalled();
    });

    it('lỗi ở tầng shop (token hỏng) → FAILED, tăng bộ đếm lỗi, không ném ra ngoài', async () => {
      (service['tokenService'].ensureValidAccessToken as jest.Mock).mockResolvedValue({
        ok: false,
        reason: 'REAUTH_REQUIRED',
        message: 'Refresh token đã hết hạn',
      });

      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.SCHEDULER,
      });

      expect(outcome.status).toBe(PodProductSyncStatus.FAILED);
      expect(syncRepo.incrementFailure).toHaveBeenCalledWith(SHOP);
      expect(syncRepo.updateWatermark).not.toHaveBeenCalled();
    });
  });

  describe('khoá theo shop', () => {
    it('không giành được khoá → bỏ qua, KHÔNG gọi TikTok', async () => {
      lock.acquire.mockResolvedValue(null);

      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.SCHEDULER,
      });

      expect(outcome.status).toBe('LOCKED');
      expect(productApi.searchAllProducts).not.toHaveBeenCalled();
      expect(syncRepo.startHistory).not.toHaveBeenCalled();
    });

    it('luôn nhả khoá kể cả khi lượt chạy lỗi', async () => {
      productApi.searchAllProducts.mockRejectedValue(new Error('sập mạng'));

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(lock.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('hàng đợi hoãn theo shop (sau publish listing)', () => {
    it('scheduleShopSync ⇒ hẹn ĐÚNG shop đó, 5 phút, có trần chờ', async () => {
      await service.scheduleShopSync(SHOP);

      expect(queue.schedule).toHaveBeenCalledWith(SHOP, 5 * 60 * 1000, 15 * 60 * 1000);
    });

    it('🔴 Redis hỏng KHÔNG ném ra ngoài — publish đã thành công rồi', async () => {
      queue.schedule.mockRejectedValue(new Error('Redis down'));

      await expect(service.scheduleShopSync(SHOP)).resolves.toBeNull();
    });

    it('🔴 đến hạn ⇒ syncShops({ shopId }) — ĐÚNG shop đó, KHÔNG phải toàn cục', async () => {
      queue.claimDue.mockResolvedValue([SHOP]);

      await service.runDueShopSyncs();

      // Phạm vi phải là ĐÚNG một shop. `{}` ở đây nghĩa là quét mọi shop của mọi tổ chức —
      // đúng thứ yêu cầu cấm.
      const filter = callArg<{ shopId?: string; organizationId?: string }>(
        syncRepo.findSyncCandidates,
        0,
        0,
      );
      expect(filter).toEqual({ shopId: SHOP });
    });

    it('🔴 nhiều shop đến hạn ⇒ mỗi shop MỘT lượt riêng, không gom chung', async () => {
      queue.claimDue.mockResolvedValue(['shop-a', 'shop-b']);

      const result = await service.runDueShopSyncs();

      expect(result.shops).toBe(2);
      expect(syncRepo.findSyncCandidates).toHaveBeenCalledTimes(2);
      expect(callArg(syncRepo.findSyncCandidates, 0, 0)).toEqual({ shopId: 'shop-a' });
      expect(callArg(syncRepo.findSyncCandidates, 1, 0)).toEqual({ shopId: 'shop-b' });
    });

    it('hàng đợi rỗng ⇒ không gọi TikTok, không tạo lịch sử đồng bộ nào', async () => {
      queue.claimDue.mockResolvedValue([]);

      const result = await service.runDueShopSyncs();

      expect(result).toEqual({ shops: 0, failed: 0 });
      expect(syncRepo.findSyncCandidates).not.toHaveBeenCalled();
    });

    it('lượt đồng bộ FAILED ⇒ hẹn lại shop đó, các shop khác không bị ảnh hưởng', async () => {
      queue.claimDue.mockResolvedValue([SHOP]);
      // Token hỏng ⇒ `syncShop` trả outcome FAILED (không ném).
      productApi.searchAllProducts.mockRejectedValue(new Error('token hỏng'));

      const result = await service.runDueShopSyncs();

      expect(result.failed).toBe(1);
      expect(queue.requeue).toHaveBeenCalledWith(SHOP, 5 * 60 * 1000);
    });
  });

  describe('syncShops — nhiều shop', () => {
    it('chạy từng shop và gom kết quả theo đúng thứ tự', async () => {
      syncRepo.findSyncCandidates.mockResolvedValue([candidate(), candidate({ id: 'shop-2' })]);

      const outcomes = await service.syncShops(
        { organizationId: ORG },
        { trigger: PodProductSyncTrigger.MANUAL },
      );

      expect(outcomes.map((outcome) => outcome.shopId)).toEqual([SHOP, 'shop-2']);
      expect(syncRepo.findSyncCandidates).toHaveBeenCalledWith({ organizationId: ORG });
    });

    /** Shop nào đã thực sự được gọi TikTok (ctx.shopId của lời gọi Search). */
    const searchedShops = () =>
      productApi.searchAllProducts.mock.calls.map(
        (_call, index) => callArg<{ shopId: string }>(productApi.searchAllProducts, index, 0).shopId,
      );

    it('🔴 có shop INACTIVE ⇒ SKIPPED + lý do, KHÔNG gọi TikTok cho shop đó, shop khác vẫn chạy', async () => {
      syncRepo.findSyncCandidates.mockResolvedValue([
        candidate({ id: 'shop-a' }),
        candidate({ id: 'shop-c', status: 'INACTIVE' }),
        candidate({ id: 'shop-d' }),
      ]);

      const outcomes = await service.syncShops({ organizationId: ORG }, { trigger: PodProductSyncTrigger.MANUAL });

      expect(outcomes.map((outcome) => [outcome.shopId, outcome.status, outcome.skipReason])).toEqual([
        ['shop-a', PodProductSyncStatus.SUCCESS, undefined],
        ['shop-c', 'SKIPPED', 'SHOP_INACTIVE'],
        ['shop-d', PodProductSyncStatus.SUCCESS, undefined],
      ]);
      expect(new Set(searchedShops())).toEqual(new Set(['shop-a', 'shop-d']));
      // Shop bỏ qua không tạo lịch sử, không tăng bộ đếm lỗi.
      expect(syncRepo.startHistory).toHaveBeenCalledTimes(2);
      expect(syncRepo.incrementFailure).not.toHaveBeenCalled();
    });

    it('🔴 nhiều shop không đủ điều kiện ⇒ mỗi shop một lý do riêng', async () => {
      syncRepo.findSyncCandidates.mockResolvedValue([
        candidate({ id: 'shop-c', status: 'INACTIVE' }),
        candidate({ id: 'shop-e', status: 'DEAUTHORIZED' }),
        candidate({ id: 'shop-f', accountStatus: 'REAUTH_REQUIRED' }),
        candidate({ id: 'shop-g', accountStatus: 'DISCONNECTED', status: 'INACTIVE' }),
        candidate({ id: 'shop-h', productSyncEnabled: false }),
      ]);

      const outcomes = await service.syncShops({ organizationId: ORG }, { trigger: PodProductSyncTrigger.MANUAL });

      expect(outcomes.map((outcome) => outcome.skipReason)).toEqual([
        'SHOP_INACTIVE',
        'SHOP_DEAUTHORIZED',
        'ACCOUNT_REAUTH_REQUIRED',
        // Kết nối chết là nguyên nhân gốc — báo trước lý do cấp shop.
        'ACCOUNT_DISCONNECTED',
        'PRODUCT_SYNC_DISABLED',
      ]);
      expect(productApi.searchAllProducts).not.toHaveBeenCalled();
    });

    it('🔴 ACTIVE + INACTIVE + lỗi API cùng lúc ⇒ A/B/E xong, C bỏ qua, D lỗi riêng', async () => {
      syncRepo.findSyncCandidates.mockResolvedValue([
        candidate({ id: 'shop-a' }),
        candidate({ id: 'shop-b' }),
        candidate({ id: 'shop-c', status: 'INACTIVE' }),
        candidate({ id: 'shop-d' }),
        candidate({ id: 'shop-e' }),
      ]);
      productApi.searchAllProducts.mockImplementation((ctx: { shopId: string }) =>
        ctx.shopId === 'shop-d'
          ? Promise.reject(
              new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'Request timeout', 0, undefined),
            )
          : Promise.resolve([{ id: `${ctx.shopId}-p1` }]),
      );

      const outcomes = await service.syncShops({ organizationId: ORG }, { trigger: PodProductSyncTrigger.MANUAL });

      const byShop = Object.fromEntries(outcomes.map((outcome) => [outcome.shopId, outcome]));
      expect(byShop['shop-a'].status).toBe(PodProductSyncStatus.SUCCESS);
      expect(byShop['shop-b'].status).toBe(PodProductSyncStatus.SUCCESS);
      expect(byShop['shop-c'].status).toBe('SKIPPED');
      expect(byShop['shop-d'].status).toBe(PodProductSyncStatus.FAILED);
      expect(byShop['shop-d'].errorMessage).toBe('Request timeout');
      expect(byShop['shop-e'].status).toBe(PodProductSyncStatus.SUCCESS);
      // Chỉ shop lỗi tăng bộ đếm lỗi.
      expect(syncRepo.incrementFailure).toHaveBeenCalledTimes(1);
      expect(syncRepo.incrementFailure).toHaveBeenCalledWith('shop-d');
      // 🔴 Product của shop A ghi vào ĐÚNG shop A — không lẫn sang shop khác.
      repo.upsertAggregate.mock.calls.forEach((_call, index) => {
        const shopId = callArg<string>(repo.upsertAggregate, index, 2);
        const mapped = callArg<{ product: { tiktokProductId: string } }>(repo.upsertAggregate, index, 3);
        expect(mapped.product.tiktokProductId.startsWith(shopId)).toBe(true);
      });
    });
  });

  describe('ngân sách thời gian của lượt thủ công', () => {
    afterEach(() => jest.restoreAllMocks());

    it('🔴 hết hạn chót trước khi bắt đầu ⇒ DEFERRED + vào hàng đợi nền, KHÔNG gọi TikTok', async () => {
      syncRepo.findSyncCandidates.mockResolvedValue([candidate({ id: 'shop-a' })]);

      const outcomes = await service.syncShops(
        { organizationId: ORG },
        { trigger: PodProductSyncTrigger.MANUAL, deadlineAt: Date.now() - 1 },
      );

      expect(outcomes[0].status).toBe('DEFERRED');
      expect(queue.schedule).toHaveBeenCalledWith('shop-a', 0, 0);
      expect(productApi.searchAllProducts).not.toHaveBeenCalled();
      expect(syncRepo.startHistory).not.toHaveBeenCalled();
    });

    it('🔴 hết giờ GIỮA lúc ghi ⇒ dừng giữa các lô, PARTIAL + mã rõ ràng, không đẩy watermark, vào hàng đợi', async () => {
      let now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
      productApi.searchAllProducts.mockResolvedValue(
        ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id })),
      );
      productApi.getProduct.mockImplementation((_ctx: unknown, id: string) => {
        now += 1_000; // mỗi lời gọi "tốn" 1 giây
        return Promise.resolve({ data: detail(id), requestId: 'r' });
      });

      const outcomes = await service.syncShops(
        { organizationId: ORG },
        { trigger: PodProductSyncTrigger.MANUAL, deadlineAt: 1_000_500 },
      );

      // Lô đầu (3 sản phẩm) chạy trọn, lô sau không bắt đầu.
      expect(productApi.getProduct).toHaveBeenCalledTimes(3);
      expect(outcomes[0].status).toBe('DEFERRED');
      const finish = callArg<{ status: string; errorCode?: string }>(syncRepo.finishHistory, 0, 1);
      expect(finish.status).toBe(PodProductSyncStatus.PARTIAL);
      expect(finish.errorCode).toBe('SYNC_DEADLINE_EXCEEDED');
      expect(syncRepo.updateWatermark).not.toHaveBeenCalled();
      // Hết giờ KHÔNG phải lỗi TikTok ⇒ không kích circuit breaker.
      expect(syncRepo.incrementFailure).not.toHaveBeenCalled();
      expect(queue.schedule).toHaveBeenCalledWith(SHOP, 0, 0);
    });

    it('không có hạn chót (scheduler / worker) ⇒ chạy trọn vẹn', async () => {
      productApi.searchAllProducts.mockResolvedValue(
        ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id })),
      );

      const outcomes = await service.syncShops({ organizationId: ORG }, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(productApi.getProduct).toHaveBeenCalledTimes(5);
      expect(outcomes[0].status).toBe(PodProductSyncStatus.SUCCESS);
      expect(queue.schedule).not.toHaveBeenCalled();
    });
  });
});
