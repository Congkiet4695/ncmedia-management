import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PodResourceSyncStatus, PodResourceType } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { DistributedLockService } from '../../pod-tiktok/infra/distributed-lock.service';
import { PodProductCatalogService } from '../../pod-product/services/pod-product-catalog.service';
import { PodProductSyncRepository } from '../../pod-product/repositories/pod-product-sync.repository';
import { PodMasterDataSyncService } from './pod-master-data-sync.service';

/**
 * Unit test — PodMasterDataSyncService.
 *
 * 🔴 Bốn bảo đảm được canh gác ở đây, mỗi cái ứng với một cách hệ thống có thể hỏng nặng:
 *
 *   1. Đúng thứ tự CATEGORY → BRAND → CATEGORY_ATTRIBUTE (thuộc tính lấy theo danh mục).
 *   2. Một lượt tại một thời điểm — không giành được khoá thì 409, KHÔNG xếp hàng chạy tiếp.
 *   3. Lượt hỏng KHÔNG phá dữ liệu đang có và KHÔNG đẩy `lastSyncAt` lên.
 *   4. Không có shop nguồn ⇒ nói thẳng, không im lặng báo "thành công 0 bản ghi".
 */

const SOURCE_SHOP = { id: 'shop-1', organizationId: 'org-1', account: {}, shopCipherEnc: 'enc' };

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
  const lock = { withLock: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    catalog.buildContext.mockResolvedValue({ accessToken: 't', shopCipher: 'c', shopId: 'shop-1' });
    catalog.syncGlobalCategories.mockResolvedValue(11_892);
    catalog.syncGlobalBrands.mockResolvedValue(15_145);
    catalog.syncGlobalCategoryAttributes.mockResolvedValue(115);
    syncRepo.findSyncTargets.mockResolvedValue([SOURCE_SHOP]);
    prisma.podMasterDataSync.upsert.mockResolvedValue({});
    prisma.$transaction.mockResolvedValue([]);
    // Mặc định: giành được khoá ⇒ chạy thật.
    lock.withLock.mockImplementation((_key: string, _ttl: number, task: () => unknown) => task());

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PodMasterDataSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: PodProductCatalogService, useValue: catalog },
        { provide: PodProductSyncRepository, useValue: syncRepo },
        { provide: DistributedLockService, useValue: lock },
      ],
    }).compile();

    service = moduleRef.get(PodMasterDataSyncService);
  });

  // -------------------------------------------------------------------------
  // Đồng bộ
  // -------------------------------------------------------------------------

  it('chạy đủ ba tài nguyên ĐÚNG thứ tự phụ thuộc', async () => {
    const result = await service.sync('super-admin-1', {});

    expect(result.status).toBe(PodResourceSyncStatus.SUCCESS);
    expect(result.totalRecords).toBe(11_892 + 15_145 + 115);
    expect(result.details.map((detail) => detail.resource)).toEqual([
      PodResourceType.CATEGORY,
      PodResourceType.BRAND,
      PodResourceType.CATEGORY_ATTRIBUTE,
    ]);
  });

  it('🔴 client truyền thứ tự ngược ⇒ vẫn chạy theo thứ tự phụ thuộc', async () => {
    const result = await service.sync('super-admin-1', {
      resources: [PodResourceType.CATEGORY_ATTRIBUTE, PodResourceType.CATEGORY],
    });

    expect(result.details.map((detail) => detail.resource)).toEqual([
      PodResourceType.CATEGORY,
      PodResourceType.CATEGORY_ATTRIBUTE,
    ]);
    expect(catalog.syncGlobalBrands).not.toHaveBeenCalled();
  });

  it('🔴 đang có lượt khác chạy ⇒ 409, KHÔNG chạy lượt thứ hai', async () => {
    lock.withLock.mockResolvedValue(null); // không giành được khoá

    await expect(service.sync('super-admin-1', {})).rejects.toBeInstanceOf(ConflictException);
    expect(catalog.syncGlobalCategories).not.toHaveBeenCalled();
  });

  it('không có shop nguồn hợp lệ ⇒ 404 nói rõ lý do, không báo "thành công 0 bản ghi"', async () => {
    syncRepo.findSyncTargets.mockResolvedValue([]);

    await expect(service.sync('super-admin-1', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('🔴 TikTok hỏng ở BRAND ⇒ PARTIAL, các tài nguyên khác vẫn chạy, lỗi giữ nguyên văn', async () => {
    catalog.syncGlobalBrands.mockRejectedValue(new Error('TikTok 429 rate limited'));

    const result = await service.sync('super-admin-1', {});

    expect(result.status).toBe(PodResourceSyncStatus.PARTIAL);
    expect(result.error).toContain('TikTok 429 rate limited');
    // Danh mục vẫn được ghi — một lượt hỏng KHÔNG cuốn theo phần đã thành công.
    expect(result.details.find((d) => d.resource === PodResourceType.CATEGORY)?.records).toBe(
      11_892,
    );
    // Và không có bước xoá nào cả: dữ liệu cũ nguyên vẹn.
    expect(JSON.stringify(prisma.$transaction.mock.calls)).not.toContain('deleteMany');
  });

  it('🔴 lượt hỏng KHÔNG đẩy `lastSyncAt` lên (nó trả lời "dữ liệu mới tới đâu")', async () => {
    catalog.syncGlobalCategories.mockRejectedValue(new Error('TikTok down'));

    await service.sync('super-admin-1', { resources: [PodResourceType.CATEGORY] });

    const calls = prisma.podMasterDataSync.update.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    const updateArg = calls[0][0];
    expect(updateArg.data.status).toBe(PodResourceSyncStatus.FAILED);
    expect(updateArg.data).not.toHaveProperty('lastSyncAt');
    expect(updateArg.data.failedAt).toBeInstanceOf(Date);
  });

  it('ghi lại shop nguồn đã mượn token — để truy vết khi dữ liệu lệch', async () => {
    const result = await service.sync('super-admin-1', {});
    expect(result.sourceShopId).toBe('shop-1');
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
  });
});
