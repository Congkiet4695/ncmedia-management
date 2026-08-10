import { FulfillmentStatus } from '@prisma/client';
import { MangoOrderMapper } from './mango-order.mapper';
import type { TiktokRecipientAddress } from '../../../pod-tiktok/types/tiktok-order.types';

/** Địa chỉ US điển hình TikTok trả về (district_info theo cấp L0..L3). */
function usAddress(over: Partial<TiktokRecipientAddress> = {}): TiktokRecipientAddress {
  return {
    first_name: 'John',
    last_name: 'Doe',
    phone_number: '(+1)5551234567',
    address_line1: '123 Main St',
    address_line2: 'Apt 4B',
    postal_code: '33602',
    region_code: 'US',
    district_info: [
      { address_level: 'L0', address_level_name: 'Country', address_name: 'United States' },
      { address_level: 'L1', address_level_name: 'State', address_name: 'Florida' },
      { address_level: 'L2', address_level_name: 'City', address_name: 'Tampa' },
    ],
    ...over,
  };
}

describe('MangoOrderMapper', () => {
  let mapper: MangoOrderMapper;

  beforeEach(() => {
    mapper = new MangoOrderMapper();
    jest.spyOn(mapper['logger'], 'warn').mockImplementation(() => undefined);
  });

  describe('buildExternalOrderId', () => {
    it('gắn tiền tố và giữ nguyên mã đơn TikTok để tra cứu hai chiều', () => {
      expect(mapper.buildExternalOrderId('577113948210303351')).toBe('NC-577113948210303351');
    });

    it('🔴 KHÔNG vượt quá 40 ký tự — Mango từ chối mã dài hơn', () => {
      const id = mapper.buildExternalOrderId('9'.repeat(80));
      expect(id.length).toBeLessThanOrEqual(40);
    });
  });

  describe('normalizeAddress', () => {
    it('bóc đúng city/state/country từ district_info', () => {
      const address = mapper.normalizeAddress(usAddress())!;
      expect(address).toMatchObject({
        first_name: 'John',
        last_name: 'Doe',
        address_line_1: '123 Main St',
        address_line_2: 'Apt 4B',
        city: 'Tampa',
        state: 'Florida',
        country: 'US',
        zip: '33602',
      });
    });

    it('chỉ có `name` gộp → tách từ CUỐI làm họ (đúng định dạng tên US)', () => {
      const address = mapper.normalizeAddress(
        usAddress({ first_name: undefined, last_name: undefined, name: 'Mary Jane Watson' }),
      )!;
      expect(address.first_name).toBe('Mary Jane');
      expect(address.last_name).toBe('Watson');
    });

    it('tên chỉ một từ → không có họ', () => {
      const address = mapper.normalizeAddress(
        usAddress({ first_name: undefined, last_name: undefined, name: 'Cher' }),
      )!;
      expect(address.first_name).toBe('Cher');
      expect(address.last_name).toBeNull();
    });

    it('dùng address_detail khi không có address_line1', () => {
      const address = mapper.normalizeAddress(
        usAddress({ address_line1: undefined, address_detail: '456 Oak Ave' }),
      )!;
      expect(address.address_line_1).toBe('456 Oak Ave');
    });

    it('🔴 thiếu field BẮT BUỘC → trả null để tầng validate báo lỗi, KHÔNG bịa giá trị', () => {
      expect(mapper.normalizeAddress(usAddress({ postal_code: undefined }))).toBeNull();
      expect(mapper.normalizeAddress(usAddress({ district_info: [] }))).toBeNull();
      expect(
        mapper.normalizeAddress(
          usAddress({ address_line1: undefined, address_detail: undefined }),
        ),
      ).toBeNull();
    });
  });

  describe('buildCreateOrderRequest', () => {
    const base = {
      externalOrderId: 'NC-1',
      address: mapper2().normalizeAddress(usAddress())!,
      items: [
        {
          podOrderItemId: 'i1',
          providerSku: 'SKU-1',
          quantity: 1,
          productionConfig: null,
          printFiles: [{ key: 'front' as const, url: 'https://cdn/x.png' }],
        },
      ],
      shippingMethod: 'standard' as const,
    };

    it('dựng payload đúng field bắt buộc của tài liệu', () => {
      const request = mapper.buildCreateOrderRequest(base);
      expect(request.order_id).toBe('NC-1');
      expect(request.shipping_method).toBe('standard');
      expect(request.items[0]).toEqual({
        sku: 'SKU-1',
        quantity: 1,
        print_files: [{ key: 'front', url: 'https://cdn/x.png' }],
      });
    });

    it('🔴 KHÔNG gửi field tuỳ chọn khi rỗng (gửi null thừa dễ bị VALIDATION_ERROR)', () => {
      const request = mapper.buildCreateOrderRequest(base);
      expect(request.facility).toBeUndefined();
      expect(request.speed_type).toBeUndefined();
      expect(request.label_url).toBeUndefined();
      expect(request.email).toBeUndefined();
    });

    it('gửi kèm facility/label/note khi có giá trị', () => {
      const request = mapper.buildCreateOrderRequest({
        ...base,
        facility: 'AUTO',
        labelUrl: 'https://cdn/label.pdf',
        note: 'Giao nhanh',
        buyerEmail: 'buyer@x.com',
      });
      expect(request.facility).toBe('AUTO');
      expect(request.label_url).toBe('https://cdn/label.pdf');
      expect(request.note).toBe('Giao nhanh');
      expect(request.email).toBe('buyer@x.com');
    });
  });

  describe('maskRequestForStorage', () => {
    it('🔴 che PII người nhận trước khi lưu, giữ vùng giao hàng để đối soát', () => {
      const request = mapper.buildCreateOrderRequest({
        externalOrderId: 'NC-1',
        address: mapper.normalizeAddress(usAddress())!,
        items: [
          {
            podOrderItemId: 'i1',
            providerSku: 'S',
            quantity: 1,
            productionConfig: null,
            printFiles: [{ key: 'front', url: 'u' }],
          },
        ],
        shippingMethod: 'standard',
      });
      const masked = mapper.maskRequestForStorage(request);

      expect(masked.first_name).not.toContain('John');
      expect(masked.address_line_1).not.toContain('Main');
      expect(masked.phone).not.toContain('5551234567');
      // Vùng giao hàng KHÔNG định danh cá nhân ⇒ giữ nguyên để đối soát.
      expect(masked.city).toBe('Tampa');
      expect(masked.state).toBe('Florida');
      expect(masked.zip).toBe('33602');
    });
  });

  describe('toFulfillmentStatus', () => {
    it.each([
      ['new_order', FulfillmentStatus.SUBMITTED],
      ['in_production', FulfillmentStatus.IN_PRODUCTION],
      ['on_hold', FulfillmentStatus.ON_HOLD],
      ['shipped', FulfillmentStatus.SHIPPED],
      ['rejected', FulfillmentStatus.REJECTED],
      ['cancelled', FulfillmentStatus.CANCELLED],
      ['in_production_cancelled', FulfillmentStatus.CANCELLED],
      ['full_refunded', FulfillmentStatus.REFUNDED],
      ['partial_refunded', FulfillmentStatus.REFUNDED],
    ])('%s → %s', (providerStatus, expected) => {
      expect(mapper.toFulfillmentStatus(providerStatus)).toBe(expected);
    });

    it('shipped + tracking đã giao → nâng lên DELIVERED', () => {
      expect(mapper.toFulfillmentStatus('shipped', 'delivered')).toBe(FulfillmentStatus.DELIVERED);
    });

    it('shipped + tracking đang chuyển → vẫn SHIPPED', () => {
      expect(mapper.toFulfillmentStatus('shipped', 'in_transit')).toBe(FulfillmentStatus.SHIPPED);
    });

    it('🔴 trạng thái lạ → UNKNOWN (không đoán bừa; giá trị gốc vẫn được lưu riêng)', () => {
      expect(mapper.toFulfillmentStatus('brand_new_status')).toBe(FulfillmentStatus.UNKNOWN);
      expect(mapper.toFulfillmentStatus(null)).toBe(FulfillmentStatus.UNKNOWN);
    });
  });

  describe('resolvePlacement', () => {
    it('dùng ánh xạ mặc định khi không khai riêng', () => {
      expect(mapper.resolvePlacement('FRONT', null)).toBe('front');
      expect(mapper.resolvePlacement('BACK', null)).toBe('back');
      expect(mapper.resolvePlacement('LABEL', null)).toBe('neck_label');
    });

    it('ánh xạ khai riêng được ưu tiên hơn mặc định', () => {
      expect(mapper.resolvePlacement('FRONT', { FRONT: 'center_chest' })).toBe('center_chest');
    });

    it('🔴 giá trị khai riêng KHÔNG có trong danh sách của Mango → bỏ qua, dùng mặc định', () => {
      expect(mapper.resolvePlacement('FRONT', { FRONT: 'khong_ton_tai' })).toBe('front');
    });
  });
});

/** Helper tạo mapper cho biểu thức khởi tạo hằng ở phạm vi describe. */
function mapper2(): MangoOrderMapper {
  return new MangoOrderMapper();
}
