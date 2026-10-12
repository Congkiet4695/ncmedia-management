import {
  Prisma,
  PodProductSyncScope,
  PodProductSyncStatus,
  PodProductSyncTrigger,
  PodShopSyncType,
  PodSyncTrigger,
} from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import { TiktokErrorClass } from '../../pod-tiktok/constants/tiktok-error-code.constants';
import { TiktokClientError } from '../../pod-tiktok/exceptions/pod-tiktok.exceptions';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodShopSyncStatusRepository } from '../../pod-tiktok/repositories/pod-shop-sync-status.repository';
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
const RUN = {
  organizationId: ORG,
  shopId: SHOP,
  syncType: PodShopSyncType.PRODUCT,
  runId: '44444444-4444-4444-4444-444444444444',
  startedAt: new Date(),
};

/** Dữ liệu `finish` của dòng trạng thái (đối số thứ 2). */
interface FinishArg {
  status: string;
  totalCount: number;
  createdCount: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  details: { scope: PodProductSyncScope; productsDeactivated: number };
}

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
    findIdsByTiktokIds: jest.Mock;
  };
  let syncRepo: {
    findSyncTargets: jest.Mock;
    findSyncCandidates: jest.Mock;
    updateWatermark: jest.Mock;
    incrementFailure: jest.Mock;
  };
  /** Dòng "Latest Sync Status" (PRODUCT) của shop. */
  let syncStatus: { start: jest.Mock; finish: jest.Mock };
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
      findIdsByTiktokIds: jest.fn().mockResolvedValue(new Map()),
    };
    syncRepo = {
      findSyncTargets: jest.fn().mockResolvedValue([TARGET]),
      findSyncCandidates: jest.fn().mockResolvedValue([candidate()]),
      updateWatermark: jest.fn().mockResolvedValue(undefined),
      incrementFailure: jest.fn().mockResolvedValue(1),
    };
    syncStatus = {
      start: jest.fn().mockResolvedValue(RUN),
      finish: jest.fn().mockResolvedValue(true),
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
      syncStatus as unknown as PodShopSyncStatusRepository,
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

      expect(callArg<FinishArg>(syncStatus.finish, 0, 1).details.scope).toBe(
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

      expect(callArg<FinishArg>(syncStatus.finish, 0, 1).details.scope).toBe(
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
      expect(callArg<FinishArg>(syncStatus.finish, 0, 1).details.productsDeactivated).toBe(7);
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

  describe('Latest Sync Status (một dòng mỗi shop)', () => {
    it('lịch tự động (SCHEDULER) ⇒ ghi dòng PRODUCT với trigger CRON', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(syncStatus.start).toHaveBeenCalledTimes(1);
      const start = callArg<{ syncType: string; trigger: string; shopId: string }>(
        syncStatus.start,
        0,
        0,
      );
      expect(start).toMatchObject({ syncType: PodShopSyncType.PRODUCT, trigger: PodSyncTrigger.CRON, shopId: SHOP });
      // `finish` nhận đúng handle (fencing token) mà `start` trả về.
      expect(callArg(syncStatus.finish, 0, 0)).toBe(RUN);
    });

    it('Sync Now (MANUAL) ⇒ trigger MANUAL', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.MANUAL, triggeredBy: 'user-1' });

      expect(callArg<{ trigger: string; triggeredBy: string }>(syncStatus.start, 0, 0)).toMatchObject({
        trigger: PodSyncTrigger.MANUAL,
        triggeredBy: 'user-1',
      });
    });

    it('SUCCESS ⇒ XOÁ lỗi của lượt trước (errorCode / errorMessage = null)', async () => {
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      const finish = callArg<FinishArg>(syncStatus.finish, 0, 1);
      expect(finish.status).toBe('SUCCESS');
      expect(finish.errorCode).toBeNull();
      expect(finish.errorMessage).toBeNull();
    });

    it('lỗi TikTok ⇒ FAILED kèm mã + thông điệp lỗi', async () => {
      productApi.searchAllProducts.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'Request timeout', 0, 'req-x'),
      );

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      const finish = callArg<FinishArg>(syncStatus.finish, 0, 1);
      expect(finish.status).toBe('FAILED');
      expect(finish.errorMessage).toBeTruthy();
    });

    it('🔴 lượt SINGLE (làm mới MỘT sản phẩm) KHÔNG ghi đè trạng thái của shop', async () => {
      await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.MANUAL,
        tiktokProductId: 'p9',
      });

      expect(syncStatus.start).not.toHaveBeenCalled();
      expect(syncStatus.finish).not.toHaveBeenCalled();
    });
  });

  describe('ghi dữ liệu', () => {
    it('sản phẩm mới → tạo bản ghi, lưu payload gốc, số đếm vào trạng thái shop', async () => {
      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.SCHEDULER,
      });

      expect(outcome.created).toBe(2);
      expect(repo.upsertAggregate).toHaveBeenCalledTimes(2);
      expect(repo.saveRawData).toHaveBeenCalledTimes(2);

      const finish = callArg<FinishArg>(syncStatus.finish, 0, 1);
      expect(finish.totalCount).toBe(2);
      expect(finish.createdCount).toBe(2);
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
      expect(syncStatus.start).not.toHaveBeenCalled();
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
      syncRepo.findSyncCandidates.mockImplementation((params: { shopId: string }) =>
        Promise.resolve([candidate({ id: params.shopId })]),
      );

      const result = await service.runDueShopSyncs();

      expect(result.shops).toBe(2);
      // Mỗi shop: một lần chọn shop + một lần KIỂM LẠI trạng thái ngay trước khi gọi TikTok — mọi lần
      // đọc đều đúng MỘT shop, không bao giờ toàn cục.
      const scopes = syncRepo.findSyncCandidates.mock.calls.map((call: unknown[]) => call[0]);
      expect(scopes).toEqual([
        { shopId: 'shop-a' },
        { shopId: 'shop-a' },
        { shopId: 'shop-b' },
        { shopId: 'shop-b' },
      ]);
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
      expect(syncStatus.start).toHaveBeenCalledTimes(2);
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
      expect(syncStatus.start).not.toHaveBeenCalled();
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
      const finish = callArg<FinishArg>(syncStatus.finish, 0, 1);
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
  // ===========================================================================
  // PARTIAL — ghi nhận lỗi TỪNG sản phẩm, retry bước ghi, bộ đếm đúng
  // (docs/pod-product/07-product-sync-partial-fix.md)
  // ===========================================================================
  describe('Partial — lỗi từng sản phẩm (Latest Sync Status)', () => {
    /** `details` của lần `finish` đầu tiên. */
    const finishedDetails = () =>
      callArg<{
        details: {
          failedProducts?: Array<Record<string, unknown>>;
          failedProductsOmitted?: number;
        };
      }>(syncStatus.finish, 0, 1).details;
    const finished = () =>
      callArg<{
        status: string;
        totalCount: number;
        createdCount: number;
        updatedCount: number;
        skippedCount: number;
        failedCount: number;
      }>(syncStatus.finish, 0, 1);

    const prismaError = (code: string) =>
      new Prisma.PrismaClientKnownRequestError(`Lỗi Prisma ${code}\n   dòng hai`, {
        code,
        clientVersion: 'test',
      });

    beforeEach(() => {
      jest.spyOn(service as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue();
      // Danh sách của từng trạng thái TikTok: `mockResolvedValueOnce` = trạng thái ĐẦU (ACTIVATE),
      // các trạng thái còn lại rỗng — mỗi sản phẩm xuất hiện đúng một lần như dữ liệu thật.
      productApi.searchAllProducts.mockResolvedValue([]);
    });

    it('🔴 TC1/TC2 lô có cả thành công lẫn thất bại ⇒ PARTIAL, sản phẩm lỗi KHÔNG dừng các sản phẩm còn lại', async () => {
      productApi.searchAllProducts.mockResolvedValueOnce(
        ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, title: `SP ${id}` })),
      );
      productApi.getProduct.mockImplementation((_ctx: unknown, id: string) =>
        id === 'p2'
          ? Promise.reject(
              new TiktokClientError(TiktokErrorClass.BUSINESS, 12019001, 'Product not found', 200, 'req-p2'),
            )
          : Promise.resolve({ data: detail(id), requestId: `req-${id}` }),
      );

      const outcome = await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(outcome.status).toBe(PodProductSyncStatus.PARTIAL);
      // p1, p3 cùng lô với p2; p4, p5 ở lô SAU — vẫn được ghi.
      expect(repo.upsertAggregate).toHaveBeenCalledTimes(4);
      expect(finished()).toMatchObject({ status: 'PARTIAL', totalCount: 5, createdCount: 4, failedCount: 1 });
      // Còn sản phẩm lỗi ⇒ watermark KHÔNG tiến, lượt sau lấy lại.
      expect(syncRepo.updateWatermark).not.toHaveBeenCalled();
    });

    it('🔴 TC4/TC10 lỗi TikTok được lưu ĐỦ theo từng sản phẩm (mã, thông điệp, HTTP, request id, bước, id nội bộ, tên)', async () => {
      productApi.searchAllProducts.mockResolvedValueOnce([{ id: 'p1', title: 'Áo thun A' }, { id: 'p2' }]);
      productApi.getProduct.mockImplementation((_ctx: unknown, id: string) =>
        id === 'p1'
          ? Promise.reject(
              new TiktokClientError(TiktokErrorClass.BUSINESS, 12052700, 'seller inactive', 428, 'req-abc'),
            )
          : Promise.resolve({ data: detail(id), requestId: `req-${id}` }),
      );
      repo.findIdsByTiktokIds.mockResolvedValue(new Map([['p1', 'local-uuid-p1']]));

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(finishedDetails().failedProducts).toEqual([
        expect.objectContaining({
          tiktokProductId: 'p1',
          productId: 'local-uuid-p1',
          title: 'Áo thun A',
          step: 'FETCH_DETAIL',
          errorCode: '12052700',
          errorMessage: 'seller inactive',
          httpStatus: 428,
          tiktokRequestId: 'req-abc',
          retryable: false,
          attempts: 1,
        }),
      ]);
      expect(repo.findIdsByTiktokIds).toHaveBeenCalledWith(ORG, SHOP, ['p1']);
    });

    it('🔴 TC3/TC9 ánh xạ (mapping) lỗi ⇒ bước MAP được ghi rõ, không gọi ghi DB cho sản phẩm đó', async () => {
      productApi.searchAllProducts.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]);
      const mapper = service['mapper'];
      const original = mapper.toWriteData.bind(mapper);
      jest.spyOn(mapper, 'toWriteData').mockImplementation((d, raw) => {
        if ((d as { id: string }).id === 'p2') throw new Error('SKU thiếu id — payload không hợp lệ');
        return original(d, raw);
      });

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(repo.upsertAggregate).toHaveBeenCalledTimes(1);
      expect(finishedDetails().failedProducts).toEqual([
        expect.objectContaining({
          tiktokProductId: 'p2',
          title: 'SP p2',
          step: 'MAP',
          errorCode: null,
          errorMessage: 'SKU thiếu id — payload không hợp lệ',
        }),
      ]);
    });

    it('🔴 TC5/TC6/TC7 transaction hết giờ (P2028) rồi thử lại thành công ⇒ ghi MỘT lần, không đếm trùng, SUCCESS', async () => {
      productApi.searchAllProducts.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]);
      repo.upsertAggregate
        .mockRejectedValueOnce(prismaError('P2028'))
        .mockResolvedValue({ id: 'product-uuid', created: false });

      const outcome = await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      // Lần thử thứ hai là upsert theo khoá (tổ chức, shop, tiktok_product_id) ⇒ không sinh bản ghi trùng.
      expect(repo.upsertAggregate).toHaveBeenCalledTimes(3);
      expect(productApi.getProduct).toHaveBeenCalledTimes(2); // KHÔNG gọi lại TikTok khi thử lại bước ghi
      expect(outcome.status).toBe(PodProductSyncStatus.SUCCESS);
      const row = finished();
      expect(row).toMatchObject({ status: 'SUCCESS', totalCount: 2, updatedCount: 2, failedCount: 0 });
      expect(row.createdCount + row.updatedCount + row.skippedCount + row.failedCount).toBe(row.totalCount);
      expect(finishedDetails().failedProducts).toBeUndefined();
      expect(syncRepo.updateWatermark).toHaveBeenCalledTimes(1);
    });

    it('🔴 TC8 lỗi DB tạm thời lặp lại ⇒ dừng sau số lần thử tối đa, FAILED một lần, retryable, watermark giữ nguyên', async () => {
      productApi.searchAllProducts.mockResolvedValueOnce([{ id: 'p1' }]);
      repo.upsertAggregate.mockRejectedValue(prismaError('P2028'));

      const outcome = await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(repo.upsertAggregate).toHaveBeenCalledTimes(2); // POD_PRODUCT_SAVE_MAX_ATTEMPTS
      expect(outcome.status).toBe(PodProductSyncStatus.PARTIAL);
      expect(finished()).toMatchObject({ totalCount: 1, failedCount: 1 });
      expect(finishedDetails().failedProducts).toEqual([
        expect.objectContaining({
          step: 'SAVE',
          errorCode: 'P2028',
          errorMessage: 'Lỗi Prisma P2028 dòng hai',
          retryable: true,
          attempts: 2,
        }),
      ]);
      expect(syncRepo.updateWatermark).not.toHaveBeenCalled();
    });

    it('🔴 TC8 lỗi DB do DỮ LIỆU (P2002) ⇒ KHÔNG thử lại, ghi lỗi cần xử lý', async () => {
      productApi.searchAllProducts.mockResolvedValueOnce([{ id: 'p1' }]);
      repo.upsertAggregate.mockRejectedValue(prismaError('P2002'));

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(repo.upsertAggregate).toHaveBeenCalledTimes(1);
      expect(finishedDetails().failedProducts).toEqual([
        expect.objectContaining({ step: 'SAVE', errorCode: 'P2002', retryable: false, attempts: 1 }),
      ]);
    });

    it('chi tiết có trần 100 sản phẩm — phần vượt chỉ được đếm, `failedCount` vẫn ĐỦ', async () => {
      const ids = Array.from({ length: 103 }, (_v, index) => `p${index}`);
      productApi.searchAllProducts.mockResolvedValueOnce(ids.map((id) => ({ id })));
      productApi.getProduct.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.SERVER, 36009003, 'Internal error', 500, 'req'),
      );

      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(finished().failedCount).toBe(103);
      expect(finishedDetails().failedProducts).toHaveLength(100);
      expect(finishedDetails().failedProductsOmitted).toBe(3);
    });

    it('lượt không có sản phẩm lỗi ⇒ không có `failedProducts` (xoá danh sách của lượt trước)', async () => {
      productApi.searchAllProducts.mockResolvedValueOnce([{ id: 'p1' }]);
      await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(finished().status).toBe('SUCCESS');
      expect(finishedDetails().failedProducts).toBeUndefined();
    });
  });

  // ===========================================================================
  // SHOP INACTIVE — không đồng bộ sản phẩm TỰ ĐỘNG
  // ===========================================================================
  describe('Shop INACTIVE — đồng bộ tự động', () => {
    /** Kho shop giả: `findSyncCandidates({ shopId })` trả đúng shop đó (như truy vấn thật). */
    function shopStore(initial: ReturnType<typeof candidate>[]) {
      const shops = new Map(initial.map((shop) => [shop.id, shop]));
      syncRepo.findSyncCandidates.mockImplementation((params: { shopId?: string }) =>
        Promise.resolve(
          params.shopId ? [shops.get(params.shopId)].filter(Boolean) : [...shops.values()],
        ),
      );
      return {
        setStatus: (id: string, status: 'ACTIVE' | 'INACTIVE' | 'DEAUTHORIZED') => {
          const shop = shops.get(id);
          if (shop) shops.set(id, { ...shop, status });
        },
        remove: (id: string) => shops.delete(id),
      };
    }

    const searchedShops = () =>
      productApi.searchAllProducts.mock.calls.map(
        (_call, index) => callArg<{ shopId: string }>(productApi.searchAllProducts, index, 0).shopId,
      );

    it('🔴 TC11/TC13 scheduler chỉ đồng bộ shop ACTIVE — shop INACTIVE không phát sinh lời gọi TikTok, không ghi trạng thái', async () => {
      shopStore([candidate({ id: 'shop-a' }), candidate({ id: 'shop-b', status: 'INACTIVE' })]);

      const outcomes = await service.syncShops({}, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(outcomes.map((o) => [o.shopId, o.status, o.skipReason])).toEqual([
        ['shop-a', PodProductSyncStatus.SUCCESS, undefined],
        ['shop-b', 'SKIPPED', 'SHOP_INACTIVE'],
      ]);
      expect(searchedShops()).toEqual(MANAGED_TIKTOK_STATUSES.map(() => 'shop-a'));
      expect(productApi.getProduct.mock.calls.every((call: unknown[]) => (call[0] as { shopId: string }).shopId === 'shop-a')).toBe(true);
      expect(syncStatus.start).toHaveBeenCalledTimes(1);
      expect(syncRepo.incrementFailure).not.toHaveBeenCalled();
    });

    it('🔴 TC12 shop INACTIVE KHÔNG được đưa vào hàng đợi đồng bộ tự động', async () => {
      shopStore([candidate({ id: 'shop-b', status: 'INACTIVE' })]);

      await expect(service.scheduleShopSync('shop-b')).resolves.toBeNull();
      expect(queue.schedule).not.toHaveBeenCalled();
    });

    it('shop ACTIVE vẫn được hẹn đồng bộ sau publish như cũ', async () => {
      shopStore([candidate({ id: 'shop-a' })]);

      await expect(service.scheduleShopSync('shop-a')).resolves.toBeInstanceOf(Date);
      expect(queue.schedule).toHaveBeenCalledWith('shop-a', expect.any(Number), expect.any(Number));
    });

    it('🔴 TC14 shop chuyển INACTIVE SAU lúc chọn shop, TRƯỚC khi worker chạy ⇒ bỏ qua, không gọi TikTok, không ghi lịch sử', async () => {
      const store = shopStore([candidate({ id: 'shop-a' }), candidate({ id: 'shop-b' })]);
      // Shop A đang chạy thì Shop Sync đánh dấu shop B INACTIVE.
      productApi.searchAllProducts.mockImplementation((ctx: { shopId: string }) => {
        if (ctx.shopId === 'shop-a') store.setStatus('shop-b', 'INACTIVE');
        return Promise.resolve([]);
      });
      service['settings'].shopConcurrency = 1;

      const outcomes = await service.syncShops({}, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(outcomes.map((o) => [o.shopId, o.status, o.skipReason])).toEqual([
        ['shop-a', PodProductSyncStatus.SUCCESS, undefined],
        ['shop-b', 'SKIPPED', 'SHOP_INACTIVE'],
      ]);
      expect(new Set(searchedShops())).toEqual(new Set(['shop-a']));
      expect(syncStatus.start).toHaveBeenCalledTimes(1);
      expect(syncRepo.incrementFailure).not.toHaveBeenCalled();
    });

    it('🔴 TC14 worker hàng đợi: shop đã INACTIVE lúc tới hạn ⇒ bỏ qua và KHÔNG hẹn lại (TC15)', async () => {
      shopStore([candidate({ id: 'shop-b', status: 'INACTIVE' })]);
      queue.claimDue.mockResolvedValue(['shop-b']);

      const result = await service.runDueShopSyncs();

      expect(result).toEqual({ shops: 1, failed: 0 });
      expect(productApi.searchAllProducts).not.toHaveBeenCalled();
      expect(queue.requeue).not.toHaveBeenCalled();
    });

    it('🔴 TC15 lỗi KHÔNG tạm thời (12052700 seller inactive) ⇒ worker KHÔNG hẹn lại vô hạn', async () => {
      shopStore([candidate({ id: SHOP })]);
      queue.claimDue.mockResolvedValue([SHOP]);
      productApi.searchAllProducts.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 12052700, 'seller inactive', 428, 'req'),
      );

      const result = await service.runDueShopSyncs();

      expect(result.failed).toBe(1);
      expect(queue.requeue).not.toHaveBeenCalled();
    });

    it('lỗi TẠM THỜI (mạng) ⇒ worker vẫn hẹn lại như cũ', async () => {
      shopStore([candidate({ id: SHOP })]);
      queue.claimDue.mockResolvedValue([SHOP]);
      productApi.searchAllProducts.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.NETWORK, 0, 'Request timeout', 0, undefined),
      );

      await service.runDueShopSyncs();

      expect(queue.requeue).toHaveBeenCalledWith(SHOP, 5 * 60 * 1000);
    });

    it('🔴 TC16 shop chuyển lại ACTIVE ⇒ đồng bộ ở chu kỳ kế tiếp', async () => {
      const store = shopStore([candidate({ id: 'shop-b', status: 'INACTIVE' })]);

      const first = await service.syncShops({}, { trigger: PodProductSyncTrigger.SCHEDULER });
      store.setStatus('shop-b', 'ACTIVE');
      const second = await service.syncShops({}, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(first[0].status).toBe('SKIPPED');
      expect(second[0].status).toBe(PodProductSyncStatus.SUCCESS);
      expect(new Set(searchedShops())).toEqual(new Set(['shop-b']));
    });

    it('shop bị xoá giữa lượt theo lịch ⇒ SHOP_NOT_FOUND, không gọi TikTok', async () => {
      const store = shopStore([candidate({ id: SHOP })]);
      store.remove(SHOP);

      const outcome = await service.syncShop(TARGET, { trigger: PodProductSyncTrigger.SCHEDULER });

      expect(outcome).toMatchObject({ status: 'SKIPPED', skipReason: 'SHOP_NOT_FOUND' });
      expect(productApi.searchAllProducts).not.toHaveBeenCalled();
    });

    it('🔴 TC17 đồng bộ THỦ CÔNG giữ nguyên hành vi: không kiểm lại trạng thái trong `syncShop`', async () => {
      shopStore([candidate({ id: SHOP, status: 'INACTIVE' })]);

      // Đường "đồng bộ lại 1 sản phẩm" / sửa sản phẩm gọi thẳng syncShop với target đã chọn sẵn.
      const outcome = await service.syncShop(TARGET, {
        trigger: PodProductSyncTrigger.MANUAL,
        tiktokProductId: 'p9',
      });

      expect(outcome.status).toBe(PodProductSyncStatus.SUCCESS);
      expect(syncRepo.findSyncCandidates).not.toHaveBeenCalled();
      expect(productApi.getProduct).toHaveBeenCalledTimes(1);
    });

    it('🔴 TC17 "Sync Products" thủ công vẫn phân loại như trước (INACTIVE ⇒ SKIPPED kèm lý do)', async () => {
      shopStore([candidate({ id: 'shop-a' }), candidate({ id: 'shop-b', status: 'INACTIVE' })]);

      const outcomes = await service.syncShops(
        { organizationId: ORG },
        { trigger: PodProductSyncTrigger.MANUAL },
      );

      expect(outcomes.map((o) => [o.shopId, o.status, o.skipReason])).toEqual([
        ['shop-a', PodProductSyncStatus.SUCCESS, undefined],
        ['shop-b', 'SKIPPED', 'SHOP_INACTIVE'],
      ]);
      // Thủ công: chỉ MỘT lần đọc danh sách (không có lần kiểm lại riêng từng shop).
      expect(syncRepo.findSyncCandidates).toHaveBeenCalledTimes(1);
    });

    it('🔴 TC18 shop lỗi + shop INACTIVE không ảnh hưởng shop ACTIVE khác (lượt theo lịch)', async () => {
      shopStore([
        candidate({ id: 'shop-a' }),
        candidate({ id: 'shop-b', status: 'INACTIVE' }),
        candidate({ id: 'shop-c' }),
      ]);
      productApi.searchAllProducts.mockImplementation((ctx: { shopId: string }) =>
        ctx.shopId === 'shop-a'
          ? Promise.reject(new TiktokClientError(TiktokErrorClass.SERVER, 36009003, 'boom', 500, 'r'))
          : Promise.resolve([{ id: `${ctx.shopId}-p1` }]),
      );

      const outcomes = await service.syncShops({}, { trigger: PodProductSyncTrigger.SCHEDULER });
      const byShop = Object.fromEntries(outcomes.map((o) => [o.shopId, o.status]));

      expect(byShop).toEqual({
        'shop-a': PodProductSyncStatus.FAILED,
        'shop-b': 'SKIPPED',
        'shop-c': PodProductSyncStatus.SUCCESS,
      });
    });
  });
  // ===========================================================================
  // Lượt SINGLE — "Re-sync this product"
  // ===========================================================================
  describe('lượt SINGLE (đồng bộ lại một sản phẩm)', () => {
    const SINGLE = { trigger: PodProductSyncTrigger.MANUAL, tiktokProductId: 'p-single' };
    const prismaTimeout = () =>
      new Prisma.PrismaClientKnownRequestError('Transaction already closed', {
        code: 'P2028',
        clientVersion: 'test',
      });

    beforeEach(() => {
      jest.spyOn(service as unknown as { sleep: () => Promise<void> }, 'sleep').mockResolvedValue();
    });

    it('🔴 TC1/TC2 gọi Get Product cho ĐÚNG sản phẩm, ghi vào ĐÚNG shop / kết nối, không quét danh sách shop', async () => {
      const outcome = await service.syncShop(TARGET, SINGLE);

      expect(productApi.searchAllProducts).not.toHaveBeenCalled();
      expect(productApi.getProduct).toHaveBeenCalledWith(expect.objectContaining({ shopId: SHOP }), 'p-single');
      expect(repo.upsertAggregate).toHaveBeenCalledTimes(1);
      expect([0, 1, 2, 4].map((index) => callArg<unknown>(repo.upsertAggregate, 0, index))).toEqual([
        ORG,
        ACCOUNT,
        SHOP,
        null,
      ]);
      const mapped = callArg<{ product: { tiktokProductId: string; title: string } }>(repo.upsertAggregate, 0, 3);
      expect(mapped.product).toMatchObject({ tiktokProductId: 'p-single', title: 'SP p-single' });
      expect(outcome).toMatchObject({ status: PodProductSyncStatus.SUCCESS, created: 1, failed: 0, failures: [] });
      // SINGLE không ghi đè dòng trạng thái của SHOP và không đẩy watermark của shop.
      expect(syncStatus.start).not.toHaveBeenCalled();
      expect(syncRepo.updateWatermark).not.toHaveBeenCalled();
    });

    it('🔴 TC4 TikTok lỗi ⇒ KHÔNG ghi gì (lastSyncedAt chỉ ghi trong upsert), không đổi trạng thái "ngừng bán", trả chi tiết lỗi', async () => {
      productApi.getProduct.mockRejectedValue(
        new TiktokClientError(TiktokErrorClass.BUSINESS, 12019001, 'Product not found', 200, 'req-x'),
      );

      const outcome = await service.syncShop(TARGET, SINGLE);

      expect(repo.upsertAggregate).not.toHaveBeenCalled();
      expect(repo.reactivateSeen).not.toHaveBeenCalled();
      expect(outcome.status).toBe(PodProductSyncStatus.PARTIAL);
      expect(outcome.failures).toEqual([
        expect.objectContaining({ step: 'FETCH_DETAIL', errorCode: '12019001', tiktokRequestId: 'req-x' }),
      ]);
    });

    it('🔴 TC5/TC10 ghi DB lỗi (transaction hết giờ, kể cả sau khi thử lại) ⇒ báo lỗi bước SAVE, không báo thành công', async () => {
      repo.upsertAggregate.mockRejectedValue(prismaTimeout());

      const outcome = await service.syncShop(TARGET, SINGLE);

      expect(outcome).toMatchObject({ failed: 1, updated: 0, created: 0 });
      expect(outcome.failures?.[0]).toMatchObject({ step: 'SAVE', errorCode: 'P2028', attempts: 2 });
      expect(repo.saveRawData).not.toHaveBeenCalled();
      expect(repo.reactivateSeen).not.toHaveBeenCalled();
    });

    it('🔴 TC8/TC9 sản phẩm từng lỗi, nguyên nhân đã hết ⇒ lần sau thành công, ghi theo CÙNG khoá (không tạo bản ghi mới)', async () => {
      repo.upsertAggregate.mockRejectedValue(prismaTimeout());
      const first = await service.syncShop(TARGET, SINGLE);

      repo.upsertAggregate.mockReset().mockResolvedValue({ id: 'product-uuid', created: false });
      const second = await service.syncShop(TARGET, SINGLE);
      const third = await service.syncShop(TARGET, SINGLE);

      expect(first.failed).toBe(1);
      expect(second).toMatchObject({ status: PodProductSyncStatus.SUCCESS, updated: 1, failed: 0 });
      expect(third).toMatchObject({ updated: 1, created: 0 });
      // Mọi lần ghi cùng (tổ chức, shop, tiktok_product_id) — upsert, không nhân bản.
      const keys = repo.upsertAggregate.mock.calls.map(
        (call: unknown[]) => `${call[0] as string}|${call[2] as string}|${(call[3] as { product: { tiktokProductId: string } }).product.tiktokProductId}`,
      );
      expect(new Set(keys)).toEqual(new Set([`${ORG}|${SHOP}|p-single`]));
    });

    it('🔴 TC12 đang có lượt khác của shop (cron / Sync Now) ⇒ LOCKED, không gọi TikTok', async () => {
      lock.acquire.mockResolvedValue(null);

      const outcome = await service.syncShop(TARGET, SINGLE);

      expect(outcome.status).toBe('LOCKED');
      expect(productApi.getProduct).not.toHaveBeenCalled();
    });
  });
});
