import type { PodOrderWithRelations } from '../../pod-tiktok/types/pod-order-with-relations.type';
import type { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { MangoOrderMapper, type NormalizedAddress } from '../mango/mappers/mango-order.mapper';
import { rowKeyOf } from '../shared/mapping-match';
import { FulfillmentReadinessService, READINESS_CODES, type MappingWithDesigns } from './fulfillment-readiness.service';

/**
 * Danh tính của ánh xạ / design là BIẾN THỂ (TikTok Product ID + TikTok SKU ID). Seller SKU trùng KHÔNG được làm lẫn
 * file in hay SKU nhà cung cấp, và không có đường dự phòng theo Seller SKU.
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

const line = (id: string, productId: string, skuId: string | null, sellerSku: string | null) => ({
  id,
  tiktokLineItemId: `tt-${id}`,
  productId,
  productName: `Product ${productId}`,
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

const mapping = (
  productId: string,
  skuId: string | null,
  sellerSku: string | null,
  providerSku: string,
  over: Record<string, unknown> = {},
) =>
  ({
    id: `map-${providerSku}`,
    isActive: true,
    accountId: 'provider-A',
    tiktokProductId: productId,
    tiktokSkuId: skuId,
    sellerSku,
    legacySharedKey: false,
    providerSku,
    baseCost: null,
    productionConfig: null,
    productionLine: null,
    placementMap: null,
    ...over,
  }) as unknown as MappingWithDesigns;

interface DesignFixture {
  tiktokProductId: string;
  tiktokSkuId: string | null;
  sellerSku: string | null;
  legacySharedKey: boolean;
  url: string;
}

/** Dựng bảng design bằng ĐÚNG `rowKeyOf` của hệ thống, như các service thật. */
const designIndex = (rows: DesignFixture[]) => {
  const index = new Map<string, Array<{ placement: 'FRONT'; sourceUrl: string; storageFile: null }>>();
  for (const row of rows) {
    const key = rowKeyOf(row) as string;
    index.set(key, [{ placement: 'FRONT', sourceUrl: row.url, storageFile: null }]);
  }
  return index;
};
const design = (productId: string, skuId: string | null, sellerSku: string | null, url: string, legacy = false): DesignFixture => ({
  tiktokProductId: productId,
  tiktokSkuId: skuId,
  sellerSku,
  legacySharedKey: legacy,
  url,
});

describe('🔴 khoá BIẾN THỂ của ánh xạ và design', () => {
  const service = new FulfillmentReadinessService(
    { decrypt: () => JSON.stringify(RECIPIENT) } as unknown as TiktokEncryptionService,
    new MangoOrderMapper(),
  );
  const check = (
    items: Array<ReturnType<typeof line>>,
    mappings: MappingWithDesigns[],
    designs: DesignFixture[],
    expectedAccountId?: string,
  ) => service.check(order(items), mappings, designIndex(designs), undefined, expectedAccountId);
  const sent = (result: ReturnType<typeof check>) =>
    result.items?.map((item) => [item.podOrderItemId, item.providerSku, item.printFiles[0].url]);

  it('Test 1 — biến thể A ⇒ design A', () => {
    const result = check(
      [line('a', 'P-A', 'V-A', 'SKU-A')],
      [mapping('P-A', 'V-A', 'SKU-A', 'PROVIDER-A')],
      [design('P-A', 'V-A', 'SKU-A', 'https://cdn/a.png')],
    );
    expect(result.ready).toBe(true);
    expect(sent(result)).toEqual([['a', 'PROVIDER-A', 'https://cdn/a.png']]);
  });

  it('Test 2 — CÙNG sản phẩm, CÙNG Seller SKU, khác biến thể ⇒ mỗi biến thể đúng design và SKU nhà cung cấp', () => {
    const result = check(
      [line('a1', 'P-A', 'V-A1', 'SAME-SKU'), line('a2', 'P-A', 'V-A2', 'SAME-SKU')],
      [mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-S'), mapping('P-A', 'V-A2', 'SAME-SKU', 'PROVIDER-XL')],
      [design('P-A', 'V-A1', 'SAME-SKU', 'https://cdn/1.png'), design('P-A', 'V-A2', 'SAME-SKU', 'https://cdn/2.png')],
    );
    expect(result.ready).toBe(true);
    expect(sent(result)).toEqual([
      ['a1', 'PROVIDER-S', 'https://cdn/1.png'],
      ['a2', 'PROVIDER-XL', 'https://cdn/2.png'],
    ]);
  });

  it('Test 2b — biến thể chưa khai KHÔNG mượn cấu hình của biến thể khác cùng Seller SKU', () => {
    const result = check(
      [line('a2', 'P-A', 'V-A2', 'SAME-SKU')],
      [mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-S')],
      [design('P-A', 'V-A1', 'SAME-SKU', 'https://cdn/1.png')],
    );
    expect(result.ready).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.MAPPING_MISSING]);
    expect(result.items).toBeUndefined();
  });

  it('Test 3 — HAI sản phẩm cùng Seller SKU ⇒ không map nhầm design', () => {
    const result = check(
      [line('a', 'P-A', 'V-A1', 'SAME-SKU'), line('b', 'P-B', 'V-B1', 'SAME-SKU')],
      [mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-A'), mapping('P-B', 'V-B1', 'SAME-SKU', 'PROVIDER-B')],
      [design('P-A', 'V-A1', 'SAME-SKU', 'https://cdn/a.png'), design('P-B', 'V-B1', 'SAME-SKU', 'https://cdn/b.png')],
    );
    expect(sent(result)).toEqual([
      ['a', 'PROVIDER-A', 'https://cdn/a.png'],
      ['b', 'PROVIDER-B', 'https://cdn/b.png'],
    ]);
  });

  it('Test 3b — cùng SKU ID nhưng khác Product ID ⇒ không ghép', () => {
    const result = check(
      [line('b', 'P-B', 'V-1', 'SKU')],
      [mapping('P-A', 'V-1', 'SKU', 'PROVIDER-A')],
      [design('P-A', 'V-1', 'SKU', 'https://cdn/a.png')],
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.MAPPING_MISSING]);
  });

  it('Test 4 — Seller SKU đổi / khác giữa đơn và cấu hình nhưng ĐÚNG biến thể ⇒ vẫn ghép', () => {
    const result = check(
      [line('a', 'P-A', 'V-A', 'RENAMED-SKU')],
      [mapping('P-A', 'V-A', 'OLD-SKU', 'PROVIDER-A')],
      [design('P-A', 'V-A', 'OLD-SKU', 'https://cdn/a.png')],
    );
    expect(sent(result)).toEqual([['a', 'PROVIDER-A', 'https://cdn/a.png']]);
  });

  it('biến thể không có Seller SKU vẫn khai và gửi được', () => {
    const result = check(
      [line('a', 'P-A', 'V-A', null)],
      [mapping('P-A', 'V-A', null, 'PROVIDER-A')],
      [design('P-A', 'V-A', null, 'https://cdn/a.png')],
    );
    expect(result.ready).toBe(true);
  });

  it('Test 5 — không có SKU ID ⇒ MỘT lỗi khoá, KHÔNG tự chọn theo Seller SKU dù có cấu hình cùng Seller SKU', () => {
    const result = check(
      [line('a', 'P-A', null, 'SAME-SKU')],
      [
        mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-A'),
        mapping('P-A', null, 'SAME-SKU', 'PROVIDER-LEGACY', { legacySharedKey: true }),
      ],
      [design('P-A', 'V-A1', 'SAME-SKU', 'https://cdn/a.png')],
    );
    expect(result.ready).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.MAPPING_KEY_MISSING]);
    expect(result.items).toBeUndefined();
  });

  describe('Test 7 — cấu hình tạo trước khi đổi khoá', () => {
    it('bản ghi đã được migration điền SKU ID ⇒ tiếp tục hoạt động như cũ', () => {
      const result = check(
        [line('a', 'P-A', 'V-A', 'SKU-A')],
        // Hình dạng đúng như sau migration: có Seller SKU cũ, thêm SKU ID, không phải legacy.
        [mapping('P-A', 'V-A', 'SKU-A', 'PROVIDER-A')],
        [design('P-A', 'V-A', 'SKU-A', 'https://cdn/a.png')],
      );
      expect(result.ready).toBe(true);
    });

    it('🔴 ánh xạ legacy dùng chung ⇒ CHẶN bằng mã riêng, KHÔNG gửi SKU của nó, dù tham chiếu trùng biến thể', () => {
      const result = check(
        [line('a', 'P-A', 'V-A1', 'SAME-SKU')],
        [mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-LEGACY', { legacySharedKey: true })],
        [],
      );
      expect(result.ready).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.MAPPING_LEGACY_CONFIRM_REQUIRED]);
      expect(result.issues[0].message).toContain('Design mapping unavailable');
      expect(result.items).toBeUndefined();
    });

    it('🔴 design legacy ⇒ CHẶN bằng mã riêng, KHÔNG in file của nó', () => {
      const result = check(
        [line('a', 'P-A', 'V-A1', 'SAME-SKU')],
        [mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-A')],
        [design('P-A', null, 'SAME-SKU', 'https://cdn/legacy.png', true)],
      );
      expect(result.ready).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.DESIGN_LEGACY_CONFIRM_REQUIRED]);
      expect(result.items).toBeUndefined();
    });

    it('sau khi xác nhận: biến thể có bản ghi riêng ⇒ gửi được; biến thể chưa xác nhận vẫn bị chặn', () => {
      const legacyMapping = mapping('P-A', null, 'SAME-SKU', 'PROVIDER-LEGACY', { legacySharedKey: true });
      const legacyDesign = design('P-A', null, 'SAME-SKU', 'https://cdn/legacy.png', true);
      const adoptedMapping = mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-LEGACY');
      const adoptedDesign = design('P-A', 'V-A1', 'SAME-SKU', 'https://cdn/legacy.png');

      const adopted = check(
        [line('a1', 'P-A', 'V-A1', 'SAME-SKU')],
        [legacyMapping, adoptedMapping],
        [legacyDesign, adoptedDesign],
      );
      expect(adopted.ready).toBe(true);
      expect(sent(adopted)).toEqual([['a1', 'PROVIDER-LEGACY', 'https://cdn/legacy.png']]);

      const other = check(
        [line('a2', 'P-A', 'V-A2', 'SAME-SKU')],
        [legacyMapping, adoptedMapping],
        [legacyDesign, adoptedDesign],
      );
      expect(other.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.MAPPING_LEGACY_CONFIRM_REQUIRED]);
    });

    it('ánh xạ legacy của Seller SKU KHÁC không được đề xuất', () => {
      const result = check(
        [line('a', 'P-A', 'V-A1', 'SKU-1')],
        [mapping('P-A', null, 'SKU-2', 'PROVIDER-LEGACY', { legacySharedKey: true })],
        [],
      );
      expect(result.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.MAPPING_MISSING]);
    });
  });

  it('Test 6 — request nhà cung cấp mang đúng SKU, file in và số lượng của từng biến thể', () => {
    const { items = [], ready } = check(
      [
        line('a1', 'P-A', 'V-A1', 'SAME-SKU'),
        line('a1b', 'P-A', 'V-A1', 'SAME-SKU'),
        line('a2', 'P-A', 'V-A2', 'SAME-SKU'),
      ],
      [mapping('P-A', 'V-A1', 'SAME-SKU', 'PROVIDER-S'), mapping('P-A', 'V-A2', 'SAME-SKU', 'PROVIDER-XL')],
      [design('P-A', 'V-A1', 'SAME-SKU', 'https://cdn/1.png'), design('P-A', 'V-A2', 'SAME-SKU', 'https://cdn/2.png')],
      'provider-A',
    );
    expect(ready).toBe(true);

    const request = new MangoOrderMapper().buildCreateOrderRequest({
      externalOrderId: 'NC-1',
      address: { first_name: 'John' } as NormalizedAddress,
      items,
      shippingMethod: 'standard',
    });
    expect(request.items.map((item) => [item.sku, item.quantity, item.print_files[0].url])).toEqual([
      ['PROVIDER-S', 1, 'https://cdn/1.png'],
      ['PROVIDER-S', 1, 'https://cdn/1.png'],
      ['PROVIDER-XL', 1, 'https://cdn/2.png'],
    ]);
  });

  it('Test 6b — sai nhà cung cấp vẫn bị chặn sau khi đổi khoá', () => {
    const result = check(
      [line('a', 'P-A', 'V-A', 'SKU')],
      [mapping('P-A', 'V-A', 'SKU', 'PROVIDER-A', { accountId: 'provider-B' })],
      [design('P-A', 'V-A', 'SKU', 'https://cdn/a.png')],
      'provider-A',
    );
    expect(result.issues.map((issue) => issue.code)).toEqual([READINESS_CODES.MAPPING_PROVIDER_MISMATCH]);
  });
});
