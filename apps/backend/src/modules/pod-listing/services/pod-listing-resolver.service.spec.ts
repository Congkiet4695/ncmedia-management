import {
  PodImageAssetType,
  PodListingMarket,
  PodPriceAdjustmentType,
  PodPricingMarkupType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { PodListingResolverService, type ResolveContext } from './pod-listing-resolver.service';
import type { ListingTemplateFull } from './pod-listing-template.service';

const D = (value: string | number) => new Prisma.Decimal(value);
const ORG = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-08-18T00:00:00.000Z');

type SkuTemplateFull = NonNullable<ListingTemplateFull['skuTemplate']>;
type SkuItemFull = SkuTemplateFull['items'][number];

/** Một SKU đã sinh, kèm bảng nối tới giá trị trục. */
function buildSkuItem(over: Partial<SkuItemFull> = {}): SkuItemFull {
  return {
    id: 'item-1',
    organizationId: ORG,
    skuTemplateId: 'sku-1',
    variantName: 'Black / S',
    skuCode: 'BLK-S',
    barcode: null,
    priceAdjustmentType: PodPriceAdjustmentType.NONE,
    priceAdjustmentValue: D('0'),
    retailPrice: null,
    salePrice: null,
    quantity: 10,
    discount: null,
    imageFileId: null,
    tiktokImageUri: null,
    imageUploadedAt: null,
    isActive: true,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    image: null,
    values: [
      {
        id: 'link-1',
        organizationId: ORG,
        itemId: 'item-1',
        variantValueId: 'val-1',
        createdAt: NOW,
        variantValue: {
          id: 'val-1',
          value: 'Black',
          code: 'BLACK',
          variant: { id: 'var-1', name: 'Color', sortOrder: 0 },
        },
      },
    ],
    ...over,
  };
}

type ImageTemplateFull = NonNullable<ListingTemplateFull['imageTemplate']>;
type ImageItemFull = ImageTemplateFull['items'][number];

/** Một tấm ảnh trong bộ ảnh mẫu. */
function buildImageItem(over: Partial<ImageItemFull> = {}): ImageItemFull {
  return {
    id: 'img-item-1',
    organizationId: ORG,
    imageTemplateId: 'img-1',
    title: 'Front Mockup',
    assetType: PodImageAssetType.MAIN_FRONT,
    fileId: 'file-front',
    imageUrl: 'https://cdn/front.jpg',
    imageKey: 'pod/img/front.jpg',
    contentType: 'image/jpeg',
    fileSize: 120_000,
    width: 1200,
    height: 1200,
    isRequired: false,
    displayOrder: 0,
    tiktokImageUri: null,
    uploadedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** Listing Template đầy đủ — chỉ các trường resolver thực sự đọc. */
function buildTemplate(over: Partial<ListingTemplateFull> = {}): ListingTemplateFull {
  return {
    id: 'tpl-1',
    organizationId: ORG,
    name: 'MEN TSHIRT — US',
    market: PodListingMarket.US,
    categoryTemplateId: 'cat-1',
    skuTemplateId: 'sku-1',
    descriptionTemplateId: 'desc-1',
    imageTemplateId: 'img-1',
    pricingStrategyId: 'price-1',
    warehouseId: 'wh-1',
    tiktokBrandId: null,
    brandName: null,
    shippingTemplateId: 'ship-1',
    handlingDays: 2,
    packageWeight: null,
    weightUnit: null,
    packageLength: null,
    packageWidth: null,
    packageHeight: null,
    dimensionUnit: null,
    isDefault: false,
    isActive: true,
    displayOrder: 0,
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    categoryTemplate: {
      id: 'cat-1',
      organizationId: ORG,
      name: 'US Men T-Shirt',
      market: PodListingMarket.US,
      tiktokCategoryId: '601352',
      categoryName: 'T-Shirts',
      categoryPath: 'Womenswear > T-Shirts',
      tiktokBrandId: 'brand-1',
      brandName: 'Comfort Colors',
      warehouseId: null,
      packageWeight: '0.3',
      weightUnit: 'KILOGRAM',
      packageLength: '30',
      packageWidth: '20',
      packageHeight: '4',
      dimensionUnit: 'CENTIMETER',
      sizeChartFileId: null,
      videoFileId: null,
      isDefault: false,
      isActive: true,
      displayOrder: 0,
      note: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      warehouse: null,
      attributes: [
        {
          id: 'attr-row-1',
          organizationId: ORG,
          categoryTemplateId: 'cat-1',
          tiktokAttributeId: '100392',
          attributeName: 'Material',
          attributeType: 'PRODUCT_PROPERTY',
          isRequired: true,
          isMultipleSelection: false,
          isCustomizable: false,
          sortOrder: 0,
          createdAt: NOW,
          updatedAt: NOW,
          values: [
            {
              id: 'attr-val-1',
              organizationId: ORG,
              templateAttributeId: 'attr-row-1',
              tiktokValueId: 'v1',
              valueName: 'Cotton',
              sortOrder: 0,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          customValues: [
            {
              id: 'attr-custom-1',
              organizationId: ORG,
              templateAttributeId: 'attr-row-1',
              value: 'Bamboo blend',
              displayOrder: 0,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        },
      ],
    },
    skuTemplate: {
      id: 'sku-1',
      organizationId: ORG,
      name: 'Color x Size',
      skuPrefix: 'NC',
      skuSuffix: null,
      defaultRetailPrice: D('25'),
      defaultSalePrice: D('20'),
      defaultQuantity: 10,
      defaultDiscount: null,
      currency: 'USD',
      isDefault: false,
      isActive: true,
      displayOrder: 0,
      note: null,
      axesUpdatedAt: NOW,
      itemsGeneratedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      variants: [
        {
          id: 'var-1',
          organizationId: ORG,
          skuTemplateId: 'sku-1',
          name: 'Color',
          sortOrder: 0,
          createdAt: NOW,
          updatedAt: NOW,
          values: [
            {
              id: 'val-1',
              organizationId: ORG,
              variantId: 'var-1',
              value: 'Black',
              code: 'BLACK',
              sortOrder: 0,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
        },
      ],
      items: [buildSkuItem()],
    },
    descriptionTemplate: {
      id: 'desc-1',
      organizationId: ORG,
      name: 'Tee mô tả',
      contentHtml:
        '<p>{{PRODUCT.TITLE}} — bán tại {{SHOP.NAME}}</p><p>{{MATERIAL}}</p><p>{{UNKNOWN_TOKEN}}</p>',
      isDefault: false,
      isActive: true,
      displayOrder: 0,
      note: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      tokens: [
        {
          id: 'tok-1',
          organizationId: ORG,
          descriptionTemplateId: 'desc-1',
          code: 'MATERIAL',
          label: 'Chất liệu',
          value: '100% ring-spun cotton',
          sortOrder: 0,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    },
    imageTemplate: {
      id: 'img-1',
      organizationId: ORG,
      name: 'Comfort Colors',
      description: 'Bộ ảnh mẫu của phôi Comfort Colors',
      isDefault: false,
      isActive: true,
      displayOrder: 0,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
      // Bộ ảnh mockup CỐ ĐỊNH của phôi — dùng nguyên cho mọi listing.
      items: [
        buildImageItem({
          id: 'img-item-1',
          title: 'Front Mockup',
          assetType: PodImageAssetType.MAIN_FRONT,
          fileId: 'file-front',
          imageUrl: 'https://cdn/front.jpg',
          imageKey: 'pod/img/front.jpg',
          isRequired: true,
          displayOrder: 0,
        }),
        buildImageItem({
          id: 'img-item-2',
          title: 'Size Chart',
          assetType: PodImageAssetType.SIZE_CHART,
          fileId: 'file-size',
          imageUrl: 'https://cdn/size.jpg',
          imageKey: 'pod/img/size.jpg',
          displayOrder: 1,
        }),
      ],
    },
    pricingStrategy: {
      id: 'price-1',
      organizationId: ORG,
      name: 'Tee US',
      cost: D('5'),
      shippingCost: D('2'),
      markupType: PodPricingMarkupType.PERCENT,
      markupValue: D('100'),
      formula: null,
      retailPriceMultiplier: D('1.5'),
      discountPercent: D('0'),
      roundingIncrement: D('0'),
      currency: 'USD',
      isDefault: false,
      isActive: true,
      displayOrder: 0,
      note: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      createdBy: null,
      updatedBy: null,
    },
    warehouse: {
      id: 'wh-1',
      organizationId: ORG,
      shopId: 'shop-1',
      tiktokWarehouseId: 'TT-WH-1',
      name: 'US Warehouse',
      type: 'SALES_WAREHOUSE',
      subType: null,
      effectStatus: 'ENABLED',
      isDefault: true,
      regionCode: 'US',
      address: null,
      syncedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
    items: [],
    scopes: [],
    ...over,
  };
}

function buildContext(over: Partial<ResolveContext> = {}): ResolveContext {
  return {
    template: buildTemplate(),
    product: {
      id: 'prod-1',
      tiktokProductId: '7300000000000000001',
      title: 'Unisex Heavy Cotton Tee',
      description: '<p>gốc</p>',
      categoryName: 'T-Shirts',
      brandName: 'NCMedia',
      variants: [{ sellerSku: 'TEE-BLK-L', imageUrl: 'https://tiktok/variant-black.jpg' }],
      images: [
        { uri: 'tos://product-0', url: 'https://tiktok/product-0.jpg' },
        { uri: 'tos://product-1', url: 'https://tiktok/product-1.jpg' },
      ],
      videos: [{ url: 'https://tiktok/video-0.mp4' }],
    },
    shop: { id: 'shop-1', name: 'NCMedia US Store', region: 'US' },
    ...over,
  };
}

describe('PodListingResolverService', () => {
  const service = new PodListingResolverService({} as unknown as PrismaService);

  describe('payload', () => {
    it('ghép đủ các mảnh: danh mục, brand, thuộc tính, ảnh, kiện hàng, kho, shipping', () => {
      const { payload } = service.resolveFromContext(buildContext());

      expect(payload.category.tiktokCategoryId).toBe('601352');
      expect(payload.brand.name).toBe('Comfort Colors');
      expect(payload.attributes[0].name).toBe('Material');
      expect(payload.attributes[0].values).toEqual([{ id: 'v1', name: 'Cotton' }]);
      expect(payload.images).toHaveLength(2);
      expect(payload.package.weight).toBe('0.3');
      expect(payload.warehouse.tiktokWarehouseId).toBe('TT-WH-1');
      expect(payload.shipping).toEqual({ shippingTemplateId: 'ship-1', handlingDays: 2 });
    });

    it('thay token hệ thống và token tự đặt; token lạ giữ nguyên', () => {
      const { payload } = service.resolveFromContext(buildContext());

      expect(payload.description).toContain('Unisex Heavy Cotton Tee');
      expect(payload.description).toContain('NCMedia US Store');
      // Token do người dùng khai báo trong chính Description Template.
      expect(payload.description).toContain('100% ring-spun cotton');
      // Token không có nguồn giá trị KHÔNG bị thay bằng chuỗi rỗng — người dùng thấy lỗi gõ.
      expect(payload.description).toContain('{{UNKNOWN_TOKEN}}');
    });

    it('brand ở Listing Template ghi đè brand của Category Template', () => {
      const template = buildTemplate({ tiktokBrandId: 'brand-9', brandName: 'Gildan' });
      const { payload } = service.resolveFromContext(buildContext({ template }));

      expect(payload.brand).toEqual({ tiktokBrandId: 'brand-9', name: 'Gildan' });
    });

    it('cùng đầu vào ⇒ cùng hash (sinh lại không tạo thay đổi giả)', () => {
      const first = service.resolveFromContext(buildContext());
      const second = service.resolveFromContext(buildContext());
      expect(first.payloadHash).toBe(second.payloadHash);
    });
  });

  describe('🔴 template là QUY TẮC — cùng template, khác sản phẩm, khác kết quả', () => {
    it('🔴 bộ ảnh mockup dùng CHUNG cho mọi sản phẩm, không lấy ảnh sản phẩm', () => {
      const first = service.resolveFromContext(buildContext({ template: buildTemplate() }));

      const second = service.resolveFromContext(
        buildContext({
          template: buildTemplate(),
          product: {
            id: 'prod-2',
            tiktokProductId: '7300000000000000002',
            title: 'Vintage Hoodie',
            description: null,
            categoryName: 'Hoodies',
            brandName: 'NCMedia',
            variants: [{ sellerSku: 'HOODIE-BLK-L', imageUrl: null }],
            images: [{ uri: 'tos://hoodie-0', url: 'https://tiktok/hoodie-0.jpg' }],
            videos: [],
          },
        }),
      );

      // Hai sản phẩm khác nhau ⇒ VẪN đúng bộ mockup của phôi, không đổi theo sản phẩm.
      expect(first.payload.images.map((image) => image.url)).toEqual([
        'https://cdn/front.jpg',
        'https://cdn/size.jpg',
      ]);
      expect(second.payload.images.map((image) => image.url)).toEqual([
        'https://cdn/front.jpg',
        'https://cdn/size.jpg',
      ]);
      // Ảnh của sản phẩm KHÔNG lọt vào bộ ảnh listing.
      expect(JSON.stringify(second.payload.images)).not.toContain('hoodie-0');
    });

    it('bộ ảnh giữ đúng thứ tự đã kéo thả và mang theo tiêu đề của từng tấm', () => {
      const { payload } = service.resolveFromContext(buildContext());

      expect(payload.images.map((image) => image.title)).toEqual(['Front Mockup', 'Size Chart']);
      expect(payload.images.map((image) => image.sortOrder)).toEqual([0, 1]);
      expect(payload.images[0].assetType).toBe(PodImageAssetType.MAIN_FRONT);
    });

    it('mang theo key + kích thước ảnh để publish không phải join lại', () => {
      const { payload } = service.resolveFromContext(buildContext());

      expect(payload.images[0].imageKey).toBe('pod/img/front.jpg');
      expect(payload.images[0].width).toBe(1200);
      expect(payload.images[0].height).toBe(1200);
    });

    it('giữ `uri` phía TikTok để hàng nghìn listing sau khỏi upload lại cùng một mockup', () => {
      const template = buildTemplate();
      template.imageTemplate!.items[0].tiktokImageUri = 'tos://mockup-front';

      const { payload } = service.resolveFromContext(buildContext({ template }));

      expect(payload.images[0].tiktokImageUri).toBe('tos://mockup-front');
    });

    it('tiêu đề và mô tả bám theo sản phẩm đang áp, không phải theo template', () => {
      const first = service.resolveFromContext(buildContext());
      const second = service.resolveFromContext(
        buildContext({
          product: {
            id: 'prod-2',
            tiktokProductId: '7300000000000000002',
            title: 'Vintage Hoodie',
            description: null,
            categoryName: 'Hoodies',
            brandName: 'NCMedia',
            variants: [{ sellerSku: 'HOODIE-BLK-L', imageUrl: null }],
            images: [],
            videos: [],
          },
        }),
      );

      expect(first.payload.title).toBe('Unisex Heavy Cotton Tee');
      expect(second.payload.title).toBe('Vintage Hoodie');
      expect(second.payload.description).toContain('Vintage Hoodie');
      // Mã SKU cũng khác nhau vì ghép từ mã sản phẩm.
      expect(first.payload.variants[0].sellerSku).not.toBe(second.payload.variants[0].sellerSku);
    });

    it('kiện hàng ở Listing Template ghi đè kiện hàng của Category Template', () => {
      const template = buildTemplate({ packageWeight: '0.75', weightUnit: 'POUND' });
      const { payload } = service.resolveFromContext(buildContext({ template }));

      expect(payload.package.weight).toBe('0.75');
      expect(payload.package.weightUnit).toBe('POUND');
      // Kích thước không ghi đè thì vẫn lấy của Category Template.
      expect(payload.package.length).toBe('30');
    });
  });

  describe('giá & SKU', () => {
    it('áp Pricing Strategy khi SKU không có giá riêng', () => {
      const { payload } = service.resolveFromContext(buildContext());

      // (5 + 2) × 2 = 14 giá bán · giá gốc = 14 × 1.5 = 21
      expect(payload.pricing?.salePrice).toBe('14');
      expect(payload.variants[0].salePrice).toBe('14');
      expect(payload.variants[0].retailPrice).toBe('21');
    });

    it('🔴 giá nhập tay ở từng SKU THẮNG công thức Pricing Strategy', () => {
      const template = buildTemplate();
      template.skuTemplate!.items[0].salePrice = D('33.5');

      const { payload } = service.resolveFromContext(buildContext({ template }));

      expect(payload.variants[0].salePrice).toBe('33.5');
    });

    it('🔴 điều chỉnh theo SỐ TIỀN cộng lên giá của Pricing Template', () => {
      const template = buildTemplate();
      template.skuTemplate!.items[0].priceAdjustmentType = PodPriceAdjustmentType.AMOUNT;
      template.skuTemplate!.items[0].priceAdjustmentValue = D('2');

      const { payload } = service.resolveFromContext(buildContext({ template }));

      // Pricing Template ra 14 ⇒ biến thể này 16. Quy tắc "+2" đúng với MỌI sản phẩm,
      // khác hẳn việc ghi cứng "16" chỉ đúng với một sản phẩm.
      expect(payload.variants[0].salePrice).toBe('16');
    });

    it('🔴 điều chỉnh theo PHẦN TRĂM cộng lên giá của Pricing Template', () => {
      const template = buildTemplate();
      template.skuTemplate!.items[0].priceAdjustmentType = PodPriceAdjustmentType.PERCENT;
      template.skuTemplate!.items[0].priceAdjustmentValue = D('10');

      const { payload } = service.resolveFromContext(buildContext({ template }));

      expect(payload.variants[0].salePrice).toBe('15.4');
      // Giá gốc gạch ngang cũng được điều chỉnh cùng tỉ lệ: 21 × 1.1 = 23.1
      expect(payload.variants[0].retailPrice).toBe('23.1');
    });

    it('điều chỉnh âm quá tay bị kẹp về 0 thay vì sinh giá âm', () => {
      const template = buildTemplate();
      template.skuTemplate!.items[0].priceAdjustmentType = PodPriceAdjustmentType.AMOUNT;
      template.skuTemplate!.items[0].priceAdjustmentValue = D('-99');

      const { payload } = service.resolveFromContext(buildContext({ template }));

      expect(payload.variants[0].salePrice).toBe('0');
    });

    it('giá trị trục đọc từ bảng nối, không phải JSON', () => {
      const { payload } = service.resolveFromContext(buildContext());
      expect(payload.variants[0].optionValues).toEqual([{ name: 'Color', value: 'Black' }]);
    });

    it('mã SKU ghép từ prefix + mã sản phẩm + mã tổ hợp', () => {
      const { payload } = service.resolveFromContext(buildContext());
      expect(payload.variants[0].sellerSku).toBe('NC-7300000000000000001-BLK-S');
    });

    it('SKU tắt (isActive = false) không vào listing', () => {
      const template = buildTemplate();
      template.skuTemplate!.items[0].isActive = false;

      const { payload, issues } = service.resolveFromContext(buildContext({ template }));

      expect(payload.variants).toHaveLength(0);
      expect(issues.some((issue) => issue.code === 'DRAFT_MISSING_VARIANT')).toBe(true);
    });

    it('barcode của từng SKU đi vào payload cho Sprint 4', () => {
      const template = buildTemplate();
      template.skuTemplate!.items[0].barcode = '0123456789012';

      const { payload } = service.resolveFromContext(buildContext({ template }));

      expect(payload.variants[0].barcode).toBe('0123456789012');
    });
  });

  describe('validate — điều kiện để Sprint sau publish được', () => {
    it('template đầy đủ ⇒ không có lỗi ERROR', () => {
      const { issues } = service.resolveFromContext(buildContext());
      expect(issues.filter((issue) => issue.level === 'ERROR')).toHaveLength(0);
    });

    it('thiếu danh mục ⇒ ERROR', () => {
      const template = buildTemplate({ categoryTemplate: null });
      const { issues } = service.resolveFromContext(buildContext({ template }));

      expect(issues.some((issue) => issue.code === 'DRAFT_MISSING_CATEGORY')).toBe(true);
    });

    it('thuộc tính BẮT BUỘC chưa có giá trị nào ⇒ ERROR', () => {
      const template = buildTemplate();
      template.categoryTemplate!.attributes[0].values = [];
      template.categoryTemplate!.attributes[0].customValues = [];

      const { issues } = service.resolveFromContext(buildContext({ template }));

      expect(issues.some((issue) => issue.code === 'DRAFT_MISSING_REQUIRED_ATTRIBUTE')).toBe(true);
    });

    it('CHỈ có giá trị tự nhập vẫn tính là đã điền thuộc tính bắt buộc', () => {
      const template = buildTemplate();
      template.categoryTemplate!.attributes[0].values = [];

      const { issues, payload } = service.resolveFromContext(buildContext({ template }));

      expect(issues.some((issue) => issue.code === 'DRAFT_MISSING_REQUIRED_ATTRIBUTE')).toBe(false);
      expect(payload.attributes[0].customValues).toEqual(['Bamboo blend']);
    });

    it('giá trị chính thức và giá trị tự nhập cùng đi vào payload, không cái nào bị nuốt', () => {
      const { payload } = service.resolveFromContext(buildContext());

      expect(payload.attributes[0].values.map((value) => value.name)).toEqual(['Cotton']);
      expect(payload.attributes[0].customValues).toEqual(['Bamboo blend']);
    });

    it('bộ ảnh rỗng ⇒ ERROR', () => {
      const template = buildTemplate();
      template.imageTemplate!.items = [];

      const { issues } = service.resolveFromContext(buildContext({ template }));

      expect(issues.some((issue) => issue.code === 'DRAFT_MISSING_IMAGE')).toBe(true);
    });

    it('chưa ghép Image Template ⇒ ERROR', () => {
      const template = buildTemplate({ imageTemplate: null });

      const { payload, issues } = service.resolveFromContext(buildContext({ template }));

      expect(payload.images).toHaveLength(0);
      expect(issues.some((issue) => issue.code === 'DRAFT_MISSING_IMAGE')).toBe(true);
    });

    it('🔴 chưa chọn kho ⇒ KHÔNG có vấn đề nào — kho do Publisher quyết theo từng shop', () => {
      const template = buildTemplate({ warehouseId: null, warehouse: null });
      const { payload, issues } = service.resolveFromContext(buildContext({ template }));

      expect(payload.warehouse.tiktokWarehouseId).toBeNull();
      expect(issues.some((issue) => issue.code === 'DRAFT_MISSING_WAREHOUSE')).toBe(false);
    });

    it('mã SKU trùng nhau ⇒ ERROR (TikTok sẽ từ chối cả sản phẩm)', () => {
      const template = buildTemplate();
      template.skuTemplate!.items = [
        buildSkuItem(),
        buildSkuItem({ id: 'item-2', variantName: 'Black / M', skuCode: 'BLK-S' }),
      ];

      const { issues } = service.resolveFromContext(buildContext({ template }));

      expect(issues.some((issue) => issue.message.includes('trùng'))).toBe(true);
    });
  });
});
