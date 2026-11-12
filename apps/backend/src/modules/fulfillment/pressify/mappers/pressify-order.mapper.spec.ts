import { FulfillmentStatus, PodDesignPlacement } from '@prisma/client';
import type { NormalizedAddress } from '../../mango/mappers/mango-order.mapper';
import { PressifyOrderMapper, type PressifyResolvedLine } from './pressify-order.mapper';

/** **Chuyển đổi THUẦN NCMedia ↔ Pressify — đúng field / đúng tên của tài liệu Pressify.** */

const mapper = new PressifyOrderMapper();

const ADDRESS: NormalizedAddress = {
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '5551234567',
  address_line_1: '123 Main St',
  address_line_2: 'Apt 4',
  city: 'Austin',
  state: 'TX',
  country: 'US',
  zip: '78701',
};

const LINE: PressifyResolvedLine = {
  itemId: 'fi-1',
  variantId: '188',
  quantity: 1,
  productName: 'Retro Sunset Tee',
  mockup: 'https://cdn.example/m-front.jpg',
  printFiles: [
    { key: 'front', url: 'https://cdn.example/d-front.png' },
    { key: 'sleeve_left', url: 'https://cdn.example/d-sleeve.png' },
  ],
};

describe('PressifyOrderMapper', () => {
  it('Pressify mua nhãn: body đúng ví dụ tài liệu — address, KHÔNG shipping_label, KHÔNG api_key', () => {
    const body = mapper.buildCreateOrderRequest({
      refId: 'TT-100245',
      handlingType: 'new_order',
      shippingMethod: 'standard',
      labelUrl: null,
      address: ADDRESS,
      note: 'Gift, no invoice',
      printMethod: null,
      lines: [LINE],
    });

    expect(body).toEqual({
      ref_id: 'TT-100245',
      order_status: 'new_order',
      shipping_method: 'standard',
      note: 'Gift, no invoice',
      address: {
        name: 'Jane Doe',
        phone: '5551234567',
        street1: '123 Main St',
        street2: 'Apt 4',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        country: 'US',
      },
      line_items: [
        {
          variant_id: 188,
          quantity: 1,
          product_name: 'Retro Sunset Tee',
          mockup: 'https://cdn.example/m-front.jpg',
          print_files: [
            { key: 'front', url: 'https://cdn.example/d-front.png' },
            { key: 'sleeve_left', url: 'https://cdn.example/d-sleeve.png' },
          ],
        },
      ],
    });
    expect(body).not.toHaveProperty('api_key');
    expect(body).not.toHaveProperty('production');
    expect(body).not.toHaveProperty('shipping_label');
  });

  it('Tự gửi nhãn (TikTok): shipping_label, KHÔNG address (tài liệu: đúng một trong hai)', () => {
    const body = mapper.buildCreateOrderRequest({
      refId: 'TT-58812930',
      handlingType: 'priority',
      shippingMethod: 'standard',
      labelUrl: 'https://cdn.example/labels/58812930.pdf',
      address: ADDRESS,
      note: null,
      printMethod: 'DTG',
      lines: [LINE],
    });
    expect(body.shipping_label).toBe('https://cdn.example/labels/58812930.pdf');
    expect(body).not.toHaveProperty('address');
    expect(body.order_status).toBe('priority');
    expect(body.production).toBe('DTG');
    expect(body.line_items[0].variant_id).toBe(188);
  });

  it('Địa chỉ không có tên đệm / phone / street2 ⇒ bỏ field tuỳ chọn, không gửi chuỗi rỗng', () => {
    const address = mapper.toAddress({
      ...ADDRESS,
      last_name: null,
      phone: null,
      address_line_2: null,
    });
    expect(address).toEqual({
      name: 'Jane',
      street1: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      country: 'US',
    });
  });

  it('ref_id: mã đơn TikTok, lần gửi lại có hậu tố -R<n>', () => {
    expect(mapper.buildRefId('576000000000000001', 1)).toBe('576000000000000001');
    expect(mapper.buildRefId('576000000000000001', 2)).toBe('576000000000000001-R2');
  });

  it('Vị trí in: mặc định theo tài liệu; nhãn cổ không có ⇒ null; placementMap chỉ nhận khoá Pressify', () => {
    expect(mapper.resolvePrintKey(PodDesignPlacement.FRONT, null)).toBe('front');
    expect(mapper.resolvePrintKey(PodDesignPlacement.LEFT, null)).toBe('sleeve_left');
    expect(mapper.resolvePrintKey(PodDesignPlacement.LABEL, null)).toBeNull();
    expect(mapper.resolvePrintKey(PodDesignPlacement.BACK, { BACK: 'cross_shoulder_back' })).toBe(
      'cross_shoulder_back',
    );
    // Khoá của Mango ("left_sleeve") KHÔNG được nhận cho Pressify ⇒ quay về mặc định.
    expect(mapper.resolvePrintKey(PodDesignPlacement.LEFT, { LEFT: 'left_sleeve' })).toBe(
      'sleeve_left',
    );
  });

  it('Trạng thái: đúng bảng tài liệu; onhold (webhook) ⇒ ON_HOLD; giá trị lạ ⇒ UNKNOWN', () => {
    const cases: Array<[string, FulfillmentStatus]> = [
      ['pending', FulfillmentStatus.SUBMITTED],
      ['new_order', FulfillmentStatus.SUBMITTED],
      ['express', FulfillmentStatus.SUBMITTED],
      ['processing', FulfillmentStatus.IN_PRODUCTION],
      ['fixed', FulfillmentStatus.IN_PRODUCTION],
      ['overdue', FulfillmentStatus.IN_PRODUCTION],
      ['wrongsize', FulfillmentStatus.ON_HOLD],
      ['onhold', FulfillmentStatus.ON_HOLD],
      ['shipped', FulfillmentStatus.SHIPPED],
      ['cancelled', FulfillmentStatus.CANCELLED],
      ['Shipped', FulfillmentStatus.SHIPPED],
      ['teleported', FulfillmentStatus.UNKNOWN],
    ];
    for (const [value, expected] of cases) {
      expect(mapper.summarizeProviderStatus(value).status).toBe(expected);
    }
    expect(mapper.summarizeProviderStatus('wrongsize').message).toContain('wrongsize');
  });

  it('Chi phí dòng: CHỈ khi đã thanh toán; variant_id chuỗi (API thật) chuẩn hoá về chuỗi', () => {
    const order = {
      id: 2885109,
      payment_status: 'paid',
      items: [{ id: 3218607, price: '10.38', quantity: 1, variant_id: '3183' }],
    };
    expect(mapper.lineCosts(order)).toEqual([
      { providerItemId: '3218607', variantId: '3183', quantity: 1, itemCost: 10.38 },
    ]);
    expect(mapper.lineCosts({ ...order, payment_status: 'unpaid' })).toEqual([]);
    expect(
      mapper.lineCosts({
        ...order,
        items: [{ id: 1, price: 7.98, quantity: 1, variant_id: 188 }],
      })[0].variantId,
    ).toBe('188');
  });

  it('Chi phí đơn: subtotal = print_cost, ship = shipping_cost, tổng = paid_cost ?? total_cost; "chưa báo" là null', () => {
    expect(
      mapper.orderCosts({
        id: 1,
        print_cost: '7.98',
        shipping_cost: '4.99',
        paid_cost: 12.97,
        total_cost: '12.97',
      }),
    ).toEqual({
      subtotal: 7.98,
      shippingFee: 4.99,
      total: 12.97,
    });
    expect(mapper.orderCosts({ id: 1 })).toEqual({
      subtotal: null,
      shippingFee: null,
      total: null,
    });
  });

  it('Huỷ được: chỉ pending + chưa thanh toán + chưa quá 60 phút', () => {
    const now = new Date('2026-11-11T10:00:00Z');
    const fresh = {
      id: 1,
      fulfill_status: 'pending',
      payment_status: 'unpaid',
      created_at: '2026-11-11T09:30:00Z',
    };
    expect(mapper.cancellability(fresh, now).cancellable).toBe(true);
    expect(mapper.cancellability({ ...fresh, fulfill_status: 'priority' }, now).cancellable).toBe(
      false,
    );
    expect(mapper.cancellability({ ...fresh, payment_status: 'paid' }, now).cancellable).toBe(
      false,
    );
    expect(
      mapper.cancellability({ ...fresh, created_at: '2026-11-11T08:30:00Z' }, now).cancellable,
    ).toBe(false);
  });

  it('Che dữ liệu trước khi lưu: request / đơn / webhook không còn PII người nhận hay api_key', () => {
    const request = mapper.buildCreateOrderRequest({
      refId: 'TT-1',
      handlingType: 'new_order',
      shippingMethod: 'standard',
      labelUrl: null,
      address: ADDRESS,
      note: null,
      printMethod: null,
      lines: [LINE],
    });
    const masked = JSON.stringify(mapper.maskRequestForStorage(request));
    expect(masked).not.toContain('Jane Doe');
    expect(masked).not.toContain('123 Main St');
    expect(masked).not.toContain('5551234567');

    const order = JSON.stringify(
      mapper.maskOrderForStorage({
        id: 1,
        first_name: 'Jane',
        last_name: 'Doe',
        phone: '5551234567',
        address_1: '123 Main St',
        city: 'Austin',
      }),
    );
    expect(order).not.toContain('Doe');
    expect(order).not.toContain('123 Main St');

    const webhook = JSON.stringify(
      mapper.maskWebhookForStorage({ data: { id: 1, status: 'shipped', api_key: 'SECRET-KEY' } }),
    );
    expect(webhook).not.toContain('SECRET-KEY');
    expect(webhook).toContain('shipped');
  });
});
