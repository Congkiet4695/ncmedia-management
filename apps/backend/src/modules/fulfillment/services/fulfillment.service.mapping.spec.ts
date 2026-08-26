import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, PodDesignPlacement } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import {
  POD_SCOPE_SYSTEM,
  type PodAccessScopeService,
} from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { StorageMapper } from '../../storage/storage.mapper';
import { FulfillmentMappingConflictException } from '../exceptions/fulfillment.exceptions';
import { ProductDesignMapper } from '../mappers/product-design.mapper';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

/**
 * Một file design đang hiệu lực ở vị trí `placement`.
 *
 * 🔴 Design khoá theo (Product ID + Seller SKU) và ĐỘC LẬP với ánh xạ — nên fixture mang
 * theo cặp khoá, không gắn vào bản ghi ánh xạ nữa.
 */
function design(placement: PodDesignPlacement, over: Record<string, unknown> = {}) {
  return {
    id: `design-${placement}`,
    placement,
    version: 1,
    tiktokProductId: 'TT-P1',
    sellerSku: 'SELLER-1',
    storageFile: {
      id: `file-${placement}`,
      publicUrl: `https://cdn.example/${placement}.png`,
      originalName: `${placement}.png`,
      mimeType: 'image/png',
      fileSize: 1024,
      uploadedAt: new Date('2026-01-02T00:00:00.000Z'),
      uploader: { fullName: 'Nguyễn Vận Hành' },
    },
    ...over,
  };
}

function mapping(over: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    organizationId: 'org-1',
    accountId: 'prov-1',
    provider: FulfillmentProvider.MANGO,
    tiktokProductId: 'TT-P1',
    tiktokSkuId: 'TT-S1',
    sellerSku: 'SELLER-1',
    providerSku: 'MANGO-SKU-1',
    baseCost: null,
    providerProductId: 'MP-1',
    providerVariantId: 'MV-1',
    providerProductName: 'Unisex Tee',
    providerVariantName: 'Black / L',
    providerColor: 'Black',
    providerSize: 'L',
    productionConfig: null,
    placementMap: null,
    isActive: true,
    note: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedBy: null,
    ...over,
  };
}

function build(repoOverrides: Record<string, jest.Mock> = {}) {
  const repo = {
    listMappingsPaged: jest.fn().mockResolvedValue({ items: [mapping()], total: 1 }),
    listAccounts: jest.fn().mockResolvedValue([{ id: 'prov-1', name: 'Mango US', isActive: true }]),
    listMappings: jest.fn().mockResolvedValue([mapping()]),
    listMappingsForOrganization: jest.fn().mockResolvedValue([mapping()]),
    listDistinctTiktokSkus: jest.fn().mockResolvedValue([]),
    // Design nạp riêng theo cặp khoá — không còn `include` qua ánh xạ.
    listProductDesigns: jest.fn().mockResolvedValue([]),
    findConflictingMapping: jest.fn().mockResolvedValue(null),
    createMapping: jest
      .fn()
      .mockImplementation((data: Record<string, unknown>) => Promise.resolve(mapping(data))),
    findMappingById: jest.fn().mockResolvedValue(mapping()),
    updateMapping: jest
      .fn()
      .mockImplementation((_id: string, data: Record<string, unknown>) =>
        Promise.resolve(mapping(data)),
      ),
    softDeleteMapping: jest.fn().mockResolvedValue(undefined),
    findActiveAccount: jest.fn().mockResolvedValue({ id: 'prov-1', name: 'Mango US' }),
    ...repoOverrides,
  } as unknown as FulfillmentRepository;

  const findUsers = jest.fn().mockResolvedValue([]);
  const prisma = { user: { findMany: findUsers } } as unknown as PrismaService;

  const designMapper = new ProductDesignMapper({
    buildDownloadUrl: (id: string) => `/api/v1/storage/${id}/download`,
  } as unknown as StorageMapper);

  const service = new FulfillmentService(
    { get: (_key: string, fallback?: string) => fallback ?? '' } as unknown as ConfigService,
    prisma,
    repo,
    {} as unknown as PodOrderRepository,
    {} as unknown as FulfillmentReadinessService,
    designMapper,
    encryption,
    {} as unknown as PodAccessScopeService,
  );
  return { service, repo: repo as unknown as Record<string, jest.Mock>, findUsers };
}

describe('FulfillmentService — ánh xạ sản phẩm', () => {
  describe('listMappingsPaged', () => {
    it('chuyển `status` thành cờ isActive khi truy vấn', async () => {
      const { service, repo } = build();

      await service.listMappingsPaged('org-1', { status: 'INACTIVE', page: 1, limit: 20 });

      const params = callArg<{ isActive?: boolean }>(repo.listMappingsPaged, 0, 0);
      expect(params.isActive).toBe(false);
    });

    it('không lọc theo trạng thái khi người dùng chọn "tất cả"', async () => {
      const { service, repo } = build();

      await service.listMappingsPaged('org-1', { page: 1, limit: 20 });

      const params = callArg<{ isActive?: boolean }>(repo.listMappingsPaged, 0, 0);
      expect(params.isActive).toBeUndefined();
    });

    it('truyền từ khoá tìm kiếm xuống repository', async () => {
      const { service, repo } = build();

      await service.listMappingsPaged('org-1', { search: 'SELLER', page: 1, limit: 20 });

      const params = callArg<{ keyword?: string }>(repo.listMappingsPaged, 0, 0);
      expect(params.keyword).toBe('SELLER');
    });

    it('trả meta phân trang đúng chuẩn và tên nhà cung cấp', async () => {
      const { service } = build({
        listMappingsPaged: jest.fn().mockResolvedValue({ items: [mapping()], total: 45 }),
      });

      const result = await service.listMappingsPaged('org-1', { page: 2, limit: 20 });

      expect(result.meta).toEqual({ total: 45, page: 2, limit: 20, totalPages: 3 });
      expect(result.items[0].providerName).toBe('Mango US');
      expect(result.items[0].status).toBe('ACTIVE');
    });

    it('nạp tên nhà cung cấp bằng MỘT truy vấn cho cả trang (không N+1)', async () => {
      const { service, repo } = build({
        listMappingsPaged: jest.fn().mockResolvedValue({
          items: [mapping(), mapping({ id: 'map-2' }), mapping({ id: 'map-3' })],
          total: 3,
        }),
      });

      await service.listMappingsPaged('org-1', { page: 1, limit: 20 });

      expect(repo.listAccounts).toHaveBeenCalledTimes(1);
    });

    it('nạp tên người sửa bằng MỘT truy vấn, khử trùng lặp theo id', async () => {
      const { service, findUsers } = build({
        listMappingsPaged: jest.fn().mockResolvedValue({
          items: [
            mapping({ updatedBy: 'user-1' }),
            mapping({ id: 'map-2', updatedBy: 'user-1' }),
            mapping({ id: 'map-3', updatedBy: 'user-2' }),
          ],
          total: 3,
        }),
      });
      findUsers.mockResolvedValue([
        { id: 'user-1', fullName: 'Người Một' },
        { id: 'user-2', fullName: 'Người Hai' },
      ]);

      const result = await service.listMappingsPaged('org-1', { page: 1, limit: 20 });

      expect(findUsers).toHaveBeenCalledTimes(1);
      const args = callArg<{ where: { id: { in: string[] } } }>(findUsers, 0, 0);
      expect(args.where.id.in).toEqual(['user-1', 'user-2']);
      expect(result.items.map((item) => item.updatedByName)).toEqual([
        'Người Một',
        'Người Một',
        'Người Hai',
      ]);
    });

    // Design là thuộc tính của SẢN PHẨM, nhưng danh sách ánh xạ vẫn phải trả kèm — nếu
    // không, màn hình quản trị design lại phải gọi thêm N lượt cho N dòng.
    it('trả kèm design và tình trạng: có mặt trước là READY, mặt sau chỉ là tuỳ chọn', async () => {
      const { service } = build({
        listMappingsPaged: jest.fn().mockResolvedValue({ items: [mapping()], total: 1 }),
        listProductDesigns: jest.fn().mockResolvedValue([design(PodDesignPlacement.FRONT)]),
      });

      const result = await service.listMappingsPaged('org-1', { page: 1, limit: 20 });

      expect(result.items[0].designStatus).toBe('READY');
      expect(result.items[0].designs).toHaveLength(1);
      expect(result.items[0].designs[0].placement).toBe('FRONT');
      expect(result.items[0].designs[0].uploadedByName).toBe('Nguyễn Vận Hành');
    });

    it('chỉ có mặt sau ⇒ MISSING_FRONT; chưa có file nào ⇒ MISSING_ALL', async () => {
      const backOnly = build({
        listMappingsPaged: jest.fn().mockResolvedValue({ items: [mapping()], total: 1 }),
        listProductDesigns: jest.fn().mockResolvedValue([design(PodDesignPlacement.BACK)]),
      });
      const none = build();

      expect(
        (await backOnly.service.listMappingsPaged('org-1', { page: 1, limit: 20 })).items[0]
          .designStatus,
      ).toBe('MISSING_FRONT');
      expect(
        (await none.service.listMappingsPaged('org-1', { page: 1, limit: 20 })).items[0]
          .designStatus,
      ).toBe('MISSING_ALL');
    });

    it('lọc designStatus=MISSING giữ lại đúng sản phẩm chưa có mặt trước', async () => {
      // Ba sản phẩm KHÁC NHAU, mỗi sản phẩm một tình trạng design.
      const { service } = build({
        listMappingsPaged: jest.fn().mockResolvedValue({
          items: [
            mapping({ id: 'ready', tiktokProductId: 'P-READY' }),
            mapping({ id: 'back-only', tiktokProductId: 'P-BACK' }),
            mapping({ id: 'empty', tiktokProductId: 'P-EMPTY' }),
          ],
          total: 3,
        }),
        listProductDesigns: jest
          .fn()
          .mockResolvedValue([
            design(PodDesignPlacement.FRONT, { tiktokProductId: 'P-READY' }),
            design(PodDesignPlacement.BACK, { tiktokProductId: 'P-BACK' }),
          ]),
      });

      const result = await service.listMappingsPaged('org-1', {
        page: 1,
        limit: 20,
        designStatus: 'MISSING',
      });

      expect(result.items.map((item) => item.id)).toEqual(['back-only', 'empty']);
    });
  });

  describe('listTiktokProductOptions', () => {
    // 🔴 Luật ghép là CẶP (Product ID + Seller SKU). Ba bài dưới đây khoá đúng luật đó lại:
    // trước refactor, khớp một trong ba khoá là đủ, và đó là cách một sản phẩm có hai bộ design.
    it('đánh dấu `mapped` khi khớp ĐỦ cặp Product ID + Seller SKU', async () => {
      const { service } = build({
        listDistinctTiktokSkus: jest
          .fn()
          .mockResolvedValue([
            {
              productId: 'TT-P1',
              skuId: 'TT-S1',
              sellerSku: 'SELLER-1',
              productName: 'Tee',
              skuName: null,
              productCategory: null,
              skuImage: null,
            },
          ]),
      });

      const [option] = await service.listTiktokProductOptions('org-1', 'prov-1');

      expect(option.mapped).toBe(true);
    });

    it('KHÔNG đánh dấu `mapped` khi chỉ khớp Seller SKU (khác Product ID)', async () => {
      const { service } = build({
        listDistinctTiktokSkus: jest
          .fn()
          .mockResolvedValue([
            {
              productId: 'SAN-PHAM-KHAC',
              skuId: 'TT-S1',
              sellerSku: 'SELLER-1',
              productName: 'Tee',
              skuName: null,
              productCategory: null,
              skuImage: null,
            },
          ]),
      });

      const [option] = await service.listTiktokProductOptions('org-1', 'prov-1');

      expect(option.mapped).toBe(false);
    });

    it('KHÔNG đánh dấu `mapped` khi chỉ khớp TikTok SKU ID', async () => {
      const { service } = build({
        listDistinctTiktokSkus: jest
          .fn()
          .mockResolvedValue([
            {
              productId: 'KHAC-P',
              skuId: 'TT-S1',
              sellerSku: 'KHAC-SELLER',
              productName: 'Hoodie',
              skuName: null,
              productCategory: null,
              skuImage: null,
            },
          ]),
      });

      const [option] = await service.listTiktokProductOptions('org-1', 'prov-1');

      expect(option.mapped).toBe(false);
    });

    it('đọc ánh xạ ở phạm vi TỔ CHỨC, không giới hạn theo nhà cung cấp đang chọn', async () => {
      const { service, repo } = build();

      await service.listTiktokProductOptions('org-1', 'prov-1');

      expect(repo.listMappingsForOrganization).toHaveBeenCalledWith('org-1');
    });
  });

  describe('createMapping', () => {
    it('lưu đủ khoá nghiệp vụ, Fulfillment SKU và Base Cost', async () => {
      const { service, repo } = build();

      await service.createMapping(
        'org-1',
        'user-1',
        FulfillmentProvider.MANGO,
        {
          tiktokProductId: 'TT-P9',
          sellerSku: 'SELLER-9',
          providerSku: 'MANGO-SKU-9',
          baseCost: 12.5,
          providerProductId: 'MP-9',
          providerVariantId: 'MV-9',
          providerProductName: 'Unisex Tee',
          providerVariantName: 'White / M',
        },
        POD_SCOPE_SYSTEM,
      );

      const data = callArg<Record<string, unknown>>(repo.createMapping, 0, 0);
      expect(data.tiktokProductId).toBe('TT-P9');
      expect(data.sellerSku).toBe('SELLER-9');
      expect(data.providerSku).toBe('MANGO-SKU-9');
      expect(data.baseCost).toBe(12.5);
      expect(data.providerProductId).toBe('MP-9');
      expect(data.providerVariantId).toBe('MV-9');
      expect(data.providerVariantName).toBe('White / M');
    });

    it('kiểm trùng theo CẶP khoá, ở phạm vi tổ chức (không kèm accountId)', async () => {
      const { service, repo } = build();

      await service.createMapping(
        'org-1',
        'user-1',
        FulfillmentProvider.MANGO,
        {
          tiktokProductId: 'TT-P9',
          sellerSku: 'SELLER-9',
          providerSku: 'MANGO-SKU-9',
        },
        POD_SCOPE_SYSTEM,
      );

      expect(repo.findConflictingMapping).toHaveBeenCalledWith(
        'org-1',
        { tiktokProductId: 'TT-P9', sellerSku: 'SELLER-9' },
        undefined,
      );
    });

    it('chặn ánh xạ trùng — một Product ID + Seller SKU chỉ có MỘT bộ Design', async () => {
      const { service, repo } = build({
        findConflictingMapping: jest.fn().mockResolvedValue(mapping()),
      });

      await expect(
        service.createMapping(
          'org-1',
          'user-1',
          FulfillmentProvider.MANGO,
          {
            tiktokProductId: 'TT-P1',
            sellerSku: 'SELLER-1',
            providerSku: 'MANGO-SKU-2',
          },
          POD_SCOPE_SYSTEM,
        ),
      ).rejects.toBeInstanceOf(FulfillmentMappingConflictException);

      expect(repo.createMapping).not.toHaveBeenCalled();
    });
  });

  describe('updateMapping', () => {
    it('cho phép đổi biến thể, giá vốn và trạng thái', async () => {
      const { service, repo } = build();

      await service.updateMapping(
        'org-1',
        'user-1',
        'map-1',
        {
          tiktokProductId: 'TT-P1',
          sellerSku: 'SELLER-1',
          providerSku: 'MANGO-SKU-2',
          baseCost: 9.99,
          providerVariantId: 'MV-2',
          providerVariantName: 'Navy / XL',
          isActive: false,
        },
        POD_SCOPE_SYSTEM,
      );

      const data = callArg<Record<string, unknown>>(repo.updateMapping, 0, 1);
      expect(data.providerVariantId).toBe('MV-2');
      expect(data.baseCost).toBe(9.99);
      expect(data.isActive).toBe(false);
    });

    it('loại chính bản ghi đang sửa khỏi phép kiểm trùng', async () => {
      const { service, repo } = build();

      await service.updateMapping(
        'org-1',
        'user-1',
        'map-1',
        {
          tiktokProductId: 'TT-P1',
          sellerSku: 'SELLER-1',
          providerSku: 'MANGO-SKU-2',
        },
        POD_SCOPE_SYSTEM,
      );

      expect(repo.findConflictingMapping).toHaveBeenCalledWith(
        'org-1',
        { tiktokProductId: 'TT-P1', sellerSku: 'SELLER-1' },
        'map-1',
      );
    });
  });
});
