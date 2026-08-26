import { PodImageAssetType } from '@prisma/client';
import { POD_LISTING_BLOCKER_CODES } from '../constants/pod-listing.constants';
import type { ResolvedListing } from './pod-listing-resolver.service';
import { PodListingValidatorService } from './pod-listing-validator.service';

/** Một listing ĐỦ dữ liệu — mỗi test chỉ lấy đi đúng một thứ để xem cổng nào bật. */
function buildPayload(over: Partial<ResolvedListing> = {}): ResolvedListing {
  return {
    market: 'US',
    title: 'Comfort Colors Graphic Tee',
    description: '<p>Soft cotton tee</p>',
    category: { tiktokCategoryId: '601226', name: 'T-Shirts', path: 'Womenswear > T-Shirts' },
    brand: { tiktokBrandId: '7082427311584347905', name: 'No Brand' },
    attributes: [],
    images: [
      {
        title: 'Front Mockup',
        assetType: PodImageAssetType.MAIN_FRONT,
        fileId: 'file-1',
        url: 'https://cdn.example/front.png',
        imageKey: 'image-templates/front.png',
        width: 1200,
        height: 1200,
        isRequired: true,
        tiktokImageUri: null,
        sortOrder: 0,
      },
    ],
    package: {
      weight: '0.35',
      weightUnit: 'POUND',
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
    },
    warehouse: { id: 'wh-1', tiktokWarehouseId: '7068201260272959754', name: 'US Warehouse' },
    shipping: { shippingTemplateId: null, handlingDays: null },
    pricing: {
      strategyId: 'p-1',
      strategyName: 'US Tee',
      currency: 'USD',
      salePrice: '21.99',
      retailPrice: '32.99',
      finalPrice: '21.99',
    },
    variants: [
      {
        variantName: 'Black / S',
        sellerSku: 'US-TEE-BLK-S',
        barcode: null,
        optionValues: [
          { name: 'Color', value: 'Black' },
          { name: 'Size', value: 'S' },
        ],
        salePrice: '21.99',
        retailPrice: '32.99',
        currency: 'USD',
        quantity: 100,
        imageFileId: null,
        sortOrder: 0,
      },
    ],
    source: {
      productId: 'prod-1',
      sessionProductId: null,
      tiktokProductId: '1729592969712207000',
      shopId: 'shop-1',
      listingTemplateId: 'tmpl-1',
      imageTemplateId: 'img-1',
    },
    ...over,
  };
}

describe('PodListingValidatorService', () => {
  const validator = new PodListingValidatorService();
  const codesOf = (payload: ResolvedListing): string[] =>
    validator.validate(payload).blockers.map((blocker) => blocker.code);

  it('listing đủ dữ liệu thì được phép gửi', () => {
    const result = validator.validate(buildPayload());
    expect(result.ok).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it('thiếu Category ⇒ chặn', () => {
    expect(
      codesOf(buildPayload({ category: { tiktokCategoryId: null, name: null, path: null } })),
    ).toContain(POD_LISTING_BLOCKER_CODES.MISSING_CATEGORY);
  });

  it('thiếu Brand ⇒ chặn', () => {
    expect(codesOf(buildPayload({ brand: { tiktokBrandId: null, name: null } }))).toContain(
      POD_LISTING_BLOCKER_CODES.MISSING_BRAND,
    );
  });

  it('🔴 KHÔNG chặn khi chưa có kho — kho là dữ liệu của SHOP, quyết lúc Publish', () => {
    // Cùng một Draft Product đăng lên ba shop là ba kho khác nhau, nên bắt Draft phải có kho
    // là chặn nhầm. Publisher chọn kho theo từng shop ngay trước khi gọi Create Product.
    const payload = buildPayload({ warehouse: { id: null, tiktokWarehouseId: null, name: null } });

    expect(codesOf(payload)).not.toContain(POD_LISTING_BLOCKER_CODES.MISSING_WAREHOUSE);
    expect(validator.validate(payload).ok).toBe(true);
  });

  it('thiếu giá trị của thuộc tính BẮT BUỘC ⇒ chặn, thuộc tính không bắt buộc thì không', () => {
    const required = buildPayload({
      attributes: [
        {
          tiktokAttributeId: '100392',
          name: 'Material',
          type: 'PRODUCT_PROPERTY',
          isRequired: true,
          values: [],
          customValues: [],
        },
      ],
    });
    expect(codesOf(required)).toContain(POD_LISTING_BLOCKER_CODES.MISSING_ATTRIBUTE);

    const optional = buildPayload({
      attributes: [
        {
          tiktokAttributeId: '100392',
          name: 'Material',
          type: 'PRODUCT_PROPERTY',
          isRequired: false,
          values: [],
          customValues: [],
        },
      ],
    });
    expect(validator.validate(optional).ok).toBe(true);
  });

  it('thiếu Images ⇒ chặn', () => {
    expect(codesOf(buildPayload({ images: [] }))).toContain(
      POD_LISTING_BLOCKER_CODES.MISSING_IMAGE,
    );
  });

  it('thiếu SKU ⇒ chặn', () => {
    expect(codesOf(buildPayload({ variants: [] }))).toContain(
      POD_LISTING_BLOCKER_CODES.MISSING_SKU,
    );
  });

  it('thiếu Price ⇒ chặn', () => {
    const payload = buildPayload();
    payload.variants[0].salePrice = null;
    expect(codesOf(payload)).toContain(POD_LISTING_BLOCKER_CODES.MISSING_PRICE);
  });

  it('giá 0 cũng bị chặn — TikTok nhận nhưng sản phẩm bán không được', () => {
    const payload = buildPayload();
    payload.variants[0].salePrice = '0';
    expect(codesOf(payload)).toContain(POD_LISTING_BLOCKER_CODES.MISSING_PRICE);
  });

  it('thiếu Stock ⇒ chặn', () => {
    const payload = buildPayload();
    payload.variants[0].quantity = 0;
    expect(codesOf(payload)).toContain(POD_LISTING_BLOCKER_CODES.MISSING_STOCK);
  });

  it('thiếu khối lượng kiện hàng ⇒ chặn', () => {
    const payload = buildPayload();
    payload.package.weight = null;
    expect(codesOf(payload)).toContain(POD_LISTING_BLOCKER_CODES.MISSING_PACKAGE);
  });

  it('bộ ảnh quá 9 tấm chỉ là CẢNH BÁO, vẫn được gửi', () => {
    const payload = buildPayload();
    const [first] = payload.images;
    payload.images = Array.from({ length: 12 }, (_, index) => ({
      ...first,
      fileId: `file-${index}`,
      sortOrder: index,
    }));

    const result = validator.validate(payload);
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it('gom TẤT CẢ lý do chặn trong một lần, không dừng ở lỗi đầu tiên', () => {
    const payload = buildPayload({
      category: { tiktokCategoryId: null, name: null, path: null },
      brand: { tiktokBrandId: null, name: null },
      images: [],
      variants: [],
    });

    // Người vận hành sửa một lượt là xong, không phải sửa-chạy-sửa-chạy bốn vòng.
    expect(codesOf(payload)).toEqual(
      expect.arrayContaining([
        POD_LISTING_BLOCKER_CODES.MISSING_CATEGORY,
        POD_LISTING_BLOCKER_CODES.MISSING_BRAND,
        POD_LISTING_BLOCKER_CODES.MISSING_IMAGE,
        POD_LISTING_BLOCKER_CODES.MISSING_SKU,
      ]),
    );
  });
});
