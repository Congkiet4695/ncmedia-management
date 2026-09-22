import { PodBrandMode } from '@prisma/client';
import { TIKTOK_IMAGE_USE_CASE } from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokCreateProductRequest } from '../../tiktok-sdk/types/tiktok-product.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import { applyManualOverride, parseManualOverride } from './pod-manual-listing';
import { PodListingPublisherService } from './pod-listing-publisher.service';
import { PodListingResolverService } from './pod-listing-resolver.service';
import type { ResolveContext, ResolvedListing } from './pod-listing-resolver.service';

/**
 * **Ảnh biến thể** (`sku_img`) — từ ảnh mặc định của GIÁ TRỊ trục đầu trong SKU Template tới
 * request Create Product.
 *
 * Ba ranh giới cần khoá:
 *  1. Resolver: tổ hợp KHÔNG có ảnh riêng kế thừa ảnh của giá trị thuộc trục ĐẦU (theo
 *     `sortOrder`, không theo tên "Color"); ảnh riêng thắng; ảnh khai ở trục sau bị bỏ.
 *  2. Manual listing (Custom Listing): dòng SKU không có `imageFileId` kế thừa `variations[0]
 *     .images`; xoá giá trị ⇒ ảnh của nó không còn; đổi trục đầu ⇒ không gắn nhầm ảnh cũ.
 *  3. Publisher: ảnh biến thể upload với **`use_case = ATTRIBUTE_IMAGE`** (hợp đồng TikTok cho
 *     `sku_img.uri`), một file dùng chung N SKU chỉ upload MỘT lần, `sku_img` chỉ gắn vào sales
 *     attribute ĐẦU, và bộ ảnh sản phẩm (`main_images`) không bị ảnh biến thể ghi đè.
 */

const CTX: TiktokShopContext = { accessToken: 't', shopCipher: 'c', shopId: 'shop-1', organizationId: 'org-1' };

// ---------------------------------------------------------------------------
// 1. Resolver — Auto Listing (template)
// ---------------------------------------------------------------------------

function link(axis: string, sortOrder: number, value: string, imageFileId: string | null) {
  return { variantValue: { id: `${axis}-${value}`, value, code: null, imageFileId, variant: { id: axis, name: axis, sortOrder } } };
}

function skuItem(over: Record<string, unknown>) {
  return {
    id: 'item',
    variantName: 'x',
    skuCode: null,
    barcode: null,
    priceAdjustmentType: 'NONE',
    priceAdjustmentValue: { toString: () => '0' },
    retailPrice: null,
    salePrice: { toString: () => '19.99', greaterThan: () => true, toFixed: () => '19.99' },
    quantity: 5,
    discount: null,
    imageFileId: null,
    isActive: true,
    sortOrder: 0,
    values: [],
    ...over,
  };
}

function resolverContext(items: unknown[]): ResolveContext {
  return {
    template: {
      id: 'tpl-1',
      name: 'Tee',
      market: 'US',
      categoryTemplate: {
        tiktokCategoryId: '601226',
        categoryName: 'Tee',
        categoryPath: null,
        attributes: [],
        packageWeight: '300',
        weightUnit: 'GRAM',
        packageLength: null,
        packageWidth: null,
        packageHeight: null,
        dimensionUnit: null,
        warehouse: null,
        sizeChartFileId: null,
        sizeChartTiktokImageUri: null,
        sizeChartImageUploadedAt: null,
        brandMode: PodBrandMode.NONE,
        tiktokBrandId: null,
        brandName: null,
      },
      descriptionTemplate: { contentHtml: '<p>Mô tả</p>', tokens: [] },
      imageTemplate: { id: 'img-1', items: [] },
      skuTemplate: { items, skuPrefix: null, skuSuffix: null, defaultSalePrice: null, currency: 'USD' },
      pricingStrategy: null,
      warehouse: null,
      packageWeight: null,
      weightUnit: null,
      packageLength: null,
      packageWidth: null,
      packageHeight: null,
      dimensionUnit: null,
      shippingTemplateId: null,
      handlingDays: null,
      brandMode: PodBrandMode.UNSET,
      tiktokBrandId: null,
      brandName: null,
    } as never,
    product: null,
    sessionProduct: null,
    shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
  };
}

describe('Resolver — tổ hợp kế thừa ảnh của giá trị trục đầu', () => {
  const resolver = new PodListingResolverService({} as never);

  it('không có ảnh riêng ⇒ lấy ảnh của giá trị trục ĐẦU (theo sortOrder, kể cả khi link xáo thứ tự)', () => {
    const { payload } = resolver.resolveFromContext(
      resolverContext([
        skuItem({
          id: 'i1',
          variantName: 'Black / S',
          // Link của trục Size (sortOrder 1) đứng TRƯỚC trong mảng — vẫn phải lấy ảnh của Color.
          values: [link('Size', 1, 'S', 'file-size-s'), link('Color', 0, 'Black', 'file-black')],
        }),
        skuItem({ id: 'i2', variantName: 'White / S', values: [link('Color', 0, 'White', null), link('Size', 1, 'S', 'file-size-s')] }),
      ]),
    );

    expect(payload.variants.map((variant) => variant.imageFileId)).toEqual(['file-black', null]);
  });

  it('ảnh RIÊNG của tổ hợp thắng ảnh mặc định của giá trị', () => {
    const { payload } = resolver.resolveFromContext(
      resolverContext([
        skuItem({ id: 'i1', variantName: 'Black / S', imageFileId: 'file-own', values: [link('Color', 0, 'Black', 'file-black')] }),
      ]),
    );
    expect(payload.variants[0].imageFileId).toBe('file-own');
  });

  it('trục đầu là Size (không phải Color) ⇒ vẫn lấy ảnh của Size — không hard-code tên trục', () => {
    const { payload } = resolver.resolveFromContext(
      resolverContext([
        skuItem({ id: 'i1', variantName: 'S / Black', values: [link('Color', 1, 'Black', 'file-black'), link('Size', 0, 'S', 'file-size-s')] }),
      ]),
    );
    expect(payload.variants[0].imageFileId).toBe('file-size-s');
  });
});

// ---------------------------------------------------------------------------
// 2. Manual listing — Custom Listing
// ---------------------------------------------------------------------------

function basePayload(): ResolvedListing {
  return {
    market: 'US',
    title: 'Tee',
    description: '<p>x</p>',
    category: { tiktokCategoryId: '601226', name: null, path: null },
    brand: { mode: PodBrandMode.NONE, tiktokBrandId: null, name: null },
    attributes: [],
    images: [],
    sizeChart: null,
    video: null,
    package: { weight: '300', weightUnit: 'GRAM', length: null, width: null, height: null, dimensionUnit: null },
    warehouse: { id: null, tiktokWarehouseId: null, name: null },
    shipping: { shippingTemplateId: null, handlingDays: null },
    pricing: null,
    variants: [],
    source: { productId: null, sessionProductId: 'sp-1', tiktokProductId: null, shopId: 'shop-1', listingTemplateId: '', imageTemplateId: null },
  };
}

const sku = (color: string, size: string, imageFileId?: string) => ({
  sellerSku: `${color}-${size}`.toUpperCase(),
  optionValues: [
    { name: 'Color', value: color },
    { name: 'Size', value: size },
  ],
  salePrice: '19.99',
  quantity: 3,
  ...(imageFileId ? { imageFileId } : {}),
});

describe('Manual listing — ảnh theo giá trị trục đầu', () => {
  it('dòng không có imageFileId ⇒ kế thừa ảnh của giá trị trục ĐẦU; dòng có ảnh riêng giữ nguyên', () => {
    const issues: never[] = [];
    const next = applyManualOverride(
      basePayload(),
      {
        variations: [
          { name: 'Color', values: ['Black', 'White'], images: [{ value: 'Black', fileId: 'file-black' }] },
          { name: 'Size', values: ['S', 'M'] },
        ],
        skus: [sku('Black', 'S'), sku('Black', 'M'), sku('White', 'S'), sku('White', 'M', 'file-own')],
      },
      issues,
    );

    expect(next.variants.map((variant) => [variant.sellerSku, variant.imageFileId])).toEqual([
      ['BLACK-S', 'file-black'],
      ['BLACK-M', 'file-black'],
      ['WHITE-S', null],
      ['WHITE-M', 'file-own'],
    ]);
  });

  it('🔴 trục đầu là Size (đã xoá Color) ⇒ ảnh của Color KHÔNG được gắn sang; Size không có ảnh ⇒ null', () => {
    const next = applyManualOverride(
      basePayload(),
      {
        variations: [{ name: 'Size', values: ['S', 'M'] }],
        skus: [
          { sellerSku: 'S', optionValues: [{ name: 'Size', value: 'S' }], salePrice: '19.99', quantity: 1 },
        ],
      },
      [],
    );
    expect(next.variants[0].imageFileId).toBeNull();
  });

  it('parseManualOverride: ảnh của giá trị ĐÃ XOÁ khỏi trục không được giữ lại; trục sau vẫn giữ được (backend không dùng)', () => {
    const parsed = parseManualOverride({
      variations: [
        {
          name: 'Color',
          values: ['Black'],
          images: [
            { value: 'Black', fileId: 'file-black', url: 'https://cdn/black.jpg' },
            { value: 'White', fileId: 'file-white' },
            { value: 'Navy', fileId: '' },
          ],
        },
      ],
      skus: [sku('Black', 'S')],
    });

    expect(parsed?.variations?.[0].images).toEqual([{ value: 'Black', fileId: 'file-black', url: 'https://cdn/black.jpg' }]);
  });

  it('nháp cũ không có `images` ⇒ đọc được như trước (tương thích ngược)', () => {
    const parsed = parseManualOverride({ variations: [{ name: 'Color', values: ['Black'] }], skus: [sku('Black', 'S')] });
    expect(parsed?.variations?.[0]).toEqual({ name: 'Color', values: ['Black'] });
  });
});

// ---------------------------------------------------------------------------
// 3. Publisher — upload đúng use_case, dùng chung uri, không ghi đè gallery
// ---------------------------------------------------------------------------

function buildPublisher() {
  const productApi = {
    createProduct: jest
      .fn<Promise<{ data: { productId: string; skus: never[] }; requestId: string }>, [unknown, TiktokCreateProductRequest]>()
      .mockResolvedValue({ data: { productId: 'TT-NEW', skus: [] }, requestId: 'req-1' }),
    uploadImage: jest.fn((_ctx: unknown, file: { fileName: string }, useCase: string) =>
      Promise.resolve({ data: { uri: `uri:${useCase}:${file.fileName}` }, requestId: 'up' }),
    ),
  };
  const prisma = {
    podTiktokShop: {
      findFirst: jest.fn().mockResolvedValue({
        name: 'Shop A',
        defaultWarehouse: { id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho' },
        warehouses: [],
      }),
    },
    podImageTemplateItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) },
    podSkuTemplateItem: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) },
    podSkuTemplateVariantValue: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({}) },
    podListingSessionProductImage: { updateMany: jest.fn().mockResolvedValue({}) },
  };
  const storage = {
    download: jest.fn((_org: string, fileId: string) =>
      Promise.resolve({ file: { originalName: `${fileId}.png`, mimeType: 'image/png' }, body: Buffer.from('x') }),
    ),
  };
  const service = new PodListingPublisherService(
    prisma as never,
    productApi as never,
    storage as never,
    {} as never,
    {} as never,
    {
      normalize: jest.fn((_o: string, _c: unknown, html: string) =>
        Promise.resolve({ html, stats: { total: 0, uploaded: 0, reused: 0, failed: 0, finalCount: 0 }, images: [] }),
      ),
    } as never,
  );
  return { service, productApi, prisma, storage };
}

describe('Publisher — ảnh biến thể lên TikTok', () => {
  it('🔴 ảnh biến thể upload với ATTRIBUTE_IMAGE, một file dùng chung 3 SKU chỉ upload MỘT lần, sku_img chỉ ở sales attribute đầu', async () => {
    const { service, productApi, prisma, storage } = buildPublisher();
    const payload: ResolvedListing = {
      ...basePayload(),
      images: [{ title: 'Front', assetType: 'MAIN_FRONT', fileId: 'file-front', url: 'https://cdn/front.png', imageKey: '', width: null, height: null, isRequired: true, tiktokImageUri: null, sortOrder: 0 }],
      variants: ['S', 'M', 'L'].map((size, index) => ({
        variantName: `Black / ${size}`,
        sellerSku: `BLACK-${size}`,
        barcode: null,
        optionValues: [{ name: 'Color', value: 'Black' }, { name: 'Size', value: size }],
        salePrice: '19.99',
        retailPrice: null,
        currency: 'USD',
        quantity: 1,
        imageFileId: 'file-black',
        sortOrder: index,
      })),
    };

    await service.publishListing({
      organizationId: 'org-1',
      ctx: CTX,
      payload,
      tiktokDraftId: null,
      imageUriCache: new Map(),
      log: jest.fn().mockResolvedValue(undefined),
    });

    const useCases = productApi.uploadImage.mock.calls.map((call) => [call[1].fileName, call[2]]);
    expect(useCases).toEqual([
      ['file-front.png', TIKTOK_IMAGE_USE_CASE.MAIN_IMAGE],
      ['file-black.png', TIKTOK_IMAGE_USE_CASE.ATTRIBUTE_IMAGE],
    ]);
    expect(storage.download).toHaveBeenCalledTimes(2);

    const request = productApi.createProduct.mock.calls[0][1];
    // Gallery = ảnh sản phẩm (MAIN_IMAGE), KHÔNG bị ảnh biến thể chen vào.
    expect(request.mainImages).toEqual([{ uri: 'uri:MAIN_IMAGE:file-front.png' }]);
    for (const row of request.skus ?? []) {
      expect(row.salesAttributes?.[0]).toEqual({ name: 'Color', valueName: 'Black', skuImg: { uri: 'uri:ATTRIBUTE_IMAGE:file-black.png' } });
      expect(row.salesAttributes?.[1].skuImg).toBeUndefined();
    }
    // uri ghi ngược vào CẢ tổ hợp lẫn giá trị trục để lần sau không upload lại.
    expect(prisma.podSkuTemplateItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', imageFileId: 'file-black' } }),
    );
    expect(prisma.podSkuTemplateVariantValue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', imageFileId: 'file-black' } }),
    );
  });

  it('uri ATTRIBUTE_IMAGE đã cache ở giá trị trục ⇒ không upload lại; uri MAIN_IMAGE cùng file KHÔNG được dùng nhầm', async () => {
    const { service, productApi, prisma } = buildPublisher();
    prisma.podSkuTemplateVariantValue.findMany.mockResolvedValue([{ imageFileId: 'file-black', tiktokImageUri: 'cached-attr-uri' }]);
    const payload: ResolvedListing = {
      ...basePayload(),
      images: [{ title: 'Front', assetType: 'MAIN_FRONT', fileId: 'file-front', url: '', imageKey: '', width: null, height: null, isRequired: true, tiktokImageUri: null, sortOrder: 0 }],
      variants: [{ variantName: 'Black / S', sellerSku: 'BLACK-S', barcode: null, optionValues: [{ name: 'Color', value: 'Black' }], salePrice: '19.99', retailPrice: null, currency: 'USD', quantity: 1, imageFileId: 'file-black', sortOrder: 0 }],
    };

    await service.publishListing({
      organizationId: 'org-1',
      ctx: CTX,
      payload,
      tiktokDraftId: null,
      // Cùng file đã có uri MAIN_IMAGE (dùng làm ảnh sản phẩm ở listing khác) — không được lấy nhầm cho sku_img.
      imageUriCache: new Map([['MAIN_IMAGE:file-black', Promise.resolve('main-uri-black')], ['MAIN_IMAGE:file-front', Promise.resolve('front')]]),
      log: jest.fn().mockResolvedValue(undefined),
    });

    expect(productApi.uploadImage).not.toHaveBeenCalled();
    const request = productApi.createProduct.mock.calls[0][1];
    expect(request.skus?.[0].salesAttributes?.[0].skuImg).toEqual({ uri: 'cached-attr-uri' });
  });
});
