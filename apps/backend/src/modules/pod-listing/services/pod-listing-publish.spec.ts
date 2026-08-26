import {
  PodListingPublisherService,
  PodPublishPayloadException,
} from './pod-listing-publisher.service';
import type { ResolvedListing } from './pod-listing-resolver.service';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';

/**
 * **Publish Draft** — luật quan trọng nhất của sprint: KHÔNG BAO GIỜ tạo sản phẩm trùng.
 *
 * Draft đã tồn tại trên TikTok ⇒ đi Edit Product (`save_mode = LISTING`) trên đúng id đó.
 * Gọi Create Product lần hai là shop có ngay hai sản phẩm giống hệt, và không có cách nào
 * gộp lại — đó là loại lỗi không sửa được bằng một bản vá.
 */

const CTX: TiktokShopContext = {
  accessToken: 'token',
  shopCipher: 'cipher',
  shopId: 'shop-1',
  organizationId: 'org-1',
};

function buildPayload(overrides: Partial<ResolvedListing> = {}): ResolvedListing {
  return {
    market: 'US',
    title: 'Halloween Tee',
    description: '<p>hi</p>',
    category: { tiktokCategoryId: '600001', name: 'Tees', path: null },
    brand: { tiktokBrandId: 'B1', name: 'NoBrand' },
    attributes: [],
    images: [{ title: 'front', fileId: 'file-1', url: '', tiktokImageUri: 'uri-1', sortOrder: 0 }],
    package: { weight: '0.3', weightUnit: 'KILOGRAM' },
    warehouse: { id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho A' },
    shipping: { shippingTemplateId: null, handlingDays: null },
    pricing: null,
    variants: [
      {
        variantName: 'Black / M',
        sellerSku: 'SKU-1',
        salePrice: '19.99',
        retailPrice: null,
        currency: 'USD',
        quantity: 10,
        optionValues: [{ name: 'Color', value: 'Black' }],
        imageFileId: null,
      },
    ],
    source: {
      productId: null,
      sessionProductId: 'sp-1',
      tiktokProductId: null,
      shopId: 'shop-1',
      listingTemplateId: 't-1',
      imageTemplateId: null,
    },
    ...overrides,
  } as unknown as ResolvedListing;
}

function buildService() {
  const productApi = {
    publishProduct: jest.fn().mockResolvedValue({
      data: {
        productId: 'TT-PRODUCT-1',
        skus: [{ id: 'TT-SKU-1', sellerSku: 'SKU-1' }],
        audit: { status: 'AUDITING' },
        warnings: [{ message: 'Ảnh nền chưa trắng' }],
      },
      requestId: 'req-1',
    }),
    createProduct: jest.fn().mockResolvedValue({
      data: { productId: 'TT-PRODUCT-NEW', skus: [{ id: 'TT-SKU-1', sellerSku: 'SKU-1' }] },
      requestId: 'req-2',
    }),
    uploadImage: jest.fn(),
  };

  const prisma = {
    podTiktokShop: {
      findFirst: jest.fn().mockResolvedValue({
        name: 'Playmaker',
        defaultWarehouse: { id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho A' },
        warehouses: [{ id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho A', isDefault: true }],
      }),
    },
    podImageTemplateItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    podSkuTemplateItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    podListingSessionProductImage: { updateMany: jest.fn() },
  };

  const service = new PodListingPublisherService(
    prisma as never,
    productApi as never,
    {} as never,
    {} as never,
    {} as never,
  );

  /** Đối số của lời gọi thứ n — `jest.fn()` trả `any`, ép kiểu một chỗ thay vì rải khắp test. */
  const publishArgs = (index = 0) =>
    productApi.publishProduct.mock.calls[index] as unknown as [
      unknown,
      string,
      Record<string, unknown>,
    ];
  const createArgs = (index = 0) =>
    productApi.createProduct.mock.calls[index] as unknown as [unknown, Record<string, unknown>];

  const publish = (tiktokDraftId: string | null, payload = buildPayload()) =>
    service.publishListing({
      organizationId: 'org-1',
      ctx: CTX,
      payload,
      payloadHash: 'hash-1',
      tiktokDraftId,
      // Ảnh đã có `uri` sẵn trong payload ⇒ cache được nạp từ đó, không upload lại.
      imageUriCache: new Map([['file-1', Promise.resolve('uri-1')]]),
      log: jest.fn().mockResolvedValue(undefined),
    });

  return { service, publish, productApi, prisma, publishArgs, createArgs };
}

describe('PodListingPublisherService.publishListing', () => {
  it('🔴 Draft ĐÃ có trên TikTok ⇒ Edit Product, TUYỆT ĐỐI không Create Product', async () => {
    const { publish, productApi, publishArgs } = buildService();

    const outcome = await publish('TT-PRODUCT-1');

    expect(productApi.createProduct).not.toHaveBeenCalled();
    expect(productApi.publishProduct).toHaveBeenCalledTimes(1);
    expect(publishArgs()[1]).toBe('TT-PRODUCT-1');
    expect(outcome.mode).toBe('EDIT');
    expect(outcome.remoteProductId).toBe('TT-PRODUCT-1');
  });

  it('Edit Product KHÔNG gửi kèm `idempotencyKey` (trường chỉ có nghĩa lúc tạo)', async () => {
    const { publish, publishArgs } = buildService();

    await publish('TT-PRODUCT-1');

    const body = publishArgs()[2];
    expect('idempotencyKey' in body).toBe(false);
    // Nhưng vẫn là FULL payload: Edit Product ghi đè trắng mọi trường không gửi.
    expect(body.title).toBe('Halloween Tee');
    expect(body.categoryId).toBe('600001');
    expect(body.brandId).toBe('B1');
    expect((body.skus as unknown[]).length).toBe(1);
    expect((body.mainImages as unknown[]).length).toBe(1);
  });

  it('Draft CHƯA lên sàn ⇒ Create Product một lần, ở chế độ LISTING và có idempotencyKey', async () => {
    const { publish, productApi, createArgs } = buildService();

    const outcome = await publish(null);

    expect(productApi.publishProduct).not.toHaveBeenCalled();
    expect(productApi.createProduct).toHaveBeenCalledTimes(1);
    const body = createArgs()[1];
    expect(body.saveMode).toBe('LISTING');
    // Thử lại sau lỗi mạng phải nhận về đúng sản phẩm cũ, không đẻ bản trùng.
    expect(body.idempotencyKey).toBe('hash-1');
    expect(outcome.mode).toBe('CREATE');
    expect(outcome.remoteProductId).toBe('TT-PRODUCT-NEW');
  });

  it('Kho được quyết theo SHOP ngay lúc publish, không lấy từ payload', async () => {
    const { publish, publishArgs } = buildService();

    await publish(
      'TT-PRODUCT-1',
      buildPayload({ warehouse: { id: null, tiktokWarehouseId: null, name: null } }),
    );

    const body = publishArgs()[2] as {
      skus: Array<{ inventory: Array<{ warehouseId: string }> }>;
    };
    expect(body.skus[0].inventory[0].warehouseId).toBe('TT-WH-1');
  });

  it('Trả về đủ dấu vết cho Publish History: request, response, audit, request_id, sku id', async () => {
    const { publish } = buildService();

    const outcome = await publish('TT-PRODUCT-1');

    expect(outcome.auditStatus).toBe('AUDITING');
    expect(outcome.tiktokRequestId).toBe('req-1');
    expect(outcome.skuIds).toEqual([{ sellerSku: 'SKU-1', tiktokSkuId: 'TT-SKU-1' }]);
    expect(outcome.warnings).toEqual(['Ảnh nền chưa trắng']);
    expect(outcome.request.title).toBe('Halloween Tee');
    expect(outcome.response).toMatchObject({ productId: 'TT-PRODUCT-1' });
  });

  it('🔴 Payload mất biến thể ⇒ hỏng NGAY, không gửi một sản phẩm rỗng lên sàn', async () => {
    const { publish, productApi } = buildService();

    await expect(publish('TT-PRODUCT-1', buildPayload({ variants: [] }))).rejects.toBeInstanceOf(
      PodPublishPayloadException,
    );
    expect(productApi.publishProduct).not.toHaveBeenCalled();
    expect(productApi.createProduct).not.toHaveBeenCalled();
  });

  it('TikTok trả về product_id trống ở nhánh EDIT ⇒ dùng lại id đã gửi (sản phẩm ĐÃ được sửa)', async () => {
    const { publish, productApi } = buildService();
    productApi.publishProduct.mockResolvedValueOnce({ data: { skus: [] }, requestId: 'req-3' });

    const outcome = await publish('TT-PRODUCT-1');

    // Báo hỏng ở đây chỉ khiến người dùng bấm Publish thêm lần nữa cho một sản phẩm đã publish.
    expect(outcome.remoteProductId).toBe('TT-PRODUCT-1');
  });
});
