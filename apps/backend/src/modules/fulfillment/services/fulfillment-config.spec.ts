import { ConfigService } from '@nestjs/config';
import { FulfillmentProvider, FulfillmentStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodOrderRepository } from '../../pod-tiktok/repositories/pod-order.repository';
import { POD_SCOPE_SYSTEM, type PodAccessScopeService } from '../../pod-tiktok/services/pod-access-scope.service';
import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { StorageMapper } from '../../storage/storage.mapper';
import { ProductDesignMapper } from '../mappers/product-design.mapper';
import { FulfillmentRepository } from '../repositories/fulfillment.repository';
import { FulfillmentCatalogRepository } from '../repositories/fulfillment-catalog.repository';
import { FulfillmentCatalogQueryService } from './fulfillment-catalog-query.service';
import { businessProductSku } from './fulfillment-catalog-sync.service';
import { FulfillmentReadinessService } from './fulfillment-readiness.service';
import { FulfillmentService } from './fulfillment.service';

/**
 * **Cấu hình sản phẩm ở màn hình Fulfill** — ba luật mà giao diện dựa vào:
 *
 * ```
 *   1. SKU sản phẩm chỉ được lưu khi nó là MÃ NGHIỆP VỤ  → không có UUID nào để mà hiện lên
 *   2. Danh mục tra được CHÍNH XÁC theo id nhà cung cấp  → mở lại cấu hình đã lưu thấy đúng tên
 *   3. `state` trả kèm ánh xạ ĐÃ GHÉP của từng dòng hàng → giao diện không tự ghép, không lệch
 * ```
 */

// ---------------------------------------------------------------------------
// 1. SKU nghiệp vụ vs id kỹ thuật viết lại
// ---------------------------------------------------------------------------

describe('businessProductSku', () => {
  const ID = '6362ae37-519a-4562-a6e2-53eb00d909b5';

  it('🔴 `PROD-<id>` là id viết lại, KHÔNG phải SKU ⇒ null', () => {
    expect(businessProductSku(`PROD-${ID}`, ID)).toBeNull();
  });

  it('SKU trùng y nguyên id ⇒ null', () => {
    expect(businessProductSku(ID, ID)).toBeNull();
  });

  it('khác hoa thường vẫn là id viết lại ⇒ null', () => {
    expect(businessProductSku(`prod-${ID.toUpperCase()}`, ID)).toBeNull();
  });

  it('mã nghiệp vụ thật được giữ nguyên', () => {
    expect(businessProductSku('G05000AIG000M', ID)).toBe('G05000AIG000M');
    expect(businessProductSku('  12125  ', ID)).toBe('12125');
  });

  it('rỗng / thiếu ⇒ null (không dựng chuỗi rỗng)', () => {
    expect(businessProductSku('', ID)).toBeNull();
    expect(businessProductSku(null, ID)).toBeNull();
    expect(businessProductSku(undefined, ID)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Tra chính xác theo id nhà cung cấp
// ---------------------------------------------------------------------------

describe('FulfillmentCatalogQueryService.listProducts', () => {
  function build() {
    const listProductsPaged = jest.fn().mockResolvedValue({ items: [], total: 0 });
    const catalogRepo = {
      listProductsPaged,
      lastSyncedAt: jest.fn().mockResolvedValue(null),
    } as unknown as FulfillmentCatalogRepository;
    const repo = {
      findAccountById: jest.fn().mockResolvedValue({ id: 'acc-1', name: 'Mango US' }),
    } as unknown as FulfillmentRepository;
    return { service: new FulfillmentCatalogQueryService(repo, catalogRepo), listProductsPaged };
  }

  it('🔴 truyền `externalProductId` xuống repository để tra CHÍNH XÁC (hydrate ô chọn đã lưu)', async () => {
    const { service, listProductsPaged } = build();

    await service.listProducts('org-1', 'acc-1', {
      externalProductId: 'ab5cd728-731e-4cea-ab59-84fa0b8f6b68',
      page: 1,
      limit: 20,
    });

    const params = (listProductsPaged.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(params.externalProductId).toBe('ab5cd728-731e-4cea-ab59-84fa0b8f6b68');
    expect(params.search).toBeUndefined();
  });

  it('🔴 bản ghi cũ còn giữ `PROD-<id>` trong cột sku ⇒ API vẫn KHÔNG trả nó ra giao diện', async () => {
    const listProductsPaged = jest.fn().mockResolvedValue({
      items: [
        {
          id: 'uuid-1',
          externalProductId: '6362ae37-519a-4562-a6e2-53eb00d909b5',
          sku: 'PROD-6362ae37-519a-4562-a6e2-53eb00d909b5',
          name: '0.75" Thickness Canvas',
          catalogueId: null,
          catalogue: null,
          basePrice: null,
          currency: null,
          image: null,
          _count: { variants: 12 },
        },
      ],
      total: 1,
    });
    const service = new FulfillmentCatalogQueryService(
      { findAccountById: jest.fn().mockResolvedValue({ id: 'acc-1' }) } as unknown as FulfillmentRepository,
      {
        listProductsPaged,
        lastSyncedAt: jest.fn().mockResolvedValue(null),
      } as unknown as FulfillmentCatalogRepository,
    );

    const result = await service.listProducts('org-1', 'acc-1', { page: 1, limit: 20 });

    expect(result.items[0].sku).toBeNull();
    expect(result.items[0].name).toBe('0.75" Thickness Canvas');
    // Định danh vẫn nguyên vẹn để gửi đi — chỉ nhãn hiển thị là sạch.
    expect(result.items[0].externalProductId).toBe('6362ae37-519a-4562-a6e2-53eb00d909b5');
  });

  it('tìm kiếm thường vẫn đi bằng `search` (gần đúng, toàn bộ danh mục)', async () => {
    const { service, listProductsPaged } = build();

    await service.listProducts('org-1', 'acc-1', { search: 'canvas', page: 3, limit: 20 });

    const params = (listProductsPaged.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(params).toMatchObject({ search: 'canvas', page: 3, limit: 20 });
    expect(params.externalProductId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. `state` trả kèm ánh xạ đã ghép
// ---------------------------------------------------------------------------

const encryption = {
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ''),
} as unknown as TiktokEncryptionService;

function mappingRow(over: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    organizationId: 'org-1',
    accountId: 'acc-1',
    provider: FulfillmentProvider.MANGO,
    tiktokProductId: 'TT-P1',
    tiktokSkuId: 'TT-S1',
    sellerSku: 'SELLER-1',
    providerSku: 'MANGO-SKU-1',
    baseCost: null,
    providerProductId: 'MP-1',
    providerVariantId: 'MV-1',
    providerProductName: 'Unisex T-shirt | Gildan 5000',
    providerVariantName: 'BLACK / M',
    providerColor: 'BLACK',
    providerSize: 'M',
    productionConfig: 'default',
    productionLine: 'line-1',
    placementMap: null,
    isActive: true,
    note: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedBy: null,
    ...over,
  };
}

function buildStateService(over: { mappings?: unknown[]; account?: unknown; ready?: boolean } = {}) {
  const order = {
    id: 'order-1',
    shopId: 'shop-1',
    status: 'AWAITING_SHIPMENT',
    account: { fulfillmentAccountId: 'acc-1' },
    items: [
      { id: 'item-1', productId: 'TT-P1', sellerSku: 'SELLER-1', skuId: 'TT-S1' },
      { id: 'item-2', productId: 'TT-P2', sellerSku: 'SELLER-2', skuId: 'TT-S2' },
    ],
  };

  const repo = {
    findByPodOrder: jest.fn().mockResolvedValue(null),
    findAccountById: jest
      .fn()
      .mockResolvedValue(
        // `?? ` ở đây là sai: case "chưa gán nhà cung cấp" truyền THẲNG null và phải giữ null.
        'account' in over
          ? over.account
          : { id: 'acc-1', name: 'Mango US', provider: FulfillmentProvider.MANGO, isActive: true },
      ),
    listMappingsForOrganization: jest.fn().mockResolvedValue(over.mappings ?? [mappingRow()]),
    listProductDesigns: jest.fn().mockResolvedValue([]),
  } as unknown as FulfillmentRepository;

  const readiness = {
    check: jest.fn().mockReturnValue({ ready: over.ready ?? false, issues: [] }),
  } as unknown as FulfillmentReadinessService;

  const service = new FulfillmentService(
    { get: (_key: string, fallback?: string) => fallback ?? '' } as unknown as ConfigService,
    { user: { findMany: jest.fn().mockResolvedValue([]) } } as unknown as PrismaService,
    repo,
    { findById: jest.fn().mockResolvedValue(order) } as unknown as PodOrderRepository,
    readiness,
    new ProductDesignMapper({
      buildDownloadUrl: (id: string) => `/api/v1/storage/${id}/download`,
    } as unknown as StorageMapper),
    encryption,
    { assertShopAllowed: jest.fn() } as unknown as PodAccessScopeService,
  );

  return { service, repo: repo as unknown as Record<string, jest.Mock> };
}

describe('FulfillmentService.getState — ánh xạ theo từng dòng hàng', () => {
  it('🔴 dòng hàng có ánh xạ ⇒ trả kèm ánh xạ ĐẦY ĐỦ (giao diện không phải tự ghép)', async () => {
    const { service } = buildStateService();

    const state = await service.getState('org-1', 'order-1', POD_SCOPE_SYSTEM);

    expect(state.items).toHaveLength(2);
    const first = state.items[0];
    expect(first.podOrderItemId).toBe('item-1');
    expect(first.mapping?.id).toBe('map-1');
    expect(first.mapping?.providerProductId).toBe('MP-1');
    expect(first.mapping?.providerVariantId).toBe('MV-1');
    expect(first.mapping?.productionLine).toBe('line-1');
    expect(first.mapping?.providerName).toBe('Mango US');
  });

  it('dòng hàng CHƯA ánh xạ ⇒ `mapping = null`, không "nhận vơ" ánh xạ của dòng khác', async () => {
    const { service } = buildStateService();

    const state = await service.getState('org-1', 'order-1', POD_SCOPE_SYSTEM);

    expect(state.items[1].podOrderItemId).toBe('item-2');
    expect(state.items[1].mapping).toBeNull();
  });

  it('🔴 ánh xạ bị tắt (isActive = false) KHÔNG được coi là đã khai', async () => {
    const { service } = buildStateService({ mappings: [mappingRow({ isActive: false })] });

    const state = await service.getState('org-1', 'order-1', POD_SCOPE_SYSTEM);

    expect(state.items[0].mapping).toBeNull();
  });

  it('dùng ĐÚNG danh sách ánh xạ đã nạp cho readiness — không truy vấn thêm lần nào', async () => {
    const { service, repo } = buildStateService();

    await service.getState('org-1', 'order-1', POD_SCOPE_SYSTEM);

    expect(repo.listMappingsForOrganization).toHaveBeenCalledTimes(1);
    expect(repo.listProductDesigns).toHaveBeenCalledTimes(1);
  });

  it('chưa gán nhà cung cấp ⇒ vẫn trả đủ dòng hàng (giao diện dựng được khối cấu hình)', async () => {
    const { service } = buildStateService({ account: null });

    const state = await service.getState('org-1', 'order-1', POD_SCOPE_SYSTEM);

    expect(state.canFulfill).toBe(false);
    expect(state.items.map((item) => item.podOrderItemId)).toEqual(['item-1', 'item-2']);
    expect(state.items.every((item) => item.mapping === null)).toBe(true);
  });

  it('sẵn sàng + trạng thái DRAFT ⇒ canFulfill = true (nút gửi bật)', async () => {
    const { service } = buildStateService({ ready: true });

    const state = await service.getState('org-1', 'order-1', POD_SCOPE_SYSTEM);

    expect(state.ready).toBe(true);
    expect(state.canFulfill).toBe(true);
    expect(state.fulfillment).toBeNull();
    expect(FulfillmentStatus.DRAFT).toBe('DRAFT');
  });
});
