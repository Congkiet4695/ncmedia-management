import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { MangoOrderMapper } from '../mango/mappers/mango-order.mapper';
import {
  FulfillmentReadinessService,
  READINESS_CODES,
} from './fulfillment-readiness.service';

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

/** Đơn POD tối thiểu để kiểm tra (khớp include của repository). */
function order(over: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    status: 'AWAITING_SHIPMENT',
    recipientEnc: 'enc',
    recipientMasked: false,
    items: [
      {
        id: 'item-1',
        skuId: 'SKU-TT-1',
        sellerSku: 'SELLER-1',
        productId: 'PROD-1',
        productName: 'Tee',
        designs: [
          {
            placement: 'FRONT',
            storageFile: { id: 'f1', publicUrl: 'https://cdn.example.com/a.png' },
          },
        ],
      },
    ],
    ...over,
  };
}

function mapping(over: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    isActive: true,
    tiktokSkuId: 'SKU-TT-1',
    sellerSku: null,
    tiktokProductId: null,
    providerSku: 'MANGO-1',
    productionConfig: null,
    placementMap: null,
    ...over,
  };
}

describe('FulfillmentReadinessService', () => {
  let service: FulfillmentReadinessService;

  beforeEach(() => {
    const encryption = {
      decrypt: jest.fn(() => JSON.stringify(RECIPIENT)),
    } as unknown as TiktokEncryptionService;
    service = new FulfillmentReadinessService(encryption, new MangoOrderMapper());
  });

  it('đủ dữ liệu → sẵn sàng, trả kèm địa chỉ và item đã ghép', () => {
    const result = service.check(order() as never, [mapping()] as never);

    expect(result.ready).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.address?.city).toBe('Tampa');
    expect(result.items).toHaveLength(1);
    expect(result.items?.[0]).toMatchObject({
      providerSku: 'MANGO-1',
      quantity: 1,
      printFiles: [{ key: 'front', url: 'https://cdn.example.com/a.png' }],
    });
  });

  describe('🔴 chặn khi thiếu dữ liệu — mỗi lý do phải nêu rõ', () => {
    it('chưa khai ánh xạ sản phẩm', () => {
      const result = service.check(order() as never, []);
      expect(result.ready).toBe(false);
      expect(result.issues[0].code).toBe(READINESS_CODES.MAPPING_MISSING);
      expect(result.issues[0].podOrderItemId).toBe('item-1');
      // Thông báo phải nhắc đúng sản phẩm để người dùng biết khai cái nào.
      expect(result.issues[0].message).toContain('SELLER-1');
    });

    it('chưa có design', () => {
      const result = service.check(
        order({ items: [{ ...order().items[0], designs: [] }] }) as never,
        [mapping()] as never,
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.DESIGN_MISSING);
    });

    it('🔴 địa chỉ bị TikTok che (đơn 4PL) → chặn, không gửi rác sang xưởng in', () => {
      const result = service.check(order({ recipientMasked: true }) as never, [mapping()] as never);
      expect(result.ready).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.ADDRESS_MASKED);
      expect(result.address).toBeUndefined();
    });

    it('không có địa chỉ', () => {
      const result = service.check(order({ recipientEnc: null }) as never, [mapping()] as never);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.ADDRESS_MISSING);
    });

    it('đơn TikTok đã huỷ → không sản xuất', () => {
      const result = service.check(order({ status: 'CANCELLED' }) as never, [mapping()] as never);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.ORDER_CANCELLED);
    });

    it('🔴 design không có URL công khai → chặn (xưởng in phải tải được file)', () => {
      const result = service.check(
        order({
          items: [
            {
              ...order().items[0],
              designs: [{ placement: 'FRONT', storageFile: { id: 'f1', publicUrl: null } }],
            },
          ],
        }) as never,
        [mapping()] as never,
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.DESIGN_NOT_PUBLIC);
    });

    it('đơn không có sản phẩm nào', () => {
      const result = service.check(order({ items: [] }) as never, [mapping()] as never);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.NO_ITEMS);
    });
  });

  describe('thứ tự ưu tiên khi tìm ánh xạ', () => {
    it('SKU biến thể được ưu tiên hơn Seller SKU và Product ID', () => {
      const result = service.check(order() as never, [
        mapping({ id: 'by-product', tiktokSkuId: null, tiktokProductId: 'PROD-1', providerSku: 'BY-PRODUCT' }),
        mapping({ id: 'by-sku', providerSku: 'BY-SKU' }),
      ] as never);
      expect(result.items?.[0].providerSku).toBe('BY-SKU');
    });

    it('không khớp SKU thì lùi về Seller SKU', () => {
      const result = service.check(order() as never, [
        mapping({ tiktokSkuId: null, sellerSku: 'SELLER-1', providerSku: 'BY-SELLER' }),
      ] as never);
      expect(result.items?.[0].providerSku).toBe('BY-SELLER');
    });

    it('cuối cùng mới dùng Product ID (áp cho mọi biến thể)', () => {
      const result = service.check(order() as never, [
        mapping({ tiktokSkuId: null, tiktokProductId: 'PROD-1', providerSku: 'BY-PRODUCT' }),
      ] as never);
      expect(result.items?.[0].providerSku).toBe('BY-PRODUCT');
    });

    it('🔴 ánh xạ đã tắt (isActive=false) KHÔNG được dùng', () => {
      const result = service.check(order() as never, [mapping({ isActive: false })] as never);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });
  });

  it('ánh xạ vị trí in khai riêng được áp dụng', () => {
    const result = service.check(
      order() as never,
      [mapping({ placementMap: { FRONT: 'center_chest' } })] as never,
    );
    expect(result.items?.[0].printFiles[0].key).toBe('center_chest');
  });

  it('gom nhiều lý do cùng lúc thay vì dừng ở lỗi đầu tiên', () => {
    const result = service.check(
      order({ status: 'CANCELLED', recipientMasked: true }) as never,
      [],
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain(READINESS_CODES.ORDER_CANCELLED);
    expect(codes).toContain(READINESS_CODES.ADDRESS_MASKED);
    expect(codes).toContain(READINESS_CODES.MAPPING_MISSING);
  });
});
