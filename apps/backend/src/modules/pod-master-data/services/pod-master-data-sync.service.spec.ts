import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PodResourceSyncStatus, PodResourceType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodProductCatalogService } from '../../pod-product/services/pod-product-catalog.service';
import { PodProductSyncRepository } from '../../pod-product/repositories/pod-product-sync.repository';
import { POD_MASTER_DATA_SYNC_PROGRESS_KEY } from '../constants/pod-master-data.constants';
import { PodMasterDataSyncService } from './pod-master-data-sync.service';

/**
 * Unit test — PodMasterDataSyncService.
 *
 * 🔴 Năm bảo đảm được canh gác ở đây, mỗi cái ứng với một cách hệ thống có thể hỏng nặng:
 *
 *   1. Đúng thứ tự CATEGORY → BRAND → CATEGORY_ATTRIBUTE (thuộc tính lấy theo danh mục).
 *   2. Một lượt tại một thời điểm — không giành được khoá thì 409, KHÔNG xếp hàng chạy tiếp.
 *   3. Lượt hỏng KHÔNG phá dữ liệu đang có và KHÔNG đẩy `lastSyncAt` lên.
 *   4. Không có shop nguồn ⇒ nói thẳng, không im lặng báo "thành công 0 bản ghi".
 *   5. `sync()` trả 202 NGAY và chạy nền: khoá luôn được trả lại, tiến độ có trong `status()`.
 */

const SOURCE_SHOP = { id: 'shop-1', organizationId: 'org-1', account: {}, shopCipherEnc: 'enc' };
const LOCK = { key: 'pod:master-data:sync:lock', fenceToken: 'fence-1' };

const BRAND_SUMMARY = {
  records: 15_145,
  inserted: 15_145,
  updated: 0,
  databaseTotal: 15_145,
  apiCalls: 200,
  fetched: 16_000,
  prefixes: 30,
  cappedPrefixes: 1,
  refinedPrefixes: 0,
  incomplete: [],
  failed: [],
  durationMs: 1000,
  warning: null as string | null,
};

describe('PodMasterDataSyncService', () => {
  let service: PodMasterDataSyncService;

  const prisma = {
    podMasterDataSync: { findMany: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    podMasterDataSyncLog: { findMany: jest.fn(), create: jest.fn() },
    podProductCategory: { count: jest.fn() },
    podProductBrand: { count: jest.fn() },
    podCategoryAttribute: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  const catalog = {
    buildContext: jest.fn(),
    syncGlobalCategories: jest.fn(),
    syncGlobalBrands: jest.fn(),
    syncGlobalCategoryAttributes: jest.fn(),
  };
  const syncRepo = { findSyncTargets: jest.fn() };
  const lock = { acquire: jest.fn(), release: jest.fn(), renew: jest.fn() };
  const redisStore = new Map<string, string>();
  const redis = {
    client: {
      set: jest.fn((key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve('OK');
      }),
      get: jest.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
      del: jest.fn((key: string) => {
        redisStore.delete(key);
        return Promise.resolve(1);
      }),
    },
  };

  /** Bấm Sync rồi đợi lượt nền chạy xong — trả về cả xác nhận 202 lẫn kết quả cuối. */
  async function syncAndWait(dto: Parameters<PodMasterDataSyncService['sync']>[1] = {}) {
    const started = await service.sync('super-admin-1', dto);
    const result = await service.waitForInFlight();
    return { started, result: result! };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    redisStore.clear();

    catalog.buildContext.mockResolvedValue({ accessToken: 't', shopCipher: 'c', shopId: 'shop-1' });
    catalog.syncGlobalCategories.mockResolvedValue(11_892);
    catalog.syncGlobalBrands.mockResolvedValue({ ...BRAND_SUMMARY });
    catalog.syncGlobalCategoryAttributes.mockResolvedValue(115);
    syncRepo.findSyncTargets.mockResolvedValue([SOURCE_SHOP]);
    prisma.podMasterDataSync.upsert.mockResolvedValue({});
    prisma.$transaction.mockResolvedValue([]);
    // Mặc định: giành được khoá ⇒ chạy thật.
    lock.acquire.mockResolvedValue(LOCK);
    lock.release.mockResolvedValue(undefined);
    lock.renew.mockResolvedValue(true);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PodMasterDataSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: PodProductCatalogService, useValue: catalog },
        { provide: PodProductSyncRepository, useValue: syncRepo },
        { provide: DistributedLockService, useValue: lock },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = moduleRef.get(PodMasterDataSyncService);
  });

  // -------------------------------------------------------------------------
  // Đồng bộ
  // -------------------------------------------------------------------------

  it('chạy đủ ba tài nguyên ĐÚNG thứ tự phụ thuộc', async () => {
    const { result } = await syncAndWait();

    expect(result.status).toBe(PodResourceSyncStatus.SUCCESS);
    expect(result.totalRecords).toBe(11_892 + 15_145 + 115);
    expect(result.details.map((detail) => detail.resource)).toEqual([
      PodResourceType.CATEGORY,
      PodResourceType.BRAND,
      PodResourceType.CATEGORY_ATTRIBUTE,
    ]);
  });

  it('🔴 `sync()` trả về NGAY (202) với jobId, tài nguyên đầu đã RUNNING, lượt tiếp tục ở nền', async () => {
    // Treo bước BRAND cho tới khi test cho phép — để quan sát trạng thái "đang chạy nền".
    let releaseBrand!: () => void;
    const brandPending = new Promise<typeof BRAND_SUMMARY>((resolve) => {
      releaseBrand = () => resolve({ ...BRAND_SUMMARY });
    });
    catalog.syncGlobalBrands.mockImplementation(() => brandPending);

    const started = await service.sync('super-admin-1', {});

    expect(started.status).toBe(PodResourceSyncStatus.RUNNING);
    expect(started.jobId).toEqual(expect.any(String));
    expect(started.resources).toEqual([
      PodResourceType.CATEGORY,
      PodResourceType.BRAND,
      PodResourceType.CATEGORY_ATTRIBUTE,
    ]);
    // Tài nguyên đầu tiên đã được đánh dấu RUNNING TRƯỚC khi trả 202 — giao diện polling
    // ngay sau đó phải thấy lượt đang chạy.
    const firstUpsert = prisma.podMasterDataSync.upsert.mock.calls[0] as [
      { where: { provider_resource: { resource: PodResourceType } } },
    ];
    expect(firstUpsert[0].where.provider_resource.resource).toBe(PodResourceType.CATEGORY);
    // Khoá vẫn đang giữ khi lượt còn chạy.
    expect(lock.release).not.toHaveBeenCalled();

    releaseBrand();
    const result = await service.waitForInFlight();

    expect(result?.status).toBe(PodResourceSyncStatus.SUCCESS);
    expect(lock.release).toHaveBeenCalledWith(LOCK);
  });

  it('🔴 client truyền thứ tự ngược ⇒ vẫn chạy theo thứ tự phụ thuộc', async () => {
    const { result } = await syncAndWait({
      resources: [PodResourceType.CATEGORY_ATTRIBUTE, PodResourceType.CATEGORY],
    });

    expect(result.details.map((detail) => detail.resource)).toEqual([
      PodResourceType.CATEGORY,
      PodResourceType.CATEGORY_ATTRIBUTE,
    ]);
    expect(catalog.syncGlobalBrands).not.toHaveBeenCalled();
  });

  it('🔴 đang có lượt khác chạy ⇒ 409, KHÔNG chạy lượt thứ hai', async () => {
    lock.acquire.mockResolvedValue(null); // không giành được khoá

    await expect(service.sync('super-admin-1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(catalog.syncGlobalCategories).not.toHaveBeenCalled();
    expect(await service.waitForInFlight()).toBeNull();
  });

  it('không có shop nguồn hợp lệ ⇒ 404 nói rõ lý do, không báo "thành công 0 bản ghi" — và trả lại khoá', async () => {
    syncRepo.findSyncTargets.mockResolvedValue([]);

    await expect(service.sync('super-admin-1', {})).rejects.toBeInstanceOf(NotFoundException);
    // Hỏng TRƯỚC khi chạy nền thì khoá phải được trả ngay, không đợi TTL.
    expect(lock.release).toHaveBeenCalledWith(LOCK);
  });

  it('🔴 TikTok hỏng ở BRAND ⇒ PARTIAL, các tài nguyên khác vẫn chạy, lỗi giữ nguyên văn', async () => {
    catalog.syncGlobalBrands.mockRejectedValue(new Error('TikTok 429 rate limited'));

    const { result } = await syncAndWait();

    expect(result.status).toBe(PodResourceSyncStatus.PARTIAL);
    expect(result.error).toContain('TikTok 429 rate limited');
    // Danh mục vẫn được ghi — một lượt hỏng KHÔNG cuốn theo phần đã thành công.
    expect(result.details.find((d) => d.resource === PodResourceType.CATEGORY)?.records).toBe(
      11_892,
    );
    // Và không có bước xoá nào cả: dữ liệu cũ nguyên vẹn.
    expect(JSON.stringify(prisma.$transaction.mock.calls)).not.toContain('deleteMany');
  });

  it('🔴 quét thương hiệu THIẾU một phần (prefix hỏng) ⇒ BRAND là PARTIAL kèm cảnh báo, không phải SUCCESS', async () => {
    catalog.syncGlobalBrands.mockResolvedValue({
      ...BRAND_SUMMARY,
      failed: [{ prefix: 'qx', error: 'TikTok 500' }],
      warning: 'Đồng bộ thương hiệu chưa trọn vẹn: 1 prefix hỏng ("qx": TikTok 500)',
    });

    const { result } = await syncAndWait({ resources: [PodResourceType.BRAND] });

    expect(result.status).toBe(PodResourceSyncStatus.PARTIAL);
    expect(result.details[0].status).toBe(PodResourceSyncStatus.PARTIAL);
    expect(result.details[0].records).toBe(15_145);
    expect(result.error).toContain('1 prefix hỏng');

    // PARTIAL vẫn đã ghi dữ liệu mới ⇒ `lastSyncAt` nhích lên, nhưng lỗi được giữ để hiển thị.
    const calls = prisma.podMasterDataSync.update.mock.calls as Array<[{ data: Record<string, unknown> }]>;
    expect(calls[0][0].data.status).toBe(PodResourceSyncStatus.PARTIAL);
    expect(calls[0][0].data.lastSyncAt).toBeInstanceOf(Date);
    expect(calls[0][0].data.lastError).toContain('1 prefix hỏng');
  });

  it('🔴 lượt hỏng KHÔNG đẩy `lastSyncAt` lên (nó trả lời "dữ liệu mới tới đâu")', async () => {
    catalog.syncGlobalCategories.mockRejectedValue(new Error('TikTok down'));

    await syncAndWait({ resources: [PodResourceType.CATEGORY] });

    const calls = prisma.podMasterDataSync.update.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    const updateArg = calls[0][0];
    expect(updateArg.data.status).toBe(PodResourceSyncStatus.FAILED);
    expect(updateArg.data).not.toHaveProperty('lastSyncAt');
    expect(updateArg.data.failedAt).toBeInstanceOf(Date);
  });

  it('ghi lại shop nguồn đã mượn token — để truy vết khi dữ liệu lệch', async () => {
    const { started, result } = await syncAndWait();
    expect(started.sourceShopId).toBe('shop-1');
    expect(result.sourceShopId).toBe('shop-1');
  });

  it('🔴 lỗi hạ tầng giữa lượt (database) ⇒ không tài nguyên nào kẹt RUNNING, khoá vẫn được trả', async () => {
    // Bước CHỐT trạng thái của CATEGORY hỏng đúng một lần ⇒ vòng lặp gãy trước BRAND / ATTRIBUTE.
    prisma.$transaction.mockRejectedValueOnce(new Error('database unavailable'));

    const { result } = await syncAndWait();

    // CATEGORY đã lấy dữ liệu thành công ⇒ giữ đúng kết quả của nó và được chốt LẠI;
    // hai tài nguyên chưa chạy bị đánh FAILED kèm lý do. Tổng thể là PARTIAL.
    expect(result.status).toBe(PodResourceSyncStatus.PARTIAL);
    expect(result.details.map((d) => d.status)).toEqual([
      PodResourceSyncStatus.SUCCESS,
      PodResourceSyncStatus.FAILED,
      PodResourceSyncStatus.FAILED,
    ]);
    expect(result.error).toContain('database unavailable');
    expect(catalog.syncGlobalBrands).not.toHaveBeenCalled();
    // Cả ba tài nguyên đều được chốt trạng thái (1 lần hỏng + 3 lần chốt lại thành công).
    expect(prisma.$transaction).toHaveBeenCalledTimes(4);
    expect(lock.release).toHaveBeenCalledWith(LOCK);
    // Tiến độ tạm được dọn để màn hình không hiện "đang chạy" cho một lượt đã chết.
    expect(redisStore.has(POD_MASTER_DATA_SYNC_PROGRESS_KEY)).toBe(false);
  });

  it('tiến độ quét thương hiệu được ghi vào Redis và dọn đi khi lượt kết thúc', async () => {
    let seenProgress: unknown = null;
    catalog.syncGlobalBrands.mockImplementation(
      async (_ctx: unknown, options: { onProgress: (p: unknown) => Promise<void> }) => {
        await options.onProgress({
          apiCalls: 1200,
          fetched: 98_000,
          emitted: 90_000,
          prefixesDone: 40,
          prefixesQueued: 88,
          activePrefixes: ['ma', 'sa'],
          elapsedMs: 60_000,
          inserted: 85_000,
        });
        seenProgress = JSON.parse(redisStore.get(POD_MASTER_DATA_SYNC_PROGRESS_KEY) ?? 'null');
        return { ...BRAND_SUMMARY };
      },
    );

    await syncAndWait({ resources: [PodResourceType.BRAND] });

    const progress = seenProgress as {
      resource: string;
      apiCalls: number;
      fetched: number;
      records: number;
      detail: string;
    };
    expect(progress.resource).toBe(PodResourceType.BRAND);
    expect(progress.apiCalls).toBe(1200);
    expect(progress.fetched).toBe(98_000);
    expect(progress.records).toBe(85_000);
    expect(progress.detail).toContain('"ma", "sa"');
    expect(redisStore.has(POD_MASTER_DATA_SYNC_PROGRESS_KEY)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Trạng thái
  // -------------------------------------------------------------------------

  describe('status', () => {
    beforeEach(() => {
      prisma.podMasterDataSync.findMany.mockResolvedValue([]);
      prisma.podProductCategory.count.mockResolvedValue(11_892);
      prisma.podProductBrand.count.mockResolvedValue(15_145);
      prisma.podCategoryAttribute.count.mockResolvedValue(115);
    });

    it('đếm THẬT trong database, không đọc con số của lượt sync cuối', async () => {
      const status = await service.status(true);

      expect(status.resources.map((r) => r.totalRecords)).toEqual([11_892, 15_145, 115]);
      expect(status.canSync).toBe(true);
    });

    it('🔴 Admin tổ chức xem được số liệu nhưng `canSync = false`', async () => {
      const status = await service.status(false);

      expect(status.canSync).toBe(false);
      // Vẫn thấy đầy đủ dữ liệu — giấu đi chỉ khiến họ tưởng hệ thống trống.
      expect(status.resources).toHaveLength(3);
      expect(status.resources[0].totalRecords).toBe(11_892);
    });

    it('chưa có danh mục ⇒ CATEGORY_ATTRIBUTE bị khoá kèm lý do', async () => {
      prisma.podProductCategory.count.mockResolvedValue(0);

      const status = await service.status(true);
      const attributes = status.resources.find(
        (r) => r.resource === PodResourceType.CATEGORY_ATTRIBUTE,
      );

      expect(attributes?.ready).toBe(false);
      expect(attributes?.dependsOn).toBe(PodResourceType.CATEGORY);
    });

    it('tài nguyên RUNNING mang `progress` của ĐÚNG lượt đó; tài nguyên khác thì null', async () => {
      prisma.podMasterDataSync.findMany.mockResolvedValue([
        { resource: PodResourceType.BRAND, status: PodResourceSyncStatus.RUNNING, jobId: 'job-9' },
      ]);
      redisStore.set(
        POD_MASTER_DATA_SYNC_PROGRESS_KEY,
        JSON.stringify({
          jobId: 'job-9',
          resource: PodResourceType.BRAND,
          apiCalls: 500,
          fetched: 40_000,
          records: 38_000,
          detail: 'prefix "ma" · 12 xong · 80 chờ',
          updatedAt: new Date().toISOString(),
        }),
      );

      const status = await service.status(true);
      const brand = status.resources.find((r) => r.resource === PodResourceType.BRAND);
      const category = status.resources.find((r) => r.resource === PodResourceType.CATEGORY);

      expect(brand?.status).toBe(PodResourceSyncStatus.RUNNING);
      expect(brand?.progress).toEqual(expect.objectContaining({ apiCalls: 500, records: 38_000 }));
      expect(category?.progress).toBeNull();
    });

    it('tiến độ của lượt CŨ (jobId khác) không được gán cho lượt mới', async () => {
      prisma.podMasterDataSync.findMany.mockResolvedValue([
        { resource: PodResourceType.BRAND, status: PodResourceSyncStatus.RUNNING, jobId: 'job-new' },
      ]);
      redisStore.set(
        POD_MASTER_DATA_SYNC_PROGRESS_KEY,
        JSON.stringify({ jobId: 'job-old', resource: PodResourceType.BRAND, apiCalls: 1 }),
      );

      const status = await service.status(true);

      expect(status.resources.find((r) => r.resource === PodResourceType.BRAND)?.progress).toBeNull();
    });
  });
});
