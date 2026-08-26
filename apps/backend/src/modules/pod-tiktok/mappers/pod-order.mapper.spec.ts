import { PodOrderMapper } from './pod-order.mapper';
import { TiktokEncryptionService } from '../services/tiktok-encryption.service';
import { TiktokOrder } from '../types/tiktok-order.types';

/** Mã hoá giả — không chứa plaintext, để assert "không rò rỉ PII" có ý nghĩa. */
const encryptionStub = {
  encrypt: (value: string) => `v1.${Buffer.from(value, 'utf8').toString('base64')}`,
} as unknown as TiktokEncryptionService;

/**
 * Đơn mẫu bám sát Response Sample trong tài liệu Get Order List
 * (partner.tiktokshop.com/docv2/page/650aa8094a0bb702c06df242).
 */
function buildOrder(overrides: Partial<TiktokOrder> = {}): TiktokOrder {
  return {
    id: '576461413038785752',
    status: 'AWAITING_SHIPMENT',
    create_time: 1619611561,
    update_time: 1619621355,
    user_id: '7021436810468230477',
    buyer_email: 'v2b2V5@chat.seller.tiktok.com',
    buyer_message: 'Please ship asap!',
    seller_note: 'seller note',
    cancellation_initiator: 'SELLER',
    cancel_reason: 'Pricing error',
    fulfillment_type: 'FULFILLMENT_BY_SELLER',
    delivery_type: 'HOME_DELIVERY',
    shipping_type: 'SELLER',
    shipping_provider: 'TT Virtual express',
    shipping_provider_id: '6617675021119438849',
    tracking_number: 'JX12345',
    warehouse_id: '6955005333819123123',
    payment_method_name: 'CCDC',
    is_cod: false,
    order_type: 'MADE_TO_ORDER',
    handling_duration: { days: '7', type: 'BUSINESS_DAY' },
    is_on_hold_order: false,
    paid_time: 1619611563,
    rts_sla_time: 1619611688,
    tts_sla_time: 1619611761,
    cancel_order_sla_time: 1619621355,
    payment: {
      currency: 'USD',
      total_amount: '5000',
      sub_total: '4000',
      shipping_fee: '500',
      tax: '500',
      seller_discount: '100',
      platform_discount: '50',
    },
    recipient_address: {
      full_address: '1199 Coleman Ave San Jose, CA 95110',
      phone_number: '(+1)213-555-1234',
      name: 'David Kong',
      address_line1: 'TikTok 5800 bristol Pkwy',
      postal_code: '95110',
      region_code: 'US',
    },
    line_items: [
      {
        id: '577086512123755123',
        sku_id: '2729382476852921560',
        product_id: '1729582718312380123',
        product_name: "Women's Winter Crochet Clothes",
        sku_name: 'Black / L',
        seller_sku: 'red_iphone_256',
        display_status: 'AWAITING_SHIPMENT',
        package_status: 'TO_FULFILL',
        package_id: '1153132168123859123',
        sale_price: '0.01',
        original_price: '0.02',
        currency: 'USD',
        is_pod_customized: true,
        pod_info_id: '789821378123',
        item_tax: [{ tax_type: 'SALES_TAX', tax_amount: '21.2', tax_rate: '0.35' }],
      },
    ],
    packages: [{ id: '1152321127278713123' }],
    ...overrides,
  };
}

describe('PodOrderMapper', () => {
  let mapper: PodOrderMapper;

  beforeEach(() => {
    mapper = new PodOrderMapper(encryptionStub);
  });

  describe('map — ánh xạ đúng response TikTok', () => {
    it('giữ đúng các field định danh và trạng thái', () => {
      const result = mapper.map(buildOrder());
      expect(result.tiktokOrderId).toBe('576461413038785752');
      expect(result.data.status).toBe('AWAITING_SHIPMENT');
      expect(result.data.buyerUserId).toBe('7021436810468230477');
      expect(result.data.trackingNumber).toBe('JX12345');
      expect(result.data.shippingType).toBe('SELLER');
    });

    it('chuyển tiền dạng STRING của TikTok sang Decimal', () => {
      const result = mapper.map(buildOrder());
      expect(Number(result.data.totalAmount)).toBe(5000);
      expect(Number(result.data.subTotal)).toBe(4000);
      expect(Number(result.data.tax)).toBe(500);
      expect(result.data.currency).toBe('USD');
    });

    it('giữ Unix seconds cho watermark và sinh thêm bản timestamptz', () => {
      const result = mapper.map(buildOrder());
      expect(result.data.tiktokCreateTime).toBe(1619611561n);
      expect(result.data.tiktokUpdateTime).toBe(1619621355n);
      expect(result.tiktokUpdateTime).toBe(1619621355n);
      expect((result.data.orderedAt as Date).getTime()).toBe(1619611561 * 1000);
      expect((result.data.tiktokUpdatedAt as Date).getTime()).toBe(1619621355 * 1000);
    });

    it('ánh xạ order_type và handling_duration (đặc thù US / POD)', () => {
      const result = mapper.map(buildOrder());
      expect(result.data.orderType).toBe('MADE_TO_ORDER');
      expect(result.data.handlingDurationDays).toBe('7');
      expect(result.data.handlingDurationType).toBe('BUSINESS_DAY');
    });

    it('nhận diện đơn có sản phẩm POD từ line_items', () => {
      const result = mapper.map(buildOrder());
      expect(result.hasPodItem).toBe(true);
      expect(result.items[0].data.isPodCustomized).toBe(true);
      expect(result.items[0].data.podInfoId).toBe('789821378123');
    });

    it('đơn không có POD → hasPodItem = false', () => {
      const order = buildOrder();
      order.line_items![0].is_pod_customized = false;
      expect(mapper.map(order).hasPodItem).toBe(false);
    });

    it('MÃ HOÁ recipient_address, chỉ để lộ region/postal code', () => {
      const result = mapper.map(buildOrder());
      expect(result.data.recipientEnc).toMatch(/^v1\./);
      expect(JSON.stringify(result.data.recipientEnc)).not.toContain('David Kong');
      expect(JSON.stringify(result.data.recipientEnc)).not.toContain('213-555-1234');
      expect(result.data.recipientRegionCode).toBe('US');
      expect(result.data.recipientPostalCode).toBe('95110');
    });

    it('ánh xạ packages và line items', () => {
      const result = mapper.map(buildOrder());
      expect(result.packageIds).toEqual(['1152321127278713123']);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].tiktokLineItemId).toBe('577086512123755123');
      expect(Number(result.items[0].data.salePrice)).toBe(0.01);
    });

    it('đơn thiếu line_items/packages vẫn map được (parser khoan dung)', () => {
      const order = buildOrder({ line_items: undefined, packages: undefined });
      const result = mapper.map(order);
      expect(result.items).toEqual([]);
      expect(result.packageIds).toEqual([]);
      expect(result.hasPodItem).toBe(false);
    });

    it('tiền rỗng/không hợp lệ → null (KHÔNG ép về 0)', () => {
      const order = buildOrder({
        payment: { currency: 'USD', total_amount: '', sub_total: 'abc' },
      });
      const result = mapper.map(order);
      expect(result.data.totalAmount).toBeNull();
      expect(result.data.subTotal).toBeNull();
    });

    it('thiếu update_time → dùng create_time (không để watermark bằng 0)', () => {
      const order = buildOrder({ update_time: undefined as unknown as number });
      expect(mapper.map(order).tiktokUpdateTime).toBe(1619611561n);
    });
  });

  describe('nhận diện dữ liệu người nhận bị TikTok che', () => {
    it('địa chỉ đầy đủ → recipientMasked = false', () => {
      expect(mapper.map(buildOrder()).recipientMasked).toBe(false);
    });

    it('giá trị chứa dấu *** → recipientMasked = true', () => {
      const order = buildOrder({
        recipient_address: {
          name: '****',
          phone_number: '(+1)213-***-1234',
          postal_code: '95110',
          region_code: 'US',
        },
      });
      expect(mapper.map(order).recipientMasked).toBe(true);
    });

    it('các field định danh đều rỗng (UNPAID/ON_HOLD) → recipientMasked = true', () => {
      const order = buildOrder({ recipient_address: { region_code: 'US' } });
      expect(mapper.map(order).recipientMasked).toBe(true);
    });

    it('không có recipient_address → không coi là masked', () => {
      const order = buildOrder({ recipient_address: undefined });
      expect(mapper.map(order).recipientMasked).toBe(false);
      expect(mapper.map(order).data.recipientEnc).toBeNull();
    });
  });

  describe('hashOrder — nền tảng của Compare Logic', () => {
    it('ổn định: cùng dữ liệu cho cùng hash', () => {
      expect(mapper.hashOrder(buildOrder())).toBe(mapper.hashOrder(buildOrder()));
    });

    it('không phụ thuộc thứ tự key trong object', () => {
      const a = buildOrder();
      // Đảo ngược thứ tự key — hash canonical phải cho kết quả y hệt.
      const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as TiktokOrder;
      expect(mapper.hashOrder(a)).toBe(mapper.hashOrder(reordered));
    });

    it('đổi trạng thái đơn → hash đổi', () => {
      expect(mapper.hashOrder(buildOrder())).not.toBe(
        mapper.hashOrder(buildOrder({ status: 'IN_TRANSIT' })),
      );
    });

    it('đổi tracking number → hash đổi', () => {
      expect(mapper.hashOrder(buildOrder())).not.toBe(
        mapper.hashOrder(buildOrder({ tracking_number: 'NEW999' })),
      );
    });

    it('đổi tổng tiền → hash đổi', () => {
      const changed = buildOrder();
      changed.payment!.total_amount = '9999';
      expect(mapper.hashOrder(buildOrder())).not.toBe(mapper.hashOrder(changed));
    });

    it('🔴 recipient_address bị che KHÔNG làm đổi hash (chống update vô ích hàng loạt)', () => {
      const original = buildOrder();
      const masked = buildOrder({
        recipient_address: { name: '****', phone_number: '***', region_code: 'US' },
      });
      expect(mapper.hashOrder(original)).toBe(mapper.hashOrder(masked));
    });

    it('hash là chuỗi hex 64 ký tự (sha256)', () => {
      expect(mapper.hashOrder(buildOrder())).toMatch(/^[0-9a-f]{64}$/);
    });

    /**
     * Hồi quy: TikTok trả về vài thứ KHÔNG ổn định giữa hai lần gọi liên tiếp dù nội dung
     * đơn không đổi. Nếu hash "ăn" các thứ đó thì ~60% số đơn bị coi là có thay đổi ở MỌI
     * lượt sync ⇒ ghi đè DB vô ích và `sync_version` phình vô hạn (đo thực tế 86/143 đơn).
     */
    describe('🔴 bỏ qua dữ liệu KHÔNG ổn định của TikTok', () => {
      it('buyer_avatar (URL có chữ ký, sinh lại mỗi lần gọi) KHÔNG làm đổi hash', () => {
        const a = buildOrder({
          buyer_avatar:
            'https://p19-common-sign.tiktokcdn-us.com/x.jpeg?refresh_token=aaa&x-signature=AAA',
        });
        const b = buildOrder({
          buyer_avatar:
            'https://p16-common-sign.tiktokcdn-us.com/x.jpeg?refresh_token=bbb&x-signature=BBB',
        });
        expect(mapper.hashOrder(a)).toBe(mapper.hashOrder(b));
      });

      it('sku_image đổi shard CDN (p16 ↔ p19) KHÔNG làm đổi hash', () => {
        const a = buildOrder();
        const b = buildOrder();
        a.line_items![0].sku_image =
          'https://p16-oec-general-useast5.ttcdn-us.com/tos/img.jpeg?dr=1';
        b.line_items![0].sku_image =
          'https://p19-oec-general-useast5.ttcdn-us.com/tos/img.jpeg?dr=1';
        expect(mapper.hashOrder(a)).toBe(mapper.hashOrder(b));
      });

      it('nhưng ĐỔI ẢNH thật (khác đường dẫn) VẪN làm đổi hash', () => {
        const a = buildOrder();
        const b = buildOrder();
        a.line_items![0].sku_image = 'https://p16-oec-general-useast5.ttcdn-us.com/tos/img-A.jpeg';
        b.line_items![0].sku_image = 'https://p16-oec-general-useast5.ttcdn-us.com/tos/img-B.jpeg';
        expect(mapper.hashOrder(a)).not.toBe(mapper.hashOrder(b));
      });

      it('đảo thứ tự line_items KHÔNG làm đổi hash (TikTok không bảo đảm thứ tự)', () => {
        const base = buildOrder();
        const second = { ...base.line_items![0], id: 'ITEM-2', sku_id: 'SKU-2' };
        const a = buildOrder();
        a.line_items = [base.line_items![0], second];
        const b = buildOrder();
        b.line_items = [second, base.line_items![0]];
        expect(mapper.hashOrder(a)).toBe(mapper.hashOrder(b));
      });

      it('nhưng THÊM một sản phẩm VẪN làm đổi hash', () => {
        const a = buildOrder();
        const b = buildOrder();
        b.line_items = [...b.line_items!, { ...b.line_items![0], id: 'ITEM-3' }];
        expect(mapper.hashOrder(a)).not.toBe(mapper.hashOrder(b));
      });
    });
  });

  describe('hashItem', () => {
    it('đổi trạng thái package của item → hash item đổi', () => {
      const item = buildOrder().line_items![0];
      const changed = { ...item, package_status: 'FULFILLING' };
      expect(mapper.hashItem(item)).not.toBe(mapper.hashItem(changed));
    });

    it('cùng item → cùng hash', () => {
      const item = buildOrder().line_items![0];
      expect(mapper.hashItem(item)).toBe(mapper.hashItem({ ...item }));
    });
  });
});
