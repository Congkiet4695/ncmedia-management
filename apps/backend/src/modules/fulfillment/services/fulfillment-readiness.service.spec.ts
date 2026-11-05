import { TiktokEncryptionService } from '../../pod-tiktok/services/tiktok-encryption.service';
import { MangoOrderMapper } from '../mango/mappers/mango-order.mapper';
import { skuIdKeyOf } from '../shared/mapping-match';
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
    recipientRegionCode: 'US',
    recipientPostalCode: '33602',
    // Nhãn vận chuyển: mặc định CHƯA có (mọi test cũ giữ nguyên ý nghĩa).
    shippingLabelUrl: null,
    shippingLabelSource: null,
    shippingLabelPackageId: null,
    shippingLabelTrackingNumber: null,
    shippingLabelAt: null,
    packages: [],
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
 * Design của tổ chức, tra theo biến thể — ĐỘC LẬP với ánh xạ.
 *
 * `order()` mặc định dùng biến thể `PROD-1` / `SKU-TT-1`, nên helper này dựng sẵn đúng khoá đó.
 */
function designs(rows: Array<ReturnType<typeof design>> = [design()]) {
  return new Map([[skuIdKeyOf('PROD-1', 'SKU-TT-1') as string, rows]]) as never;
}

/** Không có design nào — dùng cho các bài kiểm "thiếu design". */
const noDesigns = new Map() as never;

/**
 * Ánh xạ sản phẩm — mặc định ĐÃ có design FRONT.
 *
 * 🔴 Khoá là biến thể (tiktokProductId + tiktokSkuId) và phải khớp line item ở `order()`.
 */
function mapping(over: Record<string, unknown> = {}) {
  return {
    id: 'map-1',
    isActive: true,
    accountId: 'nha-cung-cap-A',
    tiktokProductId: 'PROD-1',
    sellerSku: 'SELLER-1',
    tiktokSkuId: 'SKU-TT-1',
    providerSku: 'MANGO-1',
    baseCost: null,
    productionConfig: null,
    productionLine: null,
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

  describe('🔴 biến thể KHÔNG có Seller SKU', () => {
    const keyless = (over: Record<string, unknown>) =>
      order({
        items: [
          {
            id: 'item-1',
            skuId: '1732716272490942940',
            sellerSku: null,
            productId: '1732716254750544348',
            productName: 'GTA 6 Poster',
            skuName: '27x40 (UNFRAMED)',
            ...over,
          },
        ],
      });

    /** Ánh xạ + design khai theo khoá SKU ID cho đúng biến thể của `keyless()`. */
    const skuIdMapping = (over: Record<string, unknown> = {}) =>
      mapping({ tiktokProductId: '1732716254750544348', sellerSku: null, tiktokSkuId: '1732716272490942940', ...over });
    const skuIdDesigns = () =>
      new Map([[skuIdKeyOf('1732716254750544348', '1732716272490942940') as string, [design()]]]) as never;

    it.each([['SELLER_SKU_EMPTY_ON_TIKTOK'], ['VARIANT_NOT_SYNCED'], ['SELLER_SKU_AMBIGUOUS'], [null]])(
      '%s + ánh xạ & design theo SKU ID ⇒ SẴN SÀNG, gửi đúng SKU nhà cung cấp (Seller SKU không tham gia payload)',
      (issue) => {
        const result = service.check(keyless({ productKeyIssue: issue }) as never, [skuIdMapping()] as never, skuIdDesigns());
        expect(result.issues).toEqual([]);
        expect(result.ready).toBe(true);
        expect(result.items?.[0]).toMatchObject({ podOrderItemId: 'item-1', providerSku: 'MANGO-1', quantity: 1 });
      },
    );

    it('chưa khai ánh xạ ⇒ MAPPING_MISSING (sửa được ngay), KHÔNG còn MAPPING_KEY_MISSING', () => {
      const result = service.check(
        keyless({ productKeyIssue: 'SELLER_SKU_EMPTY_ON_TIKTOK' }) as never,
        [],
        skuIdDesigns(),
      );
      expect(result.ready).toBe(false);
      expect(result.issues.map((i) => i.code)).toEqual([READINESS_CODES.MAPPING_MISSING]);
      expect(result.issues[0]).toMatchObject({ tiktokSkuId: '1732716272490942940', sellerSku: null });
    });

    it('có ánh xạ nhưng thiếu design ⇒ vẫn chặn bằng DESIGN_MISSING (validation khác giữ nguyên)', () => {
      const result = service.check(keyless({}) as never, [skuIdMapping()] as never, noDesigns);
      expect(result.issues.map((i) => i.code)).toEqual([READINESS_CODES.DESIGN_MISSING]);
    });

    it('ánh xạ SKU ID của BIẾN THỂ KHÁC / SẢN PHẨM KHÁC không bao giờ ghép nhầm', () => {
      const otherVariant = service.check(keyless({}) as never, [skuIdMapping({ tiktokSkuId: 'OTHER' })] as never, skuIdDesigns());
      expect(otherVariant.issues.map((i) => i.code)).toEqual([READINESS_CODES.MAPPING_MISSING]);
      const otherProduct = service.check(
        keyless({}) as never,
        [skuIdMapping({ tiktokProductId: 'OTHER-PRODUCT' })] as never,
        skuIdDesigns(),
      );
      expect(otherProduct.issues.map((i) => i.code)).toEqual([READINESS_CODES.MAPPING_MISSING]);
    });

    it('người bán đặt Seller SKU SAU khi đã khai theo SKU ID ⇒ ánh xạ/design SKU ID của chính biến thể vẫn dùng được', () => {
      const result = service.check(
        keyless({ sellerSku: 'SET-LATER', sellerSkuSource: 'CATALOG' }) as never,
        [skuIdMapping()] as never,
        skuIdDesigns(),
      );
      expect(result.ready).toBe(true);
    });

    it('thiếu CẢ Seller SKU lẫn SKU ID ⇒ MỘT lỗi MAPPING_KEY_MISSING nêu đúng lý do; thiếu Product ID nói đúng là Product ID', () => {
      const noKey = service.check(keyless({ skuId: null, productKeyIssue: 'NO_SKU_ID' }) as never, [], designs());
      expect(noKey.issues.map((i) => i.code)).toEqual([READINESS_CODES.MAPPING_KEY_MISSING]);
      expect(noKey.issues[0].message).toContain('SKU ID');
      for (const empty of [null, '', '   ']) {
        const blank = service.check(keyless({ skuId: null, sellerSku: empty }) as never, [], designs());
        expect(blank.issues.map((i) => i.code)).toEqual([READINESS_CODES.MAPPING_KEY_MISSING]);
      }
      const noProduct = service.check(keyless({ productId: null, sellerSku: 'SELLER-1' }) as never, [], designs());
      expect(noProduct.issues[0].message).toContain('Product ID');
    });

    it('Seller SKU khôi phục từ danh mục (CATALOG) ⇒ ghép ánh xạ + design như dòng bình thường', () => {
      const result = service.check(
        keyless({ sellerSku: 'SELLER-1', productId: 'PROD-1', skuId: 'SKU-TT-1', sellerSkuSource: 'CATALOG' }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(true);
      expect(result.items?.[0].providerSku).toBe('MANGO-1');
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

    /**
     * 🔴 LUẬT ĐÃ ĐỔI (và đây là lý do đổi):
     *
     * Cờ `recipient_masked` chỉ nói "lần đồng bộ gần đây TikTok trả về bản đã che". Nhờ quy
     * tắc masking-safe write, `recipient_enc` vẫn giữ bản THẬT chụp trước đó — chặn theo cờ
     * là chặn nhầm hàng loạt đơn mà hệ thống có đủ địa chỉ để giao.
     */
    it('🔴 cờ masked nhưng địa chỉ đã lưu vẫn đọc được ⇒ VẪN gửi được', () => {
      const result = service.check(
        order({ recipientMasked: true }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.address?.city).toBe('Tampa');
      expect(result.shippingMode).toBe('ADDRESS');
    });

    it('🔴 không đọc được địa chỉ và CHƯA có nhãn ⇒ chặn với mã TIKTOK_SHIPPING_LABEL_REQUIRED', () => {
      const result = service.check(
        order({ recipientEnc: null }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain(
        READINESS_CODES.TIKTOK_SHIPPING_LABEL_REQUIRED,
      );
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
  describe('luật ghép: Product ID + TikTok SKU ID', () => {
    it('khớp ĐỦ khoá ⇒ ghép được', () => {
      const result = service.check(order() as never, [mapping({ providerSku: 'DUNG-CAP' })] as never, designs());
      expect(result.items?.[0].providerSku).toBe('DUNG-CAP');
    });

    it('KHÔNG ghép khi chỉ khớp SKU ID (Product ID khác)', () => {
      const result = service.check(order() as never, [mapping({ tiktokProductId: 'SAN-PHAM-KHAC' })] as never, designs());
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('KHÔNG ghép khi chỉ khớp Product ID + Seller SKU (SKU ID khác)', () => {
      const result = service.check(order() as never, [mapping({ tiktokSkuId: 'BIEN-THE-KHAC' })] as never, designs());
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('ánh xạ thiếu SKU ID (dữ liệu cũ) KHÔNG ghép với đơn nào', () => {
      const result = service.check(order() as never, [mapping({ tiktokSkuId: null })] as never, designs());
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });

    it('khoảng trắng thừa hai đầu khoá không làm hỏng phép ghép', () => {
      const result = service.check(
        order() as never,
        [mapping({ tiktokProductId: ' PROD-1 ', tiktokSkuId: 'SKU-TT-1 ', providerSku: 'TRIMMED' })] as never,
        designs(),
      );
      expect(result.items?.[0].providerSku).toBe('TRIMMED');
    });

    it('🔴 ánh xạ đã tắt (isActive=false) KHÔNG được dùng', () => {
      const result = service.check(order() as never, [mapping({ isActive: false })] as never, designs());
      expect(result.issues.map((i) => i.code)).toContain(READINESS_CODES.MAPPING_MISSING);
    });
  });

  /**
   * 🔴 Ánh xạ được tra ở phạm vi TỔ CHỨC vì danh tính của nó là (org, Product ID, SKU ID)
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
        // Hai dòng hàng khác nhau của CÙNG biến thể (mua 2 cái) ⇒ dùng chung đúng một bộ design.
        {
          id: 'item-1',
          skuId: 'SKU-TT-1',
          sellerSku: 'SELLER-1',
          productId: 'PROD-1',
          productName: 'Tee',
        },
        {
          id: 'item-2',
          skuId: 'SKU-TT-1',
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
      order({ status: 'CANCELLED', recipientEnc: null }) as never,
      [],
      designs(),
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain(READINESS_CODES.ORDER_CANCELLED);
    expect(codes).toContain(READINESS_CODES.TIKTOK_SHIPPING_LABEL_REQUIRED);
    expect(codes).toContain(READINESS_CODES.MAPPING_MISSING);
  });

  /**
   * 🔴 Một đơn = MỘT xưởng (tài liệu MangoTeePrints: tên sản phẩm mang tên xưởng in). Hai dòng
   * khai hai line khác nhau thì nhà cung cấp từ chối CẢ đơn — phải chặn trước khi gửi và nói rõ
   * hai giá trị đang xung đột.
   */
  it('line sản xuất: một line cho cả đơn ⇒ trả về line đó cho bản ghi fulfillment', () => {
    const result = service.check(order() as never, [mapping({ productionLine: 'TIKTOK' })] as never, designs());

    expect(result.ready).toBe(true);
    expect(result.productionLine).toBe('TIKTOK');
    expect(result.items?.[0].productionLine).toBe('TIKTOK');
  });

  it('line sản xuất: hai dòng khai hai line khác nhau ⇒ CHẶN với lý do nêu đủ hai giá trị', () => {
    const twoItems = order({
      items: [
        { id: 'item-1', skuId: 'SKU-TT-1', sellerSku: 'SELLER-1', productId: 'PROD-1', productName: 'Tee' },
        { id: 'item-2', skuId: 'SKU-TT-2', sellerSku: 'SELLER-2', productId: 'PROD-2', productName: 'Hoodie' },
      ],
    });
    // Khoá tra design dùng ĐÚNG hàm thuần của hệ thống, không tự ghép chuỗi.
    const designsForBoth = new Map([
      [skuIdKeyOf('PROD-1', 'SKU-TT-1') as string, [design()]],
      [skuIdKeyOf('PROD-2', 'SKU-TT-2') as string, [design()]],
    ]);

    const result = service.check(
      twoItems as never,
      [
        mapping({ productionLine: 'TIKTOK' }),
        mapping({ id: 'map-2', tiktokProductId: 'PROD-2', tiktokSkuId: 'SKU-TT-2', sellerSku: 'SELLER-2', providerSku: 'MANGO-2', productionLine: 'FASTUS' }),
      ] as never,
      designsForBoth as never,
    );

    expect(result.ready).toBe(false);
    const conflict = result.issues.find((issue) => issue.code === READINESS_CODES.PRODUCTION_LINE_CONFLICT);
    expect(conflict?.message).toContain('TIKTOK');
    expect(conflict?.message).toContain('FASTUS');
    expect(result.productionLine).toBeNull();
  });

  it('không dòng nào khai line ⇒ null (tầng gửi đơn dùng mặc định của tài khoản)', () => {
    const result = service.check(order() as never, [mapping()] as never, designs());
    expect(result.productionLine).toBeNull();
  });
  /**
   * 🔴 Quà tặng khuyến mãi — nhận diện DUY NHẤT bằng `is_gift` TikTok trả về (đã lưu vào
   * `pod_order_items.is_gift` lúc đồng bộ). Không đoán theo tên, không theo giá 0.
   */
  describe('quà tặng khuyến mãi (TikTok line_items[].is_gift)', () => {
    /** Dòng thường đã cấu hình đủ (khoá PROD-1 / SKU-TT-1 — khớp `mapping()` + `designs()`). */
    const normal = (over: Record<string, unknown> = {}) => ({
      id: 'item-1',
      skuId: 'SKU-TT-1',
      sellerSku: 'SELLER-1',
      productId: 'PROD-1',
      productName: 'Tee',
      isGift: false,
      ...over,
    });
    /** Quà tặng thật như dữ liệu production: không Seller SKU, giá 0, sản phẩm riêng. */
    const gift = (over: Record<string, unknown> = {}) => ({
      id: 'gift-1',
      skuId: 'SKU-GIFT-1',
      sellerSku: null,
      productId: 'PROD-GIFT',
      productName: 'Holiday Reward Coupon',
      skuName: 'Spend $40, Get $4 Off',
      salePrice: 0,
      isGift: true,
      ...over,
    });
    const codes = (list: Array<{ code: string }>) => list.map((entry) => entry.code);

    it('đơn không có quà ⇒ hành vi cũ, không có cảnh báo', () => {
      const result = service.check(order({ items: [normal()] }) as never, [mapping()] as never, designs());
      expect(result.ready).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.items).toHaveLength(1);
    });

    it('một quà chưa cấu hình + một dòng thường ⇒ sẵn sàng, quà KHÔNG vào payload, có cảnh báo', () => {
      const result = service.check(
        order({ items: [normal(), gift()] }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.items?.map((item) => item.podOrderItemId)).toEqual(['item-1']);
      expect(codes(result.warnings)).toEqual([READINESS_CODES.PROMOTION_GIFT_NOT_SENT]);
      expect(result.warnings[0].podOrderItemId).toBe('gift-1');
    });

    it('nhiều quà (từ nhiều khuyến mãi) ⇒ mỗi quà một cảnh báo, không lỗi MAPPING/DESIGN nào', () => {
      const result = service.check(
        order({
          items: [normal(), gift(), gift({ id: 'gift-2', productId: 'PROD-GIFT-2' }), gift({ id: 'gift-3' })],
        }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(true);
      expect(result.warnings.map((warning) => warning.podOrderItemId)).toEqual(['gift-1', 'gift-2', 'gift-3']);
      expect(result.items).toHaveLength(1);
    });

    it('🔴 quà KHÔNG làm dòng thường thiếu ánh xạ được bỏ qua', () => {
      const result = service.check(
        order({ items: [normal({ productId: 'PROD-UNMAPPED' }), gift()] }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(false);
      expect(codes(result.issues)).toEqual([READINESS_CODES.MAPPING_MISSING]);
      expect(result.issues[0].podOrderItemId).toBe('item-1');
      expect(codes(result.warnings)).toEqual([READINESS_CODES.PROMOTION_GIFT_NOT_SENT]);
    });

    it('🔴 dòng thường giá 0 (is_gift=false) vẫn bị kiểm ánh xạ như thường', () => {
      const result = service.check(
        order({ items: [normal({ productId: 'PROD-FREE', salePrice: 0 })] }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(codes(result.issues)).toEqual([READINESS_CODES.MAPPING_MISSING]);
      expect(result.warnings).toEqual([]);
    });

    it('🔴 tên có chữ "Gift" nhưng is_gift=false ⇒ KHÔNG phải quà', () => {
      const result = service.check(
        order({ items: [normal({ productId: 'PROD-X', productName: 'Free Gift Voucher Promotion Tee' })] }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(codes(result.issues)).toEqual([READINESS_CODES.MAPPING_MISSING]);
      expect(result.warnings).toEqual([]);
    });

    it('🔴 thiếu dữ liệu is_gift (không rõ loại) ⇒ đi luồng kiểm thường, không tự coi là quà', () => {
      const unknownType: Record<string, unknown> = gift();
      delete unknownType.isGift;
      const result = service.check(order({ items: [unknownType] }) as never, [mapping()] as never, designs());
      // Không Seller SKU nhưng có SKU ID ⇒ có khoá; chưa khai ánh xạ ⇒ chặn bằng MAPPING_MISSING như dòng thường.
      expect(codes(result.issues)).toEqual([READINESS_CODES.MAPPING_MISSING]);
      expect(result.warnings).toEqual([]);
    });

    it('🔴 đơn CHỈ có quà chưa cấu hình ⇒ CHẶN (không gửi đơn rỗng sang xưởng)', () => {
      const result = service.check(order({ items: [gift()] }) as never, [mapping()] as never, designs());
      expect(result.ready).toBe(false);
      expect(codes(result.issues)).toEqual([READINESS_CODES.NO_FULFILLABLE_ITEMS]);
      expect(result.items).toBeUndefined();
    });

    it('quà ĐÃ có Product Mapping + design ⇒ được gửi sang xưởng như dòng thường', () => {
      const result = service.check(
        order({ items: [normal(), gift({ sellerSku: 'SELLER-1', productId: 'PROD-1', skuId: 'SKU-TT-1' })] }) as never,
        [mapping()] as never,
        designs(),
      );
      expect(result.ready).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.items?.map((item) => item.podOrderItemId)).toEqual(['item-1', 'gift-1']);
    });

    it('🔴 quà ĐÃ có Product Mapping nhưng thiếu design ⇒ vẫn CHẶN (không âm thầm bỏ quà đã cấu hình)', () => {
      const result = service.check(
        order({ items: [gift({ sellerSku: 'SELLER-1', productId: 'PROD-1', skuId: 'SKU-TT-1' })] }) as never,
        [mapping()] as never,
        noDesigns,
      );
      expect(result.ready).toBe(false);
      expect(codes(result.issues)).toEqual([READINESS_CODES.DESIGN_MISSING]);
    });
  });
});
