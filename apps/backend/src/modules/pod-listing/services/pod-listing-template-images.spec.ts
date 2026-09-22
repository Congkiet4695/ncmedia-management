import { PodBrandMode, PodImageAssetType, PodListingSessionImageType } from '@prisma/client';
import { TIKTOK_IMAGE_USE_CASE } from '../../tiktok-sdk/tiktok-sdk.constants';
import type { TiktokCreateProductRequest } from '../../tiktok-sdk/types/tiktok-product.types';
import type { TiktokShopContext } from '../../tiktok-sdk/types/tiktok-shop-context.type';
import { PodListingPublisherService } from './pod-listing-publisher.service';
import { PodListingResolverService, type ResolveContext } from './pod-listing-resolver.service';

/**
 * **Ảnh từ template → TikTok — đường đi THẬT, đầu-cuối** (không mock resolver):
 *
 * ```
 *   Custom Listing: manualData (variations[0].images + skus) + ảnh nháp ──resolveFromContext──▶ payload
 *   Auto Listing:   SKU Template (ảnh giá trị trục) + Category Template (bảng size) ──▶ payload
 *   payload ──publishDraft (SDK mock)──▶ request Create Product
 * ```
 *
 * Ba loại ảnh phải đi ba đường riêng, đúng use_case và đúng trường:
 *   - ảnh sản phẩm   → Upload `MAIN_IMAGE`        → `main_images[]`
 *   - ảnh biến thể   → Upload `ATTRIBUTE_IMAGE`   → `skus[].sales_attributes[0].sku_img.uri`
 *   - bảng size      → Upload `SIZE_CHART_IMAGE`  → `size_chart.image.uri`
 * Upload hỏng ⇒ KHÔNG gửi Create Product, lỗi nói rõ ảnh nào.
 */

const ORG = 'org-1';
const CTX: TiktokShopContext = { accessToken: 't', shopCipher: 'c', shopId: 'shop-1', organizationId: ORG };

function categoryTemplate(sizeChartFileId: string | null) {
  return {
    id: 'cat-1',
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
    sizeChartFileId,
    brandMode: PodBrandMode.NONE,
    tiktokBrandId: null,
    brandName: null,
  };
}

function template(over: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1',
    name: 'Tee',
    market: 'US',
    categoryTemplate: categoryTemplate(null),
    descriptionTemplate: { contentHtml: '<p>Mô tả</p>', tokens: [] },
    imageTemplate: { id: 'img-1', items: [] },
    skuTemplate: { items: [], skuPrefix: null, skuSuffix: null, defaultSalePrice: null, currency: 'USD' },
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
    ...over,
  } as never;
}

/** Draft Product của Custom Listing — đúng thứ `pod_listing_session_products` + images lưu. */
function sessionProduct(manualData: unknown, images: Array<{ imageType: PodListingSessionImageType; imageUrl: string; fileId: string | null }>) {
  return {
    id: 'sp-1',
    title: 'Tee nhập tay',
    manualData,
    images: images.map((image, index) => ({ id: `img-${index}`, sortOrder: index, remoteUri: null, ...image })),
  } as never;
}

function buildPublisher(options: { failUseCase?: string; failFile?: string } = {}) {
  const productApi = {
    createProduct: jest
      .fn<Promise<{ data: { productId: string; skus: never[] }; requestId: string }>, [unknown, TiktokCreateProductRequest]>()
      .mockResolvedValue({ data: { productId: 'TT-NEW', skus: [] }, requestId: 'req-1' }),
    uploadImage: jest.fn((_ctx: unknown, file: { fileName: string }, useCase: string) =>
      useCase === options.failUseCase || file.fileName === options.failFile
        ? Promise.reject(new Error(`TikTok từ chối ${file.fileName}`))
        : Promise.resolve({ data: { uri: `uri:${useCase}:${file.fileName}` }, requestId: 'up' }),
    ),
  };
  const prisma = {
    podTiktokShop: {
      findFirst: jest.fn().mockResolvedValue({ name: 'Shop A', defaultWarehouse: { id: 'wh-1', tiktokWarehouseId: 'TT-WH-1', name: 'Kho' }, warehouses: [] }),
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
    { normalize: jest.fn((_o: string, _c: unknown, html: string) => Promise.resolve({ html, stats: { total: 0, uploaded: 0, reused: 0, failed: 0, finalCount: 0 }, images: [] })) } as never,
  );
  return { service, productApi, prisma, storage };
}

const resolver = new PodListingResolverService({} as never);

async function publish(ctx: ResolveContext, options: { failUseCase?: string; failFile?: string } = {}) {
  const { payload, issues } = resolver.resolveFromContext(ctx);
  const errors = issues.filter((issue) => issue.level === 'ERROR');
  const { service, productApi, storage } = buildPublisher(options);
  const log = jest.fn().mockResolvedValue(undefined);
  const outcome = await service.publishDraft({ organizationId: ORG, ctx: CTX, payload, imageUriCache: new Map(), log });
  const request = productApi.createProduct.mock.calls[0]?.[1];
  const uploads = productApi.uploadImage.mock.calls.map((call) => `${call[2]}:${call[1].fileName}`);
  return { payload, errors, outcome, request, uploads, storage, log };
}

/** Như `publish` nhưng giữ lại mock SDK để kiểm "Create Product KHÔNG được gọi". */
function publishWithApi(ctx: ResolveContext, options: { failUseCase?: string; failFile?: string }) {
  const { payload } = resolver.resolveFromContext(ctx);
  const { service, productApi } = buildPublisher(options);
  const result = service.publishDraft({ organizationId: ORG, ctx: CTX, payload, imageUriCache: new Map(), log: jest.fn().mockResolvedValue(undefined) });
  return { result, productApi };
}

const manual = (skus: Array<Record<string, unknown>>, variations: unknown[]) => ({
  description: '<p>Mô tả nhập tay</p>',
  category: { tiktokCategoryId: '601226', name: 'Tee', path: null },
  brand: { tiktokBrandId: null, name: null },
  attributes: [],
  package: { weight: '300', weightUnit: 'GRAM' },
  variations,
  skus,
});
const sku = (color: string, size: string) => ({
  sellerSku: `${color}-${size}`.toUpperCase(),
  optionValues: [
    { name: 'Color', value: color },
    { name: 'Size', value: size },
  ],
  salePrice: '19.99',
  quantity: 5,
});

describe('Custom Listing — ảnh biến thể từ SKU Template + bảng size từ Category Template', () => {
  it('CASE 1/6: Color có ảnh + ảnh sản phẩm + bảng size ⇒ ba loại ảnh đi ba đường, đúng từng Color', async () => {
    const ctx: ResolveContext = {
      template: template({ categoryTemplate: categoryTemplate('file-size-chart') }),
      product: null,
      sessionProduct: sessionProduct(
        manual(
          [sku('Black', 'S'), sku('Black', 'M'), sku('White', 'S'), sku('White', 'M')],
          [
            { name: 'Color', values: ['Black', 'White'], images: [{ value: 'Black', fileId: 'file-black' }, { value: 'White', fileId: 'file-white' }] },
            { name: 'Size', values: ['S', 'M'] },
          ],
        ),
        [
          { imageType: PodListingSessionImageType.MAIN, imageUrl: 'https://cdn/front.png', fileId: 'file-front' },
          { imageType: PodListingSessionImageType.MAIN, imageUrl: 'https://cdn/back.png', fileId: 'file-back' },
        ],
      ),
      shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
    };

    const { errors, request, uploads } = await publish(ctx);

    expect(errors).toEqual([]);
    // Upload: 2 ảnh sản phẩm (MAIN) + 2 ảnh màu (ATTRIBUTE, mỗi màu 1 lần dù 2 SKU) + 1 bảng size (SIZE_CHART).
    expect(uploads.sort()).toEqual([
      'ATTRIBUTE_IMAGE:file-black.png',
      'ATTRIBUTE_IMAGE:file-white.png',
      'MAIN_IMAGE:file-back.png',
      'MAIN_IMAGE:file-front.png',
      'SIZE_CHART_IMAGE:file-size-chart.png',
    ]);
    // Gallery giữ nguyên thứ tự và KHÔNG chứa ảnh màu / bảng size.
    expect(request?.mainImages).toEqual([{ uri: 'uri:MAIN_IMAGE:file-front.png' }, { uri: 'uri:MAIN_IMAGE:file-back.png' }]);
    expect(request?.sizeChart).toEqual({ image: { uri: 'uri:SIZE_CHART_IMAGE:file-size-chart.png' } });
    expect(request?.skus?.map((row) => [row.sellerSku, row.salesAttributes?.[0].skuImg?.uri, row.salesAttributes?.[1].skuImg])).toEqual([
      ['BLACK-S', 'uri:ATTRIBUTE_IMAGE:file-black.png', undefined],
      ['BLACK-M', 'uri:ATTRIBUTE_IMAGE:file-black.png', undefined],
      ['WHITE-S', 'uri:ATTRIBUTE_IMAGE:file-white.png', undefined],
      ['WHITE-M', 'uri:ATTRIBUTE_IMAGE:file-white.png', undefined],
    ]);
  });

  it('CASE 2: một số Color không có ảnh ⇒ SKU đó không có sku_img, không upload gì cho nó, listing vẫn đi', async () => {
    const ctx: ResolveContext = {
      template: template(),
      product: null,
      sessionProduct: sessionProduct(
        manual([sku('Black', 'S'), sku('White', 'S')], [{ name: 'Color', values: ['Black', 'White'], images: [{ value: 'Black', fileId: 'file-black' }] }, { name: 'Size', values: ['S'] }]),
        [{ imageType: PodListingSessionImageType.MAIN, imageUrl: 'https://cdn/front.png', fileId: 'file-front' }],
      ),
      shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
    };
    const { request, uploads } = await publish(ctx);
    expect(uploads.filter((u) => u.startsWith('ATTRIBUTE'))).toEqual(['ATTRIBUTE_IMAGE:file-black.png']);
    expect(request?.skus?.map((row) => row.salesAttributes?.[0].skuImg?.uri)).toEqual(['uri:ATTRIBUTE_IMAGE:file-black.png', undefined]);
  });

  it('CASE 3/5/10: nháp không có ảnh biến thể, không bảng size (nháp cũ) ⇒ như trước: không sku_img, không size_chart', async () => {
    const ctx: ResolveContext = {
      template: template(),
      product: null,
      sessionProduct: sessionProduct(
        manual([sku('Black', 'S')], [{ name: 'Color', values: ['Black'] }, { name: 'Size', values: ['S'] }]),
        [{ imageType: PodListingSessionImageType.MAIN, imageUrl: 'https://cdn/front.png', fileId: 'file-front' }],
      ),
      shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
    };
    const { request, uploads } = await publish(ctx);
    expect(uploads).toEqual(['MAIN_IMAGE:file-front.png']);
    expect(request?.sizeChart).toBeUndefined();
    expect(request?.skus?.[0].salesAttributes?.[0].skuImg).toBeUndefined();
  });

  it('🔴 bảng size do Category Template áp vào nháp (chỉ có fileId, chưa có URL) vẫn phải lên TikTok', async () => {
    const ctx: ResolveContext = {
      template: template(),
      product: null,
      sessionProduct: sessionProduct(
        manual([sku('Black', 'S')], [{ name: 'Color', values: ['Black'] }, { name: 'Size', values: ['S'] }]),
        [
          { imageType: PodListingSessionImageType.MAIN, imageUrl: 'https://cdn/front.png', fileId: 'file-front' },
          // Form Custom Listing áp Category Template: bảng size chỉ mang fileId, imageUrl rỗng.
          { imageType: PodListingSessionImageType.SIZE_CHART, imageUrl: '', fileId: 'file-size-chart' },
        ],
      ),
      shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
    };
    const { payload, request, uploads } = await publish(ctx);
    expect(payload.sizeChart).toEqual({ fileId: 'file-size-chart', url: null, tiktokImageUri: null });
    expect(uploads).toContain('SIZE_CHART_IMAGE:file-size-chart.png');
    expect(request?.sizeChart).toEqual({ image: { uri: 'uri:SIZE_CHART_IMAGE:file-size-chart.png' } });
    expect(request?.mainImages).toEqual([{ uri: 'uri:MAIN_IMAGE:file-front.png' }]);
  });

  it('CASE 9: upload ảnh biến thể hỏng ⇒ KHÔNG gọi Create Product, lỗi nêu rõ Color=Black', async () => {
    const ctx: ResolveContext = {
      template: template(),
      product: null,
      sessionProduct: sessionProduct(
        manual([sku('Black', 'S'), sku('White', 'S')], [{ name: 'Color', values: ['Black', 'White'], images: [{ value: 'Black', fileId: 'file-black' }, { value: 'White', fileId: 'file-white' }] }, { name: 'Size', values: ['S'] }]),
        [{ imageType: PodListingSessionImageType.MAIN, imageUrl: 'https://cdn/front.png', fileId: 'file-front' }],
      ),
      shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
    };
    const attempt = publishWithApi(ctx, { failFile: 'file-black.png' });
    await expect(attempt.result).rejects.toThrow(/ảnh biến thể Color=Black.*TikTok từ chối file-black.png/);
    expect(attempt.productApi.createProduct).not.toHaveBeenCalled();
  });

  it('CASE 9: upload bảng size hỏng ⇒ KHÔNG gọi Create Product, lỗi nói rõ là bảng size', async () => {
    const ctx: ResolveContext = {
      template: template({ categoryTemplate: categoryTemplate('file-size-chart') }),
      product: null,
      sessionProduct: sessionProduct(
        manual([sku('Black', 'S')], [{ name: 'Color', values: ['Black'] }, { name: 'Size', values: ['S'] }]),
        [{ imageType: PodListingSessionImageType.MAIN, imageUrl: 'https://cdn/front.png', fileId: 'file-front' }],
      ),
      shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
    };
    const attempt = publishWithApi(ctx, { failUseCase: TIKTOK_IMAGE_USE_CASE.SIZE_CHART_IMAGE });
    await expect(attempt.result).rejects.toThrow(/Không tải được bảng size lên TikTok/);
    expect(attempt.productApi.createProduct).not.toHaveBeenCalled();
  });
});

describe('Auto Listing — SKU Template + Category Template', () => {
  const link = (axis: string, sortOrder: number, value: string, imageFileId: string | null) => ({
    variantValue: { id: `${axis}-${value}`, value, code: null, imageFileId, variant: { id: axis, name: axis, sortOrder } },
  });
  const item = (color: string, size: string, colorImage: string | null) => ({
    id: `${color}-${size}`,
    variantName: `${color} / ${size}`,
    skuCode: `${color}-${size}`.toUpperCase(),
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
    values: [link('Size', 1, size, null), link('Color', 0, color, colorImage)],
  });

  it('CASE 8: ảnh giá trị Color của SKU Template + bảng size Category Template + bộ ảnh Image Template ⇒ đúng ba đường', async () => {
    const ctx: ResolveContext = {
      template: template({
        categoryTemplate: categoryTemplate('file-size-chart'),
        imageTemplate: {
          id: 'img-1',
          items: [
            { id: 'i1', title: 'Front', assetType: PodImageAssetType.MAIN_FRONT, fileId: 'file-mock-front', imageUrl: 'https://cdn/mock-front.png', imageKey: 'k1', width: null, height: null, isRequired: true, tiktokImageUri: null, displayOrder: 0 },
          ],
        },
        skuTemplate: {
          items: [item('Black', 'S', 'file-black'), item('Black', 'M', 'file-black'), item('White', 'S', null)],
          skuPrefix: null,
          skuSuffix: null,
          defaultSalePrice: null,
          currency: 'USD',
        },
      }),
      product: { id: 'p-1', tiktokProductId: 'TT-SRC', title: 'Tee', description: null, categoryName: null, brandName: null, variants: [], images: [], videos: [] },
      sessionProduct: null,
      shop: { id: 'shop-1', name: 'Shop A', region: 'US' },
    };
    const { errors, request, uploads } = await publish(ctx);
    expect(errors).toEqual([]);
    expect(uploads.sort()).toEqual(['ATTRIBUTE_IMAGE:file-black.png', 'MAIN_IMAGE:file-mock-front.png', 'SIZE_CHART_IMAGE:file-size-chart.png']);
    expect(request?.mainImages).toEqual([{ uri: 'uri:MAIN_IMAGE:file-mock-front.png' }]);
    expect(request?.sizeChart).toEqual({ image: { uri: 'uri:SIZE_CHART_IMAGE:file-size-chart.png' } });
    expect(request?.skus?.map((row) => row.salesAttributes?.[0].skuImg?.uri)).toEqual([
      'uri:ATTRIBUTE_IMAGE:file-black.png',
      'uri:ATTRIBUTE_IMAGE:file-black.png',
      undefined,
    ]);
  });
});
