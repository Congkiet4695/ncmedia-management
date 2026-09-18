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
    // Ảnh mô tả: không có ảnh ⇒ trả nguyên HTML.
    {
      normalize: jest.fn((_o: string, _c: unknown, html: string) =>
        Promise.resolve({ html, stats: { total: 0, uploaded: 0, reused: 0, failed: 0, finalCount: 0 } }),
      ),
    } as never,
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
      tiktokDraftId,
      // Ảnh đã có `uri` sẵn trong payload ⇒ cache được nạp từ đó, không upload lại.
      // 🔴 Khoá cache nay gồm CẢ use case (`MAIN_IMAGE:<fileId>`): cùng một tấm ảnh dùng làm
      // ảnh sản phẩm và làm bảng size là hai `uri` khác nhau phía TikTok. Xem
      // `PodListingPublisherService.cacheKey`.
      imageUriCache: new Map([['MAIN_IMAGE:file-1', Promise.resolve('uri-1')]]),
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
    expect(typeof body.idempotencyKey).toBe('string');
    // TikTok giới hạn 128 ký tự cho `idempotency_key`.
    expect((body.idempotencyKey as string).length).toBeGreaterThan(0);
    expect((body.idempotencyKey as string).length).toBeLessThanOrEqual(128);
    expect(outcome.mode).toBe('CREATE');
    expect(outcome.remoteProductId).toBe('TT-PRODUCT-NEW');
  });

  it('🔴 Retry: publish LẠI cùng một listing ⇒ `idempotencyKey` PHẢI khác lần trước', async () => {
    const { publish, createArgs } = buildService();

    // Cùng payload, cùng listing, cùng shop — đúng kịch bản bấm Retry sau khi lỗi.
    const payload = buildPayload();
    await publish(null, payload);
    await publish(null, payload);

    const first = createArgs(0)[1].idempotencyKey as string;
    const second = createArgs(1)[1].idempotencyKey as string;

    // Trước đây cả hai đều là sha256(payload) ⇒ TikTok trả 12052996 ở lần thứ hai.
    expect(second).not.toBe(first);
  });

  it('🔴 Publish All: mỗi listing một `idempotencyKey` riêng, kể cả khi payload trùng nhau', async () => {
    const { publish, createArgs } = buildService();

    await publish(null, buildPayload());
    await publish(null, buildPayload());

    const keys = new Set([
      createArgs(0)[1].idempotencyKey as string,
      createArgs(1)[1].idempotencyKey as string,
    ]);
    expect(keys.size).toBe(2);
  });

  it('`idempotencyKey` KHÔNG dẫn xuất từ TikTok Product ID / Draft ID / SKU', async () => {
    const { publish, createArgs } = buildService();

    await publish(null);

    const key = createArgs()[1].idempotencyKey as string;
    expect(key).not.toContain('TT-PRODUCT');
    expect(key).not.toContain('SKU');
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

/**
 * Ảnh trong MÔ TẢ đi qua `PodDescriptionImageService` TRƯỚC khi dựng request — mô tả gửi TikTok
 * là bản đã chuẩn hoá (src = URL DESCRIPTION_IMAGE, kèm width/height).
 */
describe('PodListingPublisherService — ảnh trong mô tả', () => {
  const buildWithNormalizer = (normalize: jest.Mock) => {
    const productApi = {
      createProduct: jest.fn().mockResolvedValue({
        data: { productId: 'TT-NEW', skus: [{ id: 'S', sellerSku: 'SKU-1' }] },
        requestId: 'r',
      }),
      publishProduct: jest.fn(),
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
      { normalize } as never,
    );
    const log = jest.fn().mockResolvedValue(undefined);
    return { service, productApi, log };
  };

  it('🔴 Create Draft: mô tả gửi đi là bản ĐÃ đổi src sang URL DESCRIPTION_IMAGE của TikTok', async () => {
    // URL đúng dạng TikTok trả về — query có `&`.
    const TT_URL =
      'https://p16-oec-general-useast5.ttcdn-us.com/tos-useast5-i-omjb5zjo8w-tx/1~tplv-fhlh96nyum-origin-jpeg.jpeg?dr=12178&from=520841845&t=555f072d';
    const normalize = jest.fn().mockResolvedValue({
      html: `<p>hi</p><img src="${TT_URL}" width="1600" height="900">`,
      stats: { total: 1, uploaded: 1, reused: 0, failed: 0, finalCount: 1 },
      images: [
        { index: 0, sourceType: 'STORAGE', sourceHost: 'cdn.ncmedia.test', action: 'UPLOADED', useCase: 'DESCRIPTION_IMAGE', resultHost: 'p16-oec-general-useast5.ttcdn-us.com', width: 1600, height: 900 },
      ],
    });
    const { service, productApi, log } = buildWithNormalizer(normalize);

    await service.publishDraft({
      organizationId: 'org-1',
      ctx: CTX,
      payload: buildPayload({ description: '<p>hi</p><img src="https://cdn.ncmedia.test/uploads/a.jpg">' }),
      imageUriCache: new Map([['MAIN_IMAGE:file-1', Promise.resolve('uri-1')]]),
      log,
    });

    expect(normalize).toHaveBeenCalledTimes(1);
    expect((normalize.mock.calls[0] as unknown[])[2]).toBe('<p>hi</p><img src="https://cdn.ncmedia.test/uploads/a.jpg">');
    // 🔴 BOUNDARY SDK: đúng body đưa vào `productApi.createProduct` (→ ProductsPost).
    const request = (productApi.createProduct.mock.calls[0] as unknown[])[1] as { description: string };
    expect(request.description).toBe(`<p>hi</p><img src="${TT_URL}" width="1600" height="900">`);
    expect(request.description).not.toContain('cdn.ncmedia.test');
    expect(request.description).not.toContain('&amp;');
    expect(request.description).not.toMatch(/src="(blob:|data:)/);
    // Log số liệu — không có token nào ở đây.
    const logged = (log.mock.calls as unknown[][]).find((call) => call[2] === 'Đã chuẩn bị ảnh trong mô tả');
    expect(logged?.[3]).toMatchObject({
      descriptionImageCount: 1,
      uploadedCount: 1,
      reusedCount: 0,
      failedCount: 0,
      finalDescriptionImageCount: 1,
      useCase: 'DESCRIPTION_IMAGE',
      images: [expect.objectContaining({ sourceType: 'STORAGE', action: 'UPLOADED', normalized: true })],
    });
    // Log ngay trước SDK: chỉ host, không URL đầy đủ, và host phải là TikTok.
    const sent = (log.mock.calls as unknown[][]).find((call) => call[2] === 'Gửi Create Product (AS_DRAFT)');
    expect(sent?.[3]).toMatchObject({
      descriptionImages: { count: 1, hosts: ['p16-oec-general-useast5.ttcdn-us.com'] },
    });
  });

  it('🔴 upload ảnh mô tả hỏng ⇒ KHÔNG gọi Create Product', async () => {
    const normalize = jest.fn().mockRejectedValue(new Error('Không thể upload ảnh trong mô tả lên TikTok Shop. Vui lòng thử lại.'));
    const { service, productApi, log } = buildWithNormalizer(normalize);

    await expect(
      service.publishDraft({
        organizationId: 'org-1',
        ctx: CTX,
        payload: buildPayload({ description: '<img src="https://cdn.ncmedia.test/uploads/a.jpg">' }),
        imageUriCache: new Map(),
        log,
      }),
    ).rejects.toThrow('Không thể upload ảnh trong mô tả');
    expect(productApi.createProduct).not.toHaveBeenCalled();
    expect(productApi.uploadImage).not.toHaveBeenCalled();
  });
});
