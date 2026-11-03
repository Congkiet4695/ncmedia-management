import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { countVariantsSharingSellerSku } from '../../pod-tiktok/shared/order-item-product-key';
import { MangoOrderMapper } from '../mango/mappers/mango-order.mapper';
import { findMappingForItem, mappingKeyOf } from '../shared/mapping-match';
import { FulfillmentReadinessService, READINESS_CODES, issueSectionOf } from './fulfillment-readiness.service';

/**
 * **Seller SKU dùng chung cho nhiều biến thể** (dữ liệu thật 2026-11-03: ~19.7k sản phẩm có Seller SKU gắn cho nhiều
 * SKU ID; 22/164 ánh xạ đang nhận đơn của nhiều SKU ID). Khoá ánh xạ `(Product ID + Seller SKU)` giữ nguyên (PO
 * 2026-11-03) ⇒ các biến thể đó dùng chung MỘT Fulfillment SKU. Readiness phải CẢNH BÁO (không chặn), và ánh xạ /
 * Seller SKU của sản phẩm khác không bao giờ bị kéo sang.
 */

const RECIPIENT = {
  first_name: 'John',
  last_name: 'Doe',
  phone_number: '5551234567',
  address_line1: '123 Main St',
  postal_code: '33602',
  region_code: 'US',
  district_info: [
    { address_level: 'L1', address_name: 'Florida' },
    { address_level: 'L2', address_name: 'Tampa' },
  ],
};

function order(items: Array<Record<string, unknown>>) {
  return {
    id: 'order-1',
    status: 'AWAITING_SHIPMENT',
    recipientEnc: 'enc',
    recipientMasked: false,
    recipientRegionCode: 'US',
    recipientPostalCode: '33602',
    shippingLabelUrl: null,
    shippingLabelSource: null,
    shippingLabelPackageId: null,
    shippingLabelTrackingNumber: null,
    shippingLabelAt: null,
    packages: [],
    items,
  };
}

function mapping(over: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    isActive: true,
    accountId: 'acc-1',
    tiktokProductId: 'PROD-1',
    sellerSku: 'TEE',
    tiktokSkuId: null,
    providerSku: 'MANGO-TEE-BLACK-S',
    baseCost: null,
    productionConfig: null,
    productionLine: null,
    placementMap: null,
    ...over,
  };
}

const designsFor = (...keys: Array<[string, string]>) =>
  new Map(
    keys.map(([product, sku]) => [
      mappingKeyOf(product, sku) as string,
      [{ placement: 'FRONT', storageFile: { publicUrl: 'https://cdn.example.com/a.png' } }],
    ]),
  ) as never;

describe('countVariantsSharingSellerSku (hàm thuần)', () => {
  const catalog = [
    { shopId: 'shop-1', tiktokProductId: 'PROD-1', tiktokSkuId: 'SKU-S', sellerSku: 'TEE' },
    { shopId: 'shop-1', tiktokProductId: 'PROD-1', tiktokSkuId: 'SKU-M', sellerSku: ' TEE ' },
    { shopId: 'shop-1', tiktokProductId: 'PROD-1', tiktokSkuId: 'SKU-M', sellerSku: 'TEE' },
    { shopId: 'shop-1', tiktokProductId: 'PROD-1', tiktokSkuId: 'SKU-MUG', sellerSku: 'MUG' },
    // Cùng Seller SKU nhưng SẢN PHẨM khác / SHOP khác ⇒ không đếm vào.
    { shopId: 'shop-1', tiktokProductId: 'PROD-2', tiktokSkuId: 'SKU-X', sellerSku: 'TEE' },
    { shopId: 'shop-2', tiktokProductId: 'PROD-1', tiktokSkuId: 'SKU-Y', sellerSku: 'TEE' },
  ];

  it('đếm SKU ID KHÁC NHAU cùng (shop, Product ID, Seller SKU) — không lẫn sản phẩm / shop khác', () => {
    const counts = countVariantsSharingSellerSku(
      'shop-1',
      [
        { id: 'a', productId: 'PROD-1', sellerSku: 'TEE' },
        { id: 'b', productId: 'PROD-1', sellerSku: 'MUG' },
        { id: 'c', productId: 'PROD-2', sellerSku: 'TEE' },
      ],
      catalog,
    );
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBe(1);
  });

  it('dòng không có Seller SKU / Product ID, hoặc chưa có trong danh mục ⇒ không có mục (không đoán)', () => {
    const counts = countVariantsSharingSellerSku(
      'shop-1',
      [
        { id: 'a', productId: 'PROD-1', sellerSku: null },
        { id: 'b', productId: null, sellerSku: 'TEE' },
        { id: 'c', productId: 'PROD-9', sellerSku: 'TEE' },
      ],
      catalog,
    );
    expect(counts.size).toBe(0);
  });
});

describe('FulfillmentReadinessService — MAPPING_SHARED_BY_VARIANTS', () => {
  let service: FulfillmentReadinessService;

  beforeEach(() => {
    const encryption = { decrypt: jest.fn(() => JSON.stringify(RECIPIENT)) } as unknown as TiktokEncryptionService;
    service = new FulfillmentReadinessService(encryption, new MangoOrderMapper());
  });

  it('Seller SKU gắn cho nhiều biến thể ⇒ CẢNH BÁO nêu số biến thể + Fulfillment SKU, KHÔNG chặn gửi', () => {
    const result = service.check(
      order([
        { id: 'item-1', productId: 'PROD-1', skuId: 'SKU-M', sellerSku: 'TEE', skuName: 'White / M', productName: 'Tee', sellerSkuVariantCount: 6 },
      ]) as never,
      [mapping()] as never,
      designsFor(['PROD-1', 'TEE']),
    );

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: READINESS_CODES.MAPPING_SHARED_BY_VARIANTS,
      podOrderItemId: 'item-1',
      message: expect.stringContaining('6 biến thể') as unknown,
    });
    expect(result.warnings[0].message).toContain('MANGO-TEE-BLACK-S');
    expect(result.warnings[0].message).toContain('White / M');
    expect(issueSectionOf(READINESS_CODES.MAPPING_SHARED_BY_VARIANTS)).toBe('MAPPING');
  });

  it('Seller SKU chỉ một biến thể / chưa biết ⇒ không cảnh báo', () => {
    for (const count of [1, null, undefined]) {
      const result = service.check(
        order([{ id: 'item-1', productId: 'PROD-1', skuId: 'SKU-S', sellerSku: 'TEE', productName: 'Tee', sellerSkuVariantCount: count }]) as never,
        [mapping()] as never,
        designsFor(['PROD-1', 'TEE']),
      );
      expect(result.warnings).toEqual([]);
    }
  });

  it('ánh xạ khoá dự phòng (Product ID + TikTok SKU ID) đã riêng từng biến thể ⇒ không cảnh báo', () => {
    const result = service.check(
      order([{ id: 'item-1', productId: 'PROD-1', skuId: 'SKU-S', sellerSku: null, productName: 'Tee', sellerSkuVariantCount: 3 }]) as never,
      [mapping({ sellerSku: null, tiktokSkuId: 'SKU-S' })] as never,
      new Map([[`PROD-1\u0000\u0000SKU-S`, [{ placement: 'FRONT', storageFile: { publicUrl: 'https://cdn.example.com/a.png' } }]]]) as never,
    );
    expect(result.warnings.map((warning) => warning.code)).not.toContain(READINESS_CODES.MAPPING_SHARED_BY_VARIANTS);
  });
});

describe('CASE 10/11: dòng đơn → đúng ánh xạ của ĐÚNG sản phẩm, kể cả khi Seller SKU trùng giữa sản phẩm / shop / nhà cung cấp', () => {
  const mappings = [
    mapping({ id: 'm-shop-a', tiktokProductId: 'PROD-A', sellerSku: 'TEE-BLACK-S', accountId: 'mango', providerSku: 'MANGO-1' }),
    // Cùng Seller SKU, sản phẩm KHÁC (shop khác cấp Product ID khác) — ánh xạ sang nhà cung cấp KHÁC.
    mapping({ id: 'm-shop-b', tiktokProductId: 'PROD-B', sellerSku: 'TEE-BLACK-S', accountId: 'sellerwix', providerSku: 'SW-99' }),
  ];

  it('ghép theo (Product ID + Seller SKU): mỗi sản phẩm lấy ánh xạ / nhà cung cấp của chính nó', () => {
    expect(findMappingForItem({ productId: 'PROD-A', sellerSku: 'TEE-BLACK-S' }, mappings as never)).toMatchObject({
      id: 'm-shop-a',
      providerSku: 'MANGO-1',
    });
    expect(findMappingForItem({ productId: 'PROD-B', sellerSku: 'TEE-BLACK-S' }, mappings as never)).toMatchObject({
      id: 'm-shop-b',
      providerSku: 'SW-99',
    });
  });

  it('CASE 12: Seller SKU trùng nhưng sản phẩm CHƯA khai ánh xạ ⇒ không mượn ánh xạ sản phẩm khác (MAPPING_MISSING)', () => {
    expect(findMappingForItem({ productId: 'PROD-C', sellerSku: 'TEE-BLACK-S' }, mappings as never)).toBeNull();
  });
});
