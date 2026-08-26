import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { MangoOrderMapper } from '../mango/mappers/mango-order.mapper';
import { mappingKeyOf } from '../shared/mapping-match';
import { FulfillmentReadinessService, READINESS_CODES } from './fulfillment-readiness.service';

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

/**
 * Đơn POD tối thiểu để kiểm tra (khớp include của repository).
 *
 * 🔴 KHÔNG còn `designs` trên line item: design nay thuộc **Product Mapping**.
 */
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
      },
    ],
    ...over,
  };
}

/**
 * Một design ĐANG HIỆU LỰC của một sản phẩm.
 *
 * 🔴 Không còn `deletedAt`: hợp đồng mới là nơi gọi chỉ đưa vào design chưa bị xoá mềm
 * (truy vấn đã lọc). Xem `ReadinessDesign`.
 */
function design(over: Record<string, unknown> = {}) {
  return {
    placement: 'FRONT',
    storageFile: { publicUrl: 'https://cdn.example.com/a.png' },
    ...over,
  };
}

/**
 * Design của tổ chức, tra theo (Product ID + Seller SKU) — ĐỘC LẬP với ánh xạ.
 *
 * `order()` mặc định dùng cặp khoá `PROD-1` / `SELLER-1`, nên helper này dựng sẵn đúng khoá đó.
 */
function designs(rows: Array<ReturnType<typeof design>> = [design()]) {
  return new Map([[mappingKeyOf('PROD-1', 'SELLER-1') as string, rows]]) as never;
}

/** Không có design nào — dùng cho các bài kiểm "thiếu design". */
const noDesigns = new Map() as never;

/**
 * Ánh xạ sản phẩm — mặc định ĐÃ có design FRONT.
 *
 * 🔴 Khoá là CẶP (tiktokProductId + sellerSku) và phải khớp line item ở `order()`. Thiếu một
 * nửa thì bản ghi không ghép được với đơn nào — đó chính là luật mà refactor này thiết lập.
 */
function mapping(over: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    isActive: true,
    accountId: 'nha-cung-cap-A',
    tiktokProductId: 'PROD-1',
    sellerSku: 'SELLER-1',
    // Có mặt để chứng minh nó KHÔNG tham gia ghép nữa.
    tiktokSkuId: 'SKU-TT-1',
    providerSku: 'MANGO-1',
    baseCost: null,
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
    const result = service.check(order() as never, [mapping()] as never, designs());

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
      const result = service.check(order() as never, [], designs());
      expect(result.ready).toBe(false);
      expect(result.issues[0].code).toBe(READINESS_CODES.MAPPING_MISSING);
      expect(result.issues[0].podOrderItemId).toBe('item-1');
      // Thông báo phải nêu ĐỦ CẶP KHOÁ để người dùng khai đúng bản ghi cần khai.
      expect(result.issues[0].message).toContain('SELLER-1');
      expect(result.issues[0].message).toContain('PROD-1');
    });

    it('🔴 ánh xạ có nhưng CHƯA upload design ⇒ DESIGN_MISSING', () => {
      const result = service.check(order() as never, [mapping()] as never, noDesigns);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.DESIGN_MISSING);
      // Thông báo phải chỉ đúng chỗ sửa: design khai ở Product Mapping, không khai ở đơn.
      expect(
        result.issues.find((i) => i.code === READINESS_CODES.DESIGN_MISSING)?.message,
      ).toContain('Product Mapping');
    });

    /**
     * Design đã xoá mềm nay được lọc ở TRUY VẤN (`deleted_at IS NULL`), không phải ở đây —
     * xem hợp đồng của `ReadinessDesign`. Hai bài dưới kiểm đúng thứ còn thuộc trách nhiệm
     * của service: bản đồ rỗng, và design thuộc sản phẩm khác.
     */
    it('🔴 không có design nào trong bản đồ ⇒ DESIGN_MISSING', () => {
      const result = service.check(order() as never, [mapping()] as never, noDesigns);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.DESIGN_MISSING);
    });

    it('🔴 design của SẢN PHẨM KHÁC không được tính cho sản phẩm này', () => {
      const otherProduct = new Map([['SAN-PHAM-KHAC SKU-KHAC', [design()]]]) as never;
      const result = service.check(order() as never, [mapping()] as never, otherProduct);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.DESIGN_MISSING);
    });

    it('🔴 địa chỉ bị TikTok che (đơn 4PL) → chặn, không gửi rác sang xưởng in', () => {
      const result = service.check(
        order({ recipientMasked: true }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.ADDRESS_MASKED);
      expect(result.address).toBeUndefined();
    });

    it('không có địa chỉ', () => {
      const result = service.check(
        order({ recipientEnc: null }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.ADDRESS_MISSING);
    });

    it('đơn TikTok đã huỷ → không sản xuất', () => {
      const result = service.check(
        order({ status: 'CANCELLED' }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.ORDER_CANCELLED);
    });

    it('🔴 design không có URL công khai → chặn (xưởng in phải tải được file)', () => {
      const result = service.check(
        order() as never,
        [mapping()] as never,
        designs([design({ storageFile: { publicUrl: null } })]),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.DESIGN_NOT_PUBLIC);
    });

    it('đơn không có sản phẩm nào', () => {
      const result = service.check(order({ items: [] }) as never, [mapping()] as never, designs());
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.NO_ITEMS);
    });
  });

  /**
   * 🔴 Khối này khoá LUẬT GHÉP MỚI lại: danh tính của ánh xạ là **Product ID + Seller SKU**,
   * không có bất kỳ bước dự phòng nào. Trước refactor, khớp một trong ba khoá là đủ — và đó
   * chính là cách một sản phẩm có thể rơi vào hai bản ghi ánh xạ khác nhau, mỗi bản một bộ
   * design. Nếu một bài dưới đây đỏ lên, luật ghép đã bị nới lỏng trở lại.
   */
  describe('luật ghép: Product ID + Seller SKU', () => {
    it('khớp ĐỦ cặp khoá ⇒ ghép được', () => {
      const result = service.check(
        order() as never,
        [
          mapping({ tiktokProductId: 'PROD-1', sellerSku: 'SELLER-1', providerSku: 'DUNG-CAP' }),
        ] as never,
        designs(),
      );
      expect(result.items?.[0].providerSku).toBe('DUNG-CAP');
    });

    it('KHÔNG ghép khi chỉ khớp Seller SKU (Product ID khác)', () => {
      const result = service.check(
        order() as never,
        [mapping({ tiktokProductId: 'SAN-PHAM-KHAC', sellerSku: 'SELLER-1' })] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('KHÔNG ghép khi chỉ khớp Product ID (Seller SKU khác)', () => {
      const result = service.check(
        order() as never,
        [mapping({ tiktokProductId: 'PROD-1', sellerSku: 'SKU-KHAC' })] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('🔴 KHÔNG còn ghép theo TikTok SKU ID', () => {
      const result = service.check(
        order() as never,
        [mapping({ tiktokProductId: null, sellerSku: null, tiktokSkuId: 'SKU-TT-1' })] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('ánh xạ thiếu một nửa khoá (dữ liệu cũ) KHÔNG ghép với đơn nào', () => {
      const result = service.check(
        order() as never,
        [mapping({ sellerSku: null })] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('khoảng trắng thừa hai đầu khoá không làm hỏng phép ghép', () => {
      const result = service.check(
        order() as never,
        [
          mapping({ tiktokProductId: ' PROD-1 ', sellerSku: 'SELLER-1 ', providerSku: 'TRIMMED' }),
        ] as never,
        designs(),
      );
      expect(result.items?.[0].providerSku).toBe('TRIMMED');
    });

    it('🔴 Seller SKU phân biệt HOA/thường (TikTok coi đó là hai SKU khác nhau)', () => {
      const result = service.check(
        order() as never,
        [mapping({ sellerSku: 'seller-1' })] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('🔴 ánh xạ đã tắt (isActive=false) KHÔNG được dùng', () => {
      const result = service.check(
        order() as never,
        [mapping({ isActive: false })] as never,
        designs(),
      );
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });
  });

  /**
   * 🔴 Ánh xạ được tra ở phạm vi TỔ CHỨC vì danh tính của nó là (org, Product ID, Seller SKU)
   * — lọc thêm theo tài khoản nhà cung cấp sẽ khiến màn hình đơn và luồng gửi đơn nhìn thấy
   * hai kết quả khác nhau. Đổi lại, phải phát hiện được ánh xạ khai cho nhà cung cấp khác.
   */
  describe('ánh xạ khai cho nhà cung cấp khác', () => {
    it('lệch nhà cung cấp ⇒ MAPPING_PROVIDER_MISMATCH, KHÔNG phải MAPPING_MISSING', () => {
      const result = service.check(
        order() as never,
        [mapping({ accountId: 'nha-cung-cap-A' })] as never,
        designs(),
        undefined,
        'nha-cung-cap-B',
      );

      const codes = result.issues.map((issue) => issue.code);
      expect(codes).toContain(READINESS_CODES.MAPPING_PROVIDER_MISMATCH);
      expect(codes).not.toContain(READINESS_CODES.MAPPING_MISSING);
      expect(result.ready).toBe(false);
    });

    it('🔴 KHÔNG gửi SKU của xưởng khác đi — item bị loại khỏi danh sách gửi', () => {
      const result = service.check(
        order() as never,
        [mapping({ accountId: 'nha-cung-cap-A' })] as never,
        designs(),
        undefined,
        'nha-cung-cap-B',
      );
      expect(result.items).toBeUndefined();
    });

    it('đúng nhà cung cấp ⇒ vẫn sẵn sàng như thường', () => {
      const result = service.check(
        order() as never,
        [mapping({ accountId: 'nha-cung-cap-A' })] as never,
        designs(),
        undefined,
        'nha-cung-cap-A',
      );
      expect(result.ready).toBe(true);
    });

    it('không truyền nhà cung cấp kỳ vọng ⇒ bỏ qua phép kiểm (tương thích ngược)', () => {
      const result = service.check(
        order() as never,
        [mapping({ accountId: 'bat-ky' })] as never,
        designs(),
      );
      expect(result.ready).toBe(true);
    });
  });

  it('Base Cost của ánh xạ được chép vào item để đơn giữ ảnh chụp giá vốn', () => {
    const result = service.check(
      order() as never,
      [mapping({ baseCost: 12.5 })] as never,
      designs(),
    );
    expect(result.items?.[0].baseCost).toBe(12.5);
  });

  it('🔴 MỘT design của sản phẩm phục vụ MỌI line item cùng cặp khoá', () => {
    // Đây là lý do tồn tại của cả thay đổi này: trước đây một SKU bán 11 lần phải upload
    // 11 lần cùng một file. Giờ một lần khai theo sản phẩm là đủ cho mọi đơn.
    const twoItems = order({
      items: [
        // Hai dòng hàng khác nhau, thậm chí khác `skuId` (hai shop) — nhưng CÙNG cặp khoá
        // nghiệp vụ, nên dùng chung đúng một bộ design.
        {
          id: 'item-1',
          skuId: 'SKU-TT-1',
          sellerSku: 'SELLER-1',
          productId: 'PROD-1',
          productName: 'Tee',
        },
        {
          id: 'item-2',
          skuId: 'SKU-TT-9',
          sellerSku: 'SELLER-1',
          productId: 'PROD-1',
          productName: 'Tee',
        },
      ],
    });

    const result = service.check(twoItems as never, [mapping()] as never, designs());

    expect(result.ready).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(
      result.items?.every((i) => i.printFiles[0].url === 'https://cdn.example.com/a.png'),
    ).toBe(true);
  });

  it('Front-only vẫn SẴN SÀNG — không bắt buộc phải có Back (§5)', () => {
    const result = service.check(order() as never, [mapping()] as never, designs());
    expect(result.ready).toBe(true);
    expect(result.items?.[0].printFiles).toHaveLength(1);
  });

  it('Có cả Front và Back ⇒ gửi hai file in', () => {
    const result = service.check(
      order() as never,
      [mapping()] as never,
      designs([
        design(),
        design({ placement: 'BACK', storageFile: { publicUrl: 'https://cdn.example.com/b.png' } }),
      ]),
    );
    expect(result.ready).toBe(true);
    expect(result.items?.[0].printFiles.map((f) => f.key).sort()).toEqual(['back', 'front']);
  });

  it('ánh xạ vị trí in khai riêng được áp dụng', () => {
    const result = service.check(
      order() as never,
      [mapping({ placementMap: { FRONT: 'center_chest' } })] as never,
      designs(),
    );
    expect(result.items?.[0].printFiles[0].key).toBe('center_chest');
  });

  it('gom nhiều lý do cùng lúc thay vì dừng ở lỗi đầu tiên', () => {
    const result = service.check(
      order({ status: 'CANCELLED', recipientMasked: true }) as never,
      [],
      designs(),
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain(READINESS_CODES.ORDER_CANCELLED);
    expect(codes).toContain(READINESS_CODES.ADDRESS_MASKED);
    expect(codes).toContain(READINESS_CODES.MAPPING_MISSING);
  });
});
