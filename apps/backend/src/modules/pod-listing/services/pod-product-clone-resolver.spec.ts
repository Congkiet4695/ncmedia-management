import { PodBrandMode, PodListingMarket, Prisma } from '@prisma/client';
import { POD_DRAFT_ISSUE_CODES } from '../constants/pod-listing.constants';
import {
  marketOfRegion,
  resolveCloneListing,
  type CloneCategory,
  type CloneSourceProduct,
} from './pod-product-clone-resolver.service';

/**
 * **Nhân bản sản phẩm** — luật quan trọng nhất: bản sao mang ĐỦ NỘI DUNG của nguồn nhưng KHÔNG
 * mang bất kỳ định danh nào chỉ có nghĩa ở shop nguồn (TikTok Product ID, SKU ID, `uri` ảnh,
 * video id, kho, size chart template). Kiểm bằng hàm thuần — không cần database.
 */

const CATEGORY: CloneCategory = { tiktokCategoryId: '600001', localName: 'T-Shirts', path: 'Apparel > Tops > T-Shirts' };

function buildProduct(overrides: Partial<CloneSourceProduct> = {}): CloneSourceProduct {
  return {
    id: 'prod-1',
    organizationId: 'org-1',
    shopId: 'shop-src',
    tiktokProductId: 'TT-PRODUCT-SRC',
    title: 'Halloween Tee',
    description: '<p>Soft cotton</p><img src="https://p16-oec.tiktokcdn.com/desc-1.jpg">',
    status: 'ACTIVATE',
    deactivatedAt: null,
    tiktokBrandId: 'BRAND-1',
    brandName: 'Comfort Colors',
    tiktokCategoryId: '600001',
    categoryName: 'T-Shirts',
    categoryPath: 'Apparel > Tops > T-Shirts',
    packageLength: '10',
    packageWidth: '8',
    packageHeight: '1',
    dimensionUnit: 'INCH',
    packageWeight: '0.5',
    weightUnit: 'POUND',
    searchTerms: ['halloween', 'tee'],
    keyProductFeatures: ['100% cotton'],
    sizeChartUri: 'tos-size-uri',
    sizeChartUrl: 'https://p16-oec.tiktokcdn.com/size.jpg',
    sizeChartTemplateId: null,
    currency: 'USD',
    shop: { id: 'shop-src', name: 'Source Shop', region: 'US' },
    variants: [
      {
        id: 'v-1',
        tiktokSkuId: 'TT-SKU-1',
        sellerSku: 'HAL-S',
        variantName: 'Black / S',
        salesAttributes: [
          { id: '100000', name: 'Color', valueId: '1', valueName: 'Black', skuImg: { urls: ['https://p16-oec.tiktokcdn.com/sku-1.jpg'] } },
          { id: '100007', name: 'Size', valueId: '2', valueName: 'S' },
        ],
        salePrice: new Prisma.Decimal('19.99'),
        listPrice: new Prisma.Decimal('24.99'),
        currency: 'USD',
        inventoryTotal: 12,
        imageUrl: 'https://p16-oec.tiktokcdn.com/sku-1.jpg',
      },
      {
        id: 'v-2',
        tiktokSkuId: 'TT-SKU-2',
        sellerSku: 'HAL-M',
        variantName: 'Black / M',
        salesAttributes: [
          { id: '100000', name: 'Color', valueId: '1', valueName: 'Black' },
          { id: '100007', name: 'Size', valueId: '3', valueName: 'M' },
        ],
        salePrice: new Prisma.Decimal('19.99'),
        listPrice: null,
        currency: 'USD',
        inventoryTotal: 0,
        imageUrl: null,
      },
    ],
    images: [
      { uri: 'tos-uri-2', url: 'https://p16-oec.tiktokcdn.com/main-2.jpg', width: 800, height: 800, sortOrder: 1 },
      { uri: 'tos-uri-1', url: 'https://p16-oec.tiktokcdn.com/main-1.jpg', width: 800, height: 800, sortOrder: 0 },
      { uri: 'tos-uri-1-dup', url: 'https://p16-oec.tiktokcdn.com/main-1.jpg', width: 800, height: 800, sortOrder: 2 },
    ],
    videos: [{ url: 'https://v16.tiktokcdn.com/video.mp4', tiktokVideoId: 'TT-VIDEO-1' }],
    attributes: [
      {
        tiktokAttributeId: '100392',
        name: 'Material',
        values: [{ id: '1001', name: 'Cotton' }, { name: 'Custom blend' }],
      },
    ],
    ...overrides,
  };
}

const TARGET = { id: 'shop-target', name: 'Target Shop', region: 'US' };

function resolve(overrides: Partial<CloneSourceProduct> = {}, target = TARGET, category: CloneCategory | null = CATEGORY) {
  return resolveCloneListing({
    product: buildProduct(overrides),
    targetShop: target,
    market: PodListingMarket.US,
    category,
  });
}

describe('resolveCloneListing', () => {
  it('chép đủ nội dung nguồn: tiêu đề, mô tả, từ khoá, highlights, danh mục, thương hiệu, thuộc tính, kiện hàng', () => {
    const { payload, issues } = resolve();

    expect(issues.filter((issue) => issue.level === 'ERROR')).toEqual([]);
    expect(payload.title).toBe('Halloween Tee');
    expect(payload.description).toContain('Soft cotton');
    expect(payload.searchTerms).toEqual(['halloween', 'tee']);
    expect(payload.highlights).toEqual(['100% cotton']);
    expect(payload.category).toEqual({ tiktokCategoryId: '600001', name: 'T-Shirts', path: 'Apparel > Tops > T-Shirts' });
    expect(payload.brand).toEqual({ mode: PodBrandMode.SPECIFIC, tiktokBrandId: 'BRAND-1', name: 'Comfort Colors' });
    expect(payload.attributes).toEqual([
      {
        tiktokAttributeId: '100392',
        name: 'Material',
        type: 'PRODUCT_PROPERTY',
        isRequired: false,
        values: [{ id: '1001', name: 'Cotton' }],
        customValues: ['Custom blend'],
      },
    ]);
    expect(payload.package).toEqual({
      weight: '0.5',
      weightUnit: 'POUND',
      length: '10',
      width: '8',
      height: '1',
      dimensionUnit: 'INCH',
    });
    expect(payload.market).toBe('US');
  });

  it('KHÔNG chép định danh của shop nguồn: uri ảnh, video id, kho, template, SKU id', () => {
    const { payload } = resolve();

    expect(payload.images.every((image) => image.tiktokImageUri === null && image.fileId === '')).toBe(true);
    expect(payload.sizeChart).toEqual({ fileId: null, url: 'https://p16-oec.tiktokcdn.com/size.jpg', tiktokImageUri: null });
    expect(payload.video).toEqual({ fileId: null, url: 'https://v16.tiktokcdn.com/video.mp4', tiktokVideoId: null });
    expect(payload.warehouse).toEqual({ id: null, tiktokWarehouseId: null, name: null });
    expect(payload.source.listingTemplateId).toBe('');
    expect(payload.source.shopId).toBe('shop-target');
    expect(JSON.stringify(payload.variants)).not.toContain('TT-SKU-');
  });

  it('bộ ảnh giữ đúng thứ tự sortOrder và bỏ URL trùng', () => {
    const { payload } = resolve();

    expect(payload.images.map((image) => image.url)).toEqual([
      'https://p16-oec.tiktokcdn.com/main-1.jpg',
      'https://p16-oec.tiktokcdn.com/main-2.jpg',
    ]);
    expect(payload.images[0].isRequired).toBe(true);
    expect(payload.images.map((image) => image.sortOrder)).toEqual([0, 1]);
  });

  it('biến thể: đủ tổ hợp, giá bán / giá gạch / tồn / Seller SKU / ảnh SKU theo URL, tiền tệ theo shop đích', () => {
    const { payload } = resolve();

    expect(payload.variants).toHaveLength(2);
    expect(payload.variants[0]).toMatchObject({
      variantName: 'Black / S',
      sellerSku: 'HAL-S',
      optionValues: [
        { name: 'Color', value: 'Black' },
        { name: 'Size', value: 'S' },
      ],
      salePrice: '19.99',
      retailPrice: '24.99',
      currency: 'USD',
      quantity: 12,
      imageFileId: null,
      imageUrl: 'https://p16-oec.tiktokcdn.com/sku-1.jpg',
      sortOrder: 0,
    });
    expect(payload.variants[1]).toMatchObject({ sellerSku: 'HAL-M', retailPrice: null, quantity: 0, imageUrl: null });
  });

  it('Seller SKU trống ⇒ sinh từ tên biến thể; trùng ⇒ lỗi chặn', () => {
    const base = buildProduct();
    const { payload } = resolve({
      variants: [{ ...base.variants[0], sellerSku: null }],
    });
    expect(payload.variants[0].sellerSku).toBe('BLACK-S');

    const duplicated = resolve({
      variants: [base.variants[0], { ...base.variants[1], sellerSku: 'HAL-S' }],
    });
    expect(duplicated.issues.some((issue) => issue.code === POD_DRAFT_ISSUE_CODES.MISSING_VARIANT)).toBe(true);
  });

  it('danh mục không có trong cây master (hoặc không phải lá) ⇒ lỗi chặn rõ ràng, không chép id mù', () => {
    const { payload, issues } = resolve({}, TARGET, null);

    expect(payload.category.tiktokCategoryId).toBeNull();
    const issue = issues.find((entry) => entry.code === POD_DRAFT_ISSUE_CODES.MISSING_CATEGORY);
    expect(issue?.level).toBe('ERROR');
    expect(issue?.message).toContain('600001');
  });

  it('không có brand hoặc brand "No brand" ⇒ mode NONE (publisher bỏ hẳn brand_id)', () => {
    expect(resolve({ tiktokBrandId: null, brandName: null }).payload.brand.mode).toBe(PodBrandMode.NONE);
    expect(resolve({ tiktokBrandId: 'X', brandName: 'No Brand' }).payload.brand.mode).toBe(PodBrandMode.NONE);
    expect(resolve({ tiktokBrandId: '7082427311584347905', brandName: 'Fake' }).payload.brand.mode).toBe(
      PodBrandMode.NONE,
    );
  });

  it('bảng size là template riêng của shop nguồn ⇒ lỗi chặn (không báo thành công giả)', () => {
    const { payload, issues } = resolve({ sizeChartUrl: null, sizeChartUri: null, sizeChartTemplateId: 'TPL-1' });

    expect(payload.sizeChart).toBeNull();
    expect(issues.some((issue) => issue.level === 'ERROR' && issue.field === 'sizeChart')).toBe(true);
  });

  it('shop đích khác tiền tệ ⇒ giá chép nguyên số, mã tiền tệ theo shop đích, kèm cảnh báo', () => {
    const { payload, issues } = resolve({}, { id: 'shop-uk', name: 'UK Shop', region: 'GB' });

    expect(payload.variants.every((variant) => variant.currency === 'GBP')).toBe(true);
    expect(payload.variants[0].salePrice).toBe('19.99');
    expect(issues.some((issue) => issue.code === POD_DRAFT_ISSUE_CODES.CURRENCY_MISMATCH && issue.level === 'WARNING')).toBe(true);
  });

  it('thiếu ảnh / thiếu mô tả / thiếu kiện hàng ⇒ lỗi chặn', () => {
    const { issues } = resolve({ images: [], description: '   ', packageWeight: null });
    const codes = issues.filter((issue) => issue.level === 'ERROR').map((issue) => issue.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        POD_DRAFT_ISSUE_CODES.MISSING_IMAGE,
        POD_DRAFT_ISSUE_CODES.MISSING_DESCRIPTION,
        POD_DRAFT_ISSUE_CODES.MISSING_PACKAGE,
      ]),
    );
  });

  it('hash phụ thuộc nội dung — cùng nguồn cùng đích cho cùng hash, khác đích cho khác hash', () => {
    const a = resolve();
    const b = resolve();
    const c = resolve({}, { id: 'shop-other', name: 'Other', region: 'US' });

    expect(a.payloadHash).toBe(b.payloadHash);
    expect(a.payloadHash).not.toBe(c.payloadHash);
  });
});

describe('marketOfRegion', () => {
  it('ánh xạ GB → UK, giữ nguyên mã đã có trong enum, vùng lạ ⇒ null', () => {
    expect(marketOfRegion('GB')).toBe('UK');
    expect(marketOfRegion('us')).toBe('US');
    expect(marketOfRegion('XX')).toBeNull();
    expect(marketOfRegion(null)).toBeNull();
  });
});
