import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider } from '@prisma/client';
import { callArg } from '../../../testing/mock-call.util';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { FulfillmentMappingConflictException } from '../exceptions/fulfillment.exceptions';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

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
    ...over,
  };
}

function build(repoOverrides: Record<string, jest.Mock> = {}) {
  const repo = {
    listMappingsPaged: jest.fn().mockResolvedValue({ items: [mapping()], total: 1 }),
    listAccounts: jest.fn().mockResolvedValue([{ id: 'prov-1', name: 'Mango US', isActive: true }]),
    listMappings: jest.fn().mockResolvedValue([mapping()]),
    listDistinctTiktokSkus: jest.fn().mockResolvedValue([]),
    findConflictingMapping: jest.fn().mockResolvedValue(null),
    createMapping: jest.fn().mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve(mapping(data)),
    ),
    findMappingById: jest.fn().mockResolvedValue(mapping()),
    updateMapping: jest.fn().mockImplementation((_id: string, data: Record<string, unknown>) =>
      Promise.resolve(mapping(data)),
    ),
    softDeleteMapping: jest.fn().mockResolvedValue(undefined),
    findActiveAccount: jest.fn().mockResolvedValue({ id: 'prov-1', name: 'Mango US' }),
    ...repoOverrides,
  } as unknown as FulfillmentRepository;

  const service = new FulfillmentService(
    { get: (_key: string, fallback?: string) => fallback ?? '' } as unknown as ConfigService,
    repo,
    {} as unknown as PodOrderRepository,
    {} as unknown as FulfillmentReadinessService,
    encryption,
  );
  return { service, repo: repo as unknown as Record<string, jest.Mock> };
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
  });

  describe('listTiktokProductOptions', () => {
    it('đánh dấu `mapped` theo TikTok SKU ID', async () => {
      const { service } = build({
        listDistinctTiktokSkus: jest.fn().mockResolvedValue([
          { productId: 'TT-P1', skuId: 'TT-S1', sellerSku: null, productName: 'Tee',
            skuName: null, productCategory: null, skuImage: null },
        ]),
      });

      const [option] = await service.listTiktokProductOptions('org-1', 'prov-1');

      expect(option.mapped).toBe(true);
    });

    it('đánh dấu `mapped` theo Seller SKU khi không khớp SKU ID', async () => {
      const { service } = build({
        listDistinctTiktokSkus: jest.fn().mockResolvedValue([
          { productId: null, skuId: 'KHAC', sellerSku: 'SELLER-1', productName: 'Tee',
            skuName: null, productCategory: null, skuImage: null },
        ]),
      });

      const [option] = await service.listTiktokProductOptions('org-1', 'prov-1');

      expect(option.mapped).toBe(true);
    });

    it('SKU chưa ánh xạ được đánh dấu mapped = false', async () => {
      const { service } = build({
        listDistinctTiktokSkus: jest.fn().mockResolvedValue([
          { productId: 'KHAC-P', skuId: 'KHAC-S', sellerSku: 'KHAC-SELLER', productName: 'Hoodie',
            skuName: null, productCategory: null, skuImage: null },
        ]),
      });

      const [option] = await service.listTiktokProductOptions('org-1', 'prov-1');

      expect(option.mapped).toBe(false);
    });
  });

  describe('createMapping', () => {
    it('lưu đủ providerProductId / providerVariantId / providerSku', async () => {
      const { service, repo } = build();

      await service.createMapping('org-1', 'user-1', FulfillmentProvider.MANGO, {
        sellerSku: 'SELLER-9',
        providerSku: 'MANGO-SKU-9',
        providerProductId: 'MP-9',
        providerVariantId: 'MV-9',
        providerProductName: 'Unisex Tee',
        providerVariantName: 'White / M',
      });

      const data = callArg<Record<string, unknown>>(repo.createMapping, 0, 0);
      expect(data.providerSku).toBe('MANGO-SKU-9');
      expect(data.providerProductId).toBe('MP-9');
      expect(data.providerVariantId).toBe('MV-9');
      expect(data.providerVariantName).toBe('White / M');
    });

    it('chặn ánh xạ trùng — một Seller SKU chỉ map một lần với một nhà cung cấp', async () => {
      const { service, repo } = build({
        findConflictingMapping: jest.fn().mockResolvedValue(mapping()),
      });

      await expect(
        service.createMapping('org-1', 'user-1', FulfillmentProvider.MANGO, {
          sellerSku: 'SELLER-1',
          providerSku: 'MANGO-SKU-2',
        }),
      ).rejects.toBeInstanceOf(FulfillmentMappingConflictException);

      expect(repo.createMapping).not.toHaveBeenCalled();
    });
  });

  describe('updateMapping', () => {
    it('cho phép đổi biến thể và trạng thái', async () => {
      const { service, repo } = build();

      await service.updateMapping('org-1', 'user-1', 'map-1', {
        providerSku: 'MANGO-SKU-2',
        providerVariantId: 'MV-2',
        providerVariantName: 'Navy / XL',
        isActive: false,
      });

      const data = callArg<Record<string, unknown>>(repo.updateMapping, 0, 1);
      expect(data.providerVariantId).toBe('MV-2');
      expect(data.isActive).toBe(false);
    });
  });
});
