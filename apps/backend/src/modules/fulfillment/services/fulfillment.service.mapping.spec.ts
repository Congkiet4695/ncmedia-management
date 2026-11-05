import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, PodDesignPlacement, Prisma } from '@prisma/client';
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
import { FulfillmentVariantPriceService } from './fulfillment-variant-price.service';
import type { FulfillmentProviderGateway } from './fulfillment-provider.gateway';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpsertProductMappingDto } from '../dto/fulfillment.dto';

const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

/**
 * Một file design đang hiệu lực ở vị trí `placement`.
 *
 * 🔴 Design khoá theo biến thể và ĐỘC LẬP với ánh xạ — nên fixture mang theo khoá, không gắn vào bản ghi ánh xạ nữa.
 */
function design(placement: PodDesignPlacement, over: Record<string, unknown> = {}) {
  return {
    id: `design-${placement}`,
    placement,
    version: 1,
    tiktokProductId: 'TT-P1',
    tiktokSkuId: 'TT-S1',
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

/** Giá vốn theo SKU trong danh mục đã đồng bộ. Thiếu SKU ⇒ "không tìm thấy giá". */
const CATALOG_PRICES: Record<string, number> = {
  'MANGO-SKU-1': 11.25,
  'MANGO-SKU-2': 14.9,
  'MANGO-SKU-9': 23.89,
};

function build(
  repoOverrides: Record<string, jest.Mock> = {},
  prices: Record<string, number> = CATALOG_PRICES,
) {
  const variantPrice = {
    lookup: jest.fn((_org: string, accountId: string, key: { sku?: string | null }) => {
      const price = key.sku ? prices[key.sku] : undefined;
      return Promise.resolve(
        price === undefined
          ? { ok: false, reason: 'VARIANT_NOT_FOUND', message: `Không tìm thấy biến thể ${key.sku}` }
          : {
              ok: true,
              price: {
                accountId,
                variantId: `v-${key.sku}`,
                externalVariantId: 'x',
                sku: key.sku,
                price,
                currency: 'USD',
                source: 'PROVIDER_CATALOG',
                syncedAt: '2026-09-30T00:00:00.000Z',
              },
            },
      );
    }),
  };
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
    {
      isSupported: () => true,
      placementResolver: jest.fn().mockResolvedValue(undefined),
    } as unknown as FulfillmentProviderGateway,
    variantPrice as unknown as FulfillmentVariantPriceService,
  );
  return { variantPrice,  service, repo: repo as unknown as Record<string, jest.Mock>, findUsers };
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
    it('đánh dấu `mapped` khi khớp ĐỦ Product ID + SKU ID', async () => {
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

    it('KHÔNG đánh dấu `mapped` khi khác Product ID', async () => {
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

    it('🔴 KHÔNG đánh dấu `mapped` khi cùng Seller SKU nhưng khác biến thể', async () => {
      const { service } = build({
        listDistinctTiktokSkus: jest
          .fn()
          .mockResolvedValue([
            {
              productId: 'TT-P1',
              skuId: 'BIEN-THE-KHAC',
              sellerSku: 'SELLER-1',
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
    it('🔴 Base Cost lấy từ GIÁ NHÀ CUNG CẤP của đúng biến thể — BỎ QUA baseCost frontend gửi', async () => {
      const { service, repo, variantPrice } = build();

      const result = await service.createMapping(
        'org-1',
        'user-1',
        FulfillmentProvider.MANGO,
        {
          tiktokProductId: 'TT-P9',
          tiktokSkuId: 'SKU-ID-9',
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
      // 12.5 là giá client gửi — KHÔNG được dùng. 23.89 là giá của MANGO-SKU-9 trong danh mục.
      expect(data.baseCost).toBe(23.89);
      expect(result.baseCostStatus).toBe('PROVIDER_PRICE');
      expect(variantPrice.lookup).toHaveBeenCalledWith('org-1', 'prov-1', {
        externalVariantId: 'MV-9',
        sku: 'MANGO-SKU-9',
      });
      expect(data.providerProductId).toBe('MP-9');
      expect(data.providerVariantId).toBe('MV-9');
      expect(data.providerVariantName).toBe('White / M');
    });

    it('kiểm trùng theo biến thể, ở phạm vi tổ chức (không kèm accountId)', async () => {
      const { service, repo } = build();

      await service.createMapping(
        'org-1',
        'user-1',
        FulfillmentProvider.MANGO,
        {
          tiktokProductId: 'TT-P9',
          tiktokSkuId: 'SKU-ID-9',
          sellerSku: 'SELLER-9',
          providerSku: 'MANGO-SKU-9',
        },
        POD_SCOPE_SYSTEM,
      );

      expect(repo.findConflictingMapping).toHaveBeenCalledWith(
        'org-1',
        { tiktokProductId: 'TT-P9', sellerSku: 'SELLER-9', tiktokSkuId: 'SKU-ID-9' },
        undefined,
      );
    });

    describe('🔴 biến thể KHÔNG có Seller SKU trên TikTok', () => {
      it.each([
        ['bỏ trống', undefined],
        ['chuỗi rỗng', ''],
        ['chỉ khoảng trắng', '   '],
      ])('Seller SKU %s + TikTok SKU ID ⇒ lưu khoá Product ID + SKU ID, seller_sku = NULL', async (_label, sellerSku) => {
        const { service, repo } = build();
        await service.createMapping(
          'org-1',
          'user-1',
          FulfillmentProvider.MANGO,
          { tiktokProductId: 'TT-P9', sellerSku, tiktokSkuId: 'SKU-ID-9', providerSku: 'MANGO-SKU-9' },
          POD_SCOPE_SYSTEM,
        );
        const data = callArg<Record<string, unknown>>(repo.createMapping, 0, 0);
        expect(data).toMatchObject({ tiktokProductId: 'TT-P9', sellerSku: null, tiktokSkuId: 'SKU-ID-9', providerSku: 'MANGO-SKU-9' });
        // Kiểm trùng theo ĐÚNG danh tính SKU ID — không đụng ánh xạ Seller SKU.
        expect(repo.findConflictingMapping).toHaveBeenCalledWith(
          'org-1',
          { tiktokProductId: 'TT-P9', sellerSku: null, tiktokSkuId: 'SKU-ID-9' },
          undefined,
        );
      });

      it('🔴 có Seller SKU nhưng thiếu SKU ID ⇒ 400 FULFILLMENT_MAPPING_KEY_INVALID, không ghi gì', async () => {
        const { service, repo } = build();
        await expect(
          service.createMapping(
            'org-1',
            'user-1',
            FulfillmentProvider.MANGO,
            { tiktokProductId: 'TT-P9', sellerSku: 'SELLER-9', providerSku: 'MANGO-SKU-9' } as never,
            POD_SCOPE_SYSTEM,
          ),
        ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_MAPPING_KEY_INVALID' } });
        expect(repo.createMapping).not.toHaveBeenCalled();
      });

      it('ánh xạ trùng cùng SKU ID ⇒ 409 như khoá Seller SKU', async () => {
        const { service, repo } = build({ findConflictingMapping: jest.fn().mockResolvedValue(mapping()) });
        await expect(
          service.createMapping(
            'org-1',
            'user-1',
            FulfillmentProvider.MANGO,
            { tiktokProductId: 'TT-P9', tiktokSkuId: 'SKU-ID-9', providerSku: 'MANGO-SKU-9' },
            POD_SCOPE_SYSTEM,
          ),
        ).rejects.toBeInstanceOf(FulfillmentMappingConflictException);
        expect(repo.createMapping).not.toHaveBeenCalled();
      });

      it('sửa ánh xạ SKU ID: giữ khoá, mở lại đọc được (requireMappingProductKey trả khoá SKU ID)', async () => {
        const skuless = mapping({ sellerSku: null, tiktokSkuId: 'SKU-ID-9', tiktokProductId: 'TT-P9' });
        const { service, repo } = build({ findMappingById: jest.fn().mockResolvedValue(skuless) });
        await service.updateMapping(
          'org-1',
          'user-1',
          'map-1',
          { tiktokProductId: 'TT-P9', tiktokSkuId: 'SKU-ID-9', providerSku: 'MANGO-SKU-9' },
          POD_SCOPE_SYSTEM,
        );
        expect(callArg<Record<string, unknown>>(repo.updateMapping, 0, 1)).toMatchObject({ sellerSku: null, tiktokSkuId: 'SKU-ID-9' });
        expect(repo.findConflictingMapping).toHaveBeenCalledWith(
          'org-1',
          { tiktokProductId: 'TT-P9', sellerSku: null, tiktokSkuId: 'SKU-ID-9' },
          'map-1',
        );
        await expect(service.requireMappingProductKey('org-1', 'map-1')).resolves.toEqual({
          tiktokProductId: 'TT-P9',
          sellerSku: null,
          tiktokSkuId: 'SKU-ID-9',
        });
      });

      it('DTO: SKU ID bắt buộc, Seller SKU tuỳ chọn', () => {
        const errorsOf = (body: Record<string, unknown>) =>
          validateSync(plainToInstance(UpsertProductMappingDto, { tiktokProductId: 'P', providerSku: 'X', ...body }))
            .map((error) => error.property)
            .filter((property) => property === 'sellerSku' || property === 'tiktokSkuId');
        expect(errorsOf({ tiktokSkuId: 'K' })).toEqual([]);
        expect(errorsOf({ sellerSku: 'S', tiktokSkuId: 'K' })).toEqual([]);
        expect(errorsOf({ sellerSku: '  ', tiktokSkuId: 'K' })).toEqual([]);
        expect(errorsOf({})).toEqual(['tiktokSkuId']);
        expect(errorsOf({ sellerSku: 'S' })).toEqual(['tiktokSkuId']);
      });
    });

    it('chặn ánh xạ trùng — mỗi biến thể chỉ có MỘT ánh xạ', async () => {
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
            tiktokSkuId: 'TT-S1',
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
    it('đổi biến thể ⇒ Base Cost cập nhật theo giá của biến thể MỚI', async () => {
      const { service, repo } = build();

      await service.updateMapping(
        'org-1',
        'user-1',
        'map-1',
        {
          tiktokProductId: 'TT-P1',
          tiktokSkuId: 'TT-S1',
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
      expect(data.baseCost).toBe(14.9);
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
          tiktokSkuId: 'TT-S1',
          sellerSku: 'SELLER-1',
          providerSku: 'MANGO-SKU-2',
        },
        POD_SCOPE_SYSTEM,
      );

      expect(repo.findConflictingMapping).toHaveBeenCalledWith(
        'org-1',
        { tiktokProductId: 'TT-P1', sellerSku: 'SELLER-1', tiktokSkuId: 'TT-S1' },
        'map-1',
      );
    });
  });
});

describe('Base Cost — không lấy được giá', () => {
  it('tạo ánh xạ mà biến thể KHÔNG có giá ⇒ Base Cost trống + PRICE_NOT_FOUND kèm lý do (không 0)', async () => {
    const { service, repo } = build();

    const result = await service.createMapping(
      'org-1',
      'user-1',
      FulfillmentProvider.MANGO,
      { tiktokProductId: 'TT-P7', tiktokSkuId: 'TT-S7', sellerSku: 'SELLER-7', providerSku: 'NO-PRICE', baseCost: 5 },
      POD_SCOPE_SYSTEM,
    );

    const data = callArg<Record<string, unknown>>(repo.createMapping, 0, 0);
    expect(data.baseCost).toBeNull();
    expect(result.baseCostStatus).toBe('PRICE_NOT_FOUND');
    expect(result.baseCostMessage).toContain('NO-PRICE');
  });

  it('🔴 sửa ánh xạ CÙNG biến thể mà không lấy được giá ⇒ GIỮ Base Cost cũ (không ghi đè null/0)', async () => {
    const { service, repo } = build(
      {
        findMappingById: jest.fn().mockResolvedValue(
          mapping({ providerSku: 'MANGO-SKU-1', providerVariantId: 'MV-1', baseCost: new Prisma.Decimal('11.25') }),
        ),
      },
      {},
    );

    const result = await service.updateMapping(
      'org-1',
      'user-1',
      'map-1',
      { tiktokProductId: 'TT-P1', tiktokSkuId: 'TT-S1', sellerSku: 'SELLER-1', providerSku: 'MANGO-SKU-1', providerVariantId: 'MV-1' },
      POD_SCOPE_SYSTEM,
    );

    const data = callArg<Record<string, unknown>>(repo.updateMapping, 0, 1);
    expect(data.baseCost).toBe(11.25);
    expect(result.baseCostStatus).toBe('UNCHANGED');
  });

  it('đổi sang biến thể KHÁC không có giá ⇒ KHÔNG giữ giá của SKU cũ', async () => {
    const { service, repo } = build(
      {
        findMappingById: jest.fn().mockResolvedValue(
          mapping({ providerSku: 'MANGO-SKU-1', providerVariantId: 'MV-1', baseCost: new Prisma.Decimal('11.25') }),
        ),
      },
      {},
    );

    const result = await service.updateMapping(
      'org-1',
      'user-1',
      'map-1',
      { tiktokProductId: 'TT-P1', tiktokSkuId: 'TT-S1', sellerSku: 'SELLER-1', providerSku: 'OTHER-SKU', providerVariantId: 'MV-9' },
      POD_SCOPE_SYSTEM,
    );

    const data = callArg<Record<string, unknown>>(repo.updateMapping, 0, 1);
    expect(data.baseCost).toBeNull();
    expect(result.baseCostStatus).toBe('PRICE_NOT_FOUND');
  });

  it('nhiều sản phẩm/biến thể ⇒ MỖI ánh xạ một giá riêng (không dùng chung một giá)', async () => {
    const { service, repo } = build();

    await service.createMapping('org-1', 'user-1', FulfillmentProvider.MANGO,
      { tiktokProductId: 'TT-A', tiktokSkuId: 'TT-SA', sellerSku: 'S-A', providerSku: 'MANGO-SKU-1' }, POD_SCOPE_SYSTEM);
    await service.createMapping('org-1', 'user-1', FulfillmentProvider.MANGO,
      { tiktokProductId: 'TT-B', tiktokSkuId: 'TT-SB', sellerSku: 'S-B', providerSku: 'MANGO-SKU-2' }, POD_SCOPE_SYSTEM);

    expect(callArg<Record<string, unknown>>(repo.createMapping, 0, 0).baseCost).toBe(11.25);
    expect(callArg<Record<string, unknown>>(repo.createMapping, 1, 0).baseCost).toBe(14.9);
  });

  it('lỗi database khi tra giá ⇒ cả thao tác lưu thất bại, KHÔNG ghi gì', async () => {
    const { service, repo, variantPrice } = build();
    variantPrice.lookup.mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      service.createMapping('org-1', 'user-1', FulfillmentProvider.MANGO,
        { tiktokProductId: 'TT-C', tiktokSkuId: 'TT-SC', sellerSku: 'S-C', providerSku: 'MANGO-SKU-1' }, POD_SCOPE_SYSTEM),
    ).rejects.toThrow('connection lost');
    expect(repo.createMapping).not.toHaveBeenCalled();
  });
});

describe('🔴 cấu hình legacy theo Seller SKU', () => {
  const ITEM = { id: 'item-1', productId: 'TT-P1', skuId: 'TT-V2', sellerSku: 'SELLER-1' };
  const legacyMapping = () => mapping({ id: 'legacy', tiktokSkuId: 'TT-OTHER', legacySharedKey: true, isActive: true });
  const legacyDesign = (over: Record<string, unknown> = {}) =>
    design(PodDesignPlacement.FRONT, {
      tiktokSkuId: null,
      legacySharedKey: true,
      storageFileId: 'file-legacy',
      sourceUrl: null,
      ...over,
    });

  function adoptHarness(overrides: Record<string, jest.Mock> = {}) {
    const adoptLegacyConfig = jest.fn().mockResolvedValue({ mappingAdopted: true, designsAdopted: 1 });
    const { service } = build({
      listMappingsForProducts: jest.fn().mockResolvedValue([legacyMapping()]),
      listProductDesignsForProducts: jest.fn().mockResolvedValue([legacyDesign()]),
      adoptLegacyConfig,
      ...overrides,
    });
    const findById = jest.fn().mockResolvedValue({ id: 'order-1', shopId: 'shop-1', items: [ITEM] });
    const assertShopAllowed = jest.fn();
    Object.assign(service, {
      podOrderRepo: { findById },
      accessScope: { assertShopAllowed },
    });
    return { service, adoptLegacyConfig, findById, assertShopAllowed };
  }

  it('xác nhận ⇒ chép cho ĐÚNG biến thể của dòng đơn (lấy từ database), kiểm phạm vi shop', async () => {
    const { service, adoptLegacyConfig, assertShopAllowed } = adoptHarness();

    await service.adoptLegacyConfig('org-1', 'user-1', 'order-1', 'item-1', POD_SCOPE_SYSTEM);

    expect(assertShopAllowed).toHaveBeenCalledWith(POD_SCOPE_SYSTEM, 'shop-1');
    const params = callArg<{ key: unknown; mapping: { id: string }; designs: Array<{ storageFileId: string }> }>(
      adoptLegacyConfig,
      0,
      0,
    );
    expect(params.key).toEqual({ tiktokProductId: 'TT-P1', tiktokSkuId: 'TT-V2', sellerSku: 'SELLER-1' });
    expect(params.mapping.id).toBe('legacy');
    expect(params.designs.map((row) => row.storageFileId)).toEqual(['file-legacy']);
  });

  it('biến thể đã có cấu hình riêng ⇒ KHÔNG ghi đè, chỉ chép phần thiếu', async () => {
    const own = mapping({ id: 'own', tiktokSkuId: 'TT-V2', isActive: true });
    const { service, adoptLegacyConfig } = adoptHarness({
      listMappingsForProducts: jest.fn().mockResolvedValue([legacyMapping(), own]),
    });

    await service.adoptLegacyConfig('org-1', 'user-1', 'order-1', 'item-1', POD_SCOPE_SYSTEM);

    const params = callArg<{ mapping: unknown; designs: unknown[] }>(adoptLegacyConfig, 0, 0);
    expect(params.mapping).toBeNull();
    expect(params.designs).toHaveLength(1);
  });

  it('không có gì để xác nhận ⇒ 404, không ghi', async () => {
    const { service, adoptLegacyConfig } = adoptHarness({
      listMappingsForProducts: jest.fn().mockResolvedValue([]),
      listProductDesignsForProducts: jest.fn().mockResolvedValue([]),
    });
    await expect(
      service.adoptLegacyConfig('org-1', 'user-1', 'order-1', 'item-1', POD_SCOPE_SYSTEM),
    ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_LEGACY_CONFIG_NOT_FOUND' } });
    expect(adoptLegacyConfig).not.toHaveBeenCalled();
  });

  it('dòng hàng không thuộc đơn, hoặc thiếu SKU ID ⇒ 404, không ghi', async () => {
    const { service, adoptLegacyConfig, findById } = adoptHarness();
    await expect(
      service.adoptLegacyConfig('org-1', 'user-1', 'order-1', 'item-KHAC', POD_SCOPE_SYSTEM),
    ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_LEGACY_CONFIG_NOT_FOUND' } });

    findById.mockResolvedValue({ id: 'order-1', shopId: 'shop-1', items: [{ ...ITEM, skuId: null }] });
    await expect(
      service.adoptLegacyConfig('org-1', 'user-1', 'order-1', 'item-1', POD_SCOPE_SYSTEM),
    ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_LEGACY_CONFIG_NOT_FOUND' } });
    expect(adoptLegacyConfig).not.toHaveBeenCalled();
  });

  it('ánh xạ legacy không sửa được; khoá theo mapping id cũng từ chối', async () => {
    const { service, repo } = build({ findMappingById: jest.fn().mockResolvedValue(legacyMapping()) });
    await expect(
      service.updateMapping(
        'org-1',
        'user-1',
        'legacy',
        { tiktokProductId: 'TT-P1', tiktokSkuId: 'TT-V2', providerSku: 'MANGO-SKU-1' },
        POD_SCOPE_SYSTEM,
      ),
    ).rejects.toMatchObject({ response: { code: 'FULFILLMENT_MAPPING_LEGACY_READONLY' } });
    expect(repo.updateMapping).not.toHaveBeenCalled();
    await expect(service.requireMappingProductKey('org-1', 'legacy')).rejects.toMatchObject({
      response: { code: 'FULFILLMENT_MAPPING_LEGACY_READONLY' },
    });
  });
});
