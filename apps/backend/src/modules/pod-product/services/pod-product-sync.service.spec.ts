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

function detail(id: string, updateTime = 1_700_600_000) {
  return { id, title: `SP ${id}`, status: 'ACTIVATE', updateTime, skus: [] };
}

describe('PodProductSyncService', () => {
  let service: PodProductSyncService;
  let repo: {
    findHashes: jest.Mock;
    upsertAggregate: jest.Mock;
    saveRawData: jest.Mock;
  };
  let syncRepo: {
    findSyncTargets: jest.Mock;
    startHistory: jest.Mock;
    finishHistory: jest.Mock;
    insertLogs: jest.Mock;
    updateWatermark: jest.Mock;
    incrementFailure: jest.Mock;
  };
  let productApi: { searchAllProducts: jest.Mock; getProduct: jest.Mock };
  let lock: { acquire: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    repo = {
      findHashes: jest.fn().mockResolvedValue(new Map()),
      upsertAggregate: jest.fn().mockResolvedValue({ id: 'product-uuid', created: true }),
      saveRawData: jest.fn().mockResolvedValue(undefined),
    };
    syncRepo = {
      findSyncTargets: jest.fn().mockResolvedValue([TARGET]),
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
    lock = {
      acquire: jest.fn().mockResolvedValue({ key: 'k', fenceToken: 'f' }),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const tokenService = {
      ensureValidAccessToken: jest.fn().mockResolvedValue({ ok: true, accessToken: 'token' }),
    } as unknown as PodTiktokTokenService;
    const encryption = { decrypt: jest.fn(() => 'shop-cipher') } as unknown as TiktokEncryptionService;

    service = new PodProductSyncService(
      repo as unknown as PodProductRepository,
      syncRepo as unknown as PodProductSyncRepository,
      new PodProductMapper(),
      productApi as unknown as TiktokProductApiService,
      tokenService,
      encryption,
      lock as unknown as DistributedLockService,
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
      expect(callArg<Record<string, unknown>>(productApi.searchAllProducts, 0, 1)).toEqual({});
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
              new TiktokClientError(TiktokErrorClass.BUSINESS, 12345, 'Không đọc được', 200, 'req-x'),
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

  describe('syncShops — nhiều shop', () => {
    it('chạy tuần tự từng shop và gom kết quả', async () => {
      syncRepo.findSyncTargets.mockResolvedValue([TARGET, { ...TARGET, id: 'shop-2' }]);

      const outcomes = await service.syncShops(
        { organizationId: ORG },
        { trigger: PodProductSyncTrigger.MANUAL },
      );

      expect(outcomes).toHaveLength(2);
      expect(syncRepo.findSyncTargets).toHaveBeenCalledWith({ organizationId: ORG });
    });
  });
});
