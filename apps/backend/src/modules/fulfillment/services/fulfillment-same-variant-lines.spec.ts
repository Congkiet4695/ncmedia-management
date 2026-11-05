import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import type { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { MangoOrderMapper, type NormalizedAddress } from '../mango/mappers/mango-order.mapper';
import { SellerwixOrderMapper } from '../sellerwix/mappers/sellerwix-order.mapper';
import { skuIdKeyOf } from '../shared/mapping-match';
import { FulfillmentReadinessService, READINESS_CODES } from './fulfillment-readiness.service';

/**
 * TikTok không có field số lượng: mua 2 cái cùng biến thể là 2 `line_items` khác id, mỗi cái 1 đơn vị.
 * Bộ test này khoá hành vi phía gửi nhà cung cấp, vốn độc lập với cách màn hình gộp dòng hiển thị:
 * mỗi line item đi riêng, đúng SKU của biến thể, tổng số lượng bằng số đơn vị khách đặt.
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

const line = (id: string, sellerSku: string, skuId: string) => ({
  id,
  tiktokLineItemId: `tt-${id}`,
  productId: 'PRODUCT-A',
  productName: 'Product A',
  skuId,
  skuName: `Variant ${skuId}`,
  sellerSku,
  isGift: false,
});

const order = (items: Array<ReturnType<typeof line>>) =>
  ({
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
  }) as unknown as PodOrderWithRelations;

const mapping = (sellerSku: string, providerSku: string) =>
  ({
    id: `map-${sellerSku}`,
    isActive: true,
    accountId: 'provider-A',
    tiktokProductId: 'PRODUCT-A',
    sellerSku,
    tiktokSkuId: sellerSku.replace('SELLER-', 'SKU-'),
    providerSku,
    baseCost: null,
    productionConfig: null,
    productionLine: null,
    placementMap: null,
  }) as never;

const designsFor = (...sellerSkus: string[]) =>
  new Map(
    sellerSkus.map((sku) => [
      skuIdKeyOf('PRODUCT-A', sku.replace('SELLER-', 'SKU-')) as string,
      [
        {
          placement: 'FRONT' as const,
          sourceUrl: `https://cdn.example.com/${sku}.png`,
          storageFile: null,
        },
      ],
    ]),
  );

describe('🔴 nhiều line item cùng sản phẩm — readiness và request gửi nhà cung cấp', () => {
  const service = new FulfillmentReadinessService(
    { decrypt: () => JSON.stringify(RECIPIENT) } as unknown as TiktokEncryptionService,
    new MangoOrderMapper(),
  );
  const ADDRESS = { first_name: 'John' } as NormalizedAddress;

  it('Case 1: 2 line item cùng biến thể ⇒ 2 dòng gửi, mỗi dòng 1 đơn vị, tổng = 2, cùng SKU nhà cung cấp', () => {
    const result = service.check(
      order([line('a', 'SELLER-X', 'SKU-X'), line('b', 'SELLER-X', 'SKU-X')]),
      [mapping('SELLER-X', 'PROVIDER-X')],
      designsFor('SELLER-X'),
      undefined,
      'provider-A',
    );

    expect(result.ready).toBe(true);
    expect(result.items?.map((item) => [item.podOrderItemId, item.tiktokLineItemId, item.providerSku, item.quantity])).toEqual([
      ['a', 'tt-a', 'PROVIDER-X', 1],
      ['b', 'tt-b', 'PROVIDER-X', 1],
    ]);
  });

  it('Case 2: 2 biến thể ⇒ mỗi dòng đúng ánh xạ và file in của biến thể đó, không lấy nhầm của nhau', () => {
    const result = service.check(
      order([line('a', 'SELLER-X', 'SKU-X'), line('b', 'SELLER-Y', 'SKU-Y')]),
      [mapping('SELLER-X', 'PROVIDER-X'), mapping('SELLER-Y', 'PROVIDER-Y')],
      designsFor('SELLER-X', 'SELLER-Y'),
      undefined,
      'provider-A',
    );

    expect(result.items?.map((item) => [item.podOrderItemId, item.providerSku, item.printFiles[0].url])).toEqual([
      ['a', 'PROVIDER-X', 'https://cdn.example.com/SELLER-X.png'],
      ['b', 'PROVIDER-Y', 'https://cdn.example.com/SELLER-Y.png'],
    ]);
  });

  it('chỉ một biến thể thiếu ánh xạ ⇒ vẫn chặn cả đơn, lỗi gắn đúng line item', () => {
    const result = service.check(
      order([line('a', 'SELLER-X', 'SKU-X'), line('b', 'SELLER-Y', 'SKU-Y')]),
      [mapping('SELLER-X', 'PROVIDER-X')],
      designsFor('SELLER-X', 'SELLER-Y'),
      undefined,
      'provider-A',
    );

    expect(result.ready).toBe(false);
    expect(result.issues.map((issue) => [issue.code, issue.podOrderItemId])).toEqual([
      [READINESS_CODES.MAPPING_MISSING, 'b'],
    ]);
  });

  it('hợp đồng API: 2 line item cùng khoá thiếu ánh xạ ⇒ backend vẫn trả từng issue theo line item', () => {
    const result = service.check(
      order([line('a', 'SELLER-X', 'SKU-X'), line('b', 'SELLER-X', 'SKU-X')]),
      [],
      new Map(),
      undefined,
      'provider-A',
    );

    expect(result.ready).toBe(false);
    expect(result.issues.map((issue) => issue.podOrderItemId)).toEqual(['a', 'b']);
  });

  it('Case 5: request Mango có đủ 2 dòng quantity = 1, không gộp, không nhân đôi', () => {
    const { items } = service.check(
      order([line('a', 'SELLER-X', 'SKU-X'), line('b', 'SELLER-X', 'SKU-X')]),
      [mapping('SELLER-X', 'PROVIDER-X')],
      designsFor('SELLER-X'),
    );

    const request = new MangoOrderMapper().buildCreateOrderRequest({
      externalOrderId: 'NC-1',
      address: ADDRESS,
      items: items ?? [],
      shippingMethod: 'standard',
    });

    expect(request.items.map((item) => [item.sku, item.quantity])).toEqual([
      ['PROVIDER-X', 1],
      ['PROVIDER-X', 1],
    ]);
  });

  it('Case 5: request Sellerwix có đủ 2 dòng, mỗi dòng mang reference_id line item riêng', () => {
    const request = new SellerwixOrderMapper().buildCreateOrderRequest({
      referenceId: 'NC-1',
      storeId: 'store-1',
      address: { name: 'John Doe' },
      lines: ['tt-a', 'tt-b'].map((referenceId, index) => ({
        itemId: `row-${index}`,
        referenceId,
        sku: 'PROVIDER-X',
        quantity: 1,
        printAreas: [{ key: 'CF', url: 'https://cdn.example.com/x.png' }],
      })),
      shippingMethod: 'STD',
    } as never);

    expect(request.line_items.map((item) => [item.sku, item.quantity, item.reference_id])).toEqual([
      ['PROVIDER-X', 1, 'tt-a'],
      ['PROVIDER-X', 1, 'tt-b'],
    ]);
  });
});
