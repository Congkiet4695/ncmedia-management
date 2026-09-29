import { FulfillmentStatus, PodDesignPlacement } from '@prisma/client';
import { SELLERWIX_FULFILLMENT_STATUSES } from '../constants/sellerwix.constants';
import { SellerwixOrderMapper, sellerwixPrintAreasOf } from './sellerwix-order.mapper';

const mapper = new SellerwixOrderMapper();

describe('SellerwixOrderMapper.summarizeStatus — trạng thái Sellerwix → trạng thái chuẩn hoá', () => {
  it.each([
    ['waiting for processing', FulfillmentStatus.SUBMITTED],
    ['in supplier', FulfillmentStatus.IN_PRODUCTION],
    ['supplier delay', FulfillmentStatus.IN_PRODUCTION],
    ['shipped', FulfillmentStatus.SHIPPED],
    ['error', FulfillmentStatus.ON_HOLD],
    ['payment pending', FulfillmentStatus.ON_HOLD],
    ['cancel processing', FulfillmentStatus.ON_HOLD],
    ['refund processing', FulfillmentStatus.ON_HOLD],
    ['canceled', FulfillmentStatus.CANCELLED],
  ])('"%s" ⇒ %s (giữ nguyên văn ở providerStatus)', (raw, expected) => {
    const summary = mapper.summarizeStatus({ fulfillments: [{ status: raw }] });
    expect(summary.status).toBe(expected);
    expect(summary.providerStatus).toBe(raw);
  });

  it('bảng ánh xạ phủ ĐỦ 9 trạng thái tài liệu liệt kê', () => {
    for (const raw of SELLERWIX_FULFILLMENT_STATUSES) {
      expect(mapper.summarizeStatus({ fulfillments: [{ status: raw }] }).status).not.toBe(
        FulfillmentStatus.UNKNOWN,
      );
    }
  });

  it('trạng thái lạ ⇒ UNKNOWN, không đoán', () => {
    expect(mapper.summarizeStatus({ fulfillments: [{ status: 'teleported' }] }).status).toBe(
      FulfillmentStatus.UNKNOWN,
    );
  });

  it('chưa có fulfillments ⇒ SUBMITTED (Sellerwix đã nhận đơn)', () => {
    expect(mapper.summarizeStatus({ fulfillments: [] }).status).toBe(FulfillmentStatus.SUBMITTED);
  });

  it('nhiều phần: đơn chỉ SHIPPED khi mọi phần đã ship; phần đã huỷ không kéo lùi', () => {
    expect(
      mapper.summarizeStatus({ fulfillments: [{ status: 'shipped' }, { status: 'in supplier' }] })
        .status,
    ).toBe(FulfillmentStatus.IN_PRODUCTION);
    expect(
      mapper.summarizeStatus({ fulfillments: [{ status: 'shipped' }, { status: 'canceled' }] })
        .status,
    ).toBe(FulfillmentStatus.SHIPPED);
    expect(
      mapper.summarizeStatus({ fulfillments: [{ status: 'canceled' }, { status: 'canceled' }] })
        .status,
    ).toBe(FulfillmentStatus.CANCELLED);
  });

  it('message của phần lỗi được đưa lên để người vận hành đọc', () => {
    expect(
      mapper.summarizeStatus({ fulfillments: [{ status: 'error', message: 'Design is invalid' }] })
        .message,
    ).toBe('Design is invalid');
  });
});

describe('SellerwixOrderMapper.resolvePrintAreaKey — vị trí in theo print_areas của biến thể', () => {
  const areas = [
    { key: 'CF', display_name: 'Front' },
    { key: 'FB', display_name: 'Back' },
    { key: 'LS', display_name: 'Left Sleeve' },
  ];

  it('FRONT/BACK ⇒ key của vùng in có display_name Front/Back (không viết cứng CF/FB)', () => {
    expect(mapper.resolvePrintAreaKey(PodDesignPlacement.FRONT, null, areas)).toBe('CF');
    expect(mapper.resolvePrintAreaKey(PodDesignPlacement.BACK, null, areas)).toBe('FB');
    expect(
      mapper.resolvePrintAreaKey(PodDesignPlacement.FRONT, null, [
        { key: 'X1', display_name: 'Front' },
      ]),
    ).toBe('X1');
  });

  it('vị trí khác CHỈ khi khai placementMap trỏ tới key có thật', () => {
    expect(mapper.resolvePrintAreaKey(PodDesignPlacement.LEFT, null, areas)).toBeNull();
    expect(mapper.resolvePrintAreaKey(PodDesignPlacement.LEFT, { LEFT: 'LS' }, areas)).toBe('LS');
    expect(mapper.resolvePrintAreaKey(PodDesignPlacement.LEFT, { LEFT: 'NOPE' }, areas)).toBeNull();
  });

  it('biến thể chưa đồng bộ (không có print_areas) ⇒ không đoán', () => {
    expect(mapper.resolvePrintAreaKey(PodDesignPlacement.FRONT, null, [])).toBeNull();
  });

  it('sellerwixPrintAreasOf đọc raw_data, bỏ phần tử thiếu key', () => {
    expect(
      sellerwixPrintAreasOf({ print_areas: [{ key: 'CF' }, { display_name: 'no key' }] }),
    ).toEqual([{ key: 'CF' }]);
    expect(sellerwixPrintAreasOf(null)).toEqual([]);
  });
});

describe('SellerwixOrderMapper.intersectShippingMethods', () => {
  const us = {
    code: 'US1',
    name: 'US Standard',
    active: true,
    shipping_rates: [{ country_code: 'US', deliverable: true }],
  };
  const others = {
    code: 'INT',
    name: 'Intl',
    active: true,
    shipping_rates: [{ country_code: 'OTHERS', deliverable: true }],
  };
  const inactive = { ...us, code: 'OFF', active: false };

  it('giao của mọi biến thể, bỏ phương thức inactive / không giao tới quốc gia', () => {
    expect(
      mapper.intersectShippingMethods([[us, others, inactive], [us]], 'US').map((m) => m.code),
    ).toEqual(['US1']);
    // Dòng OTHERS áp dụng khi không có dòng riêng cho quốc gia.
    expect(mapper.intersectShippingMethods([[us, others]], 'VN').map((m) => m.code)).toEqual([
      'INT',
    ]);
  });
});

describe('SellerwixOrderMapper — tracking & chi phí', () => {
  it('lấy tracking MỚI NHẤT theo tracking_date', () => {
    expect(
      mapper.latestTracking({
        fulfillments: [
          { trackings: [{ tracking_number: 'A', tracking_date: '2023-12-26T00:00:00Z' }] },
          { trackings: [{ tracking_number: 'B', tracking_date: '2023-11-06T00:00:00Z' }] },
        ],
      })?.trackingNumber,
    ).toBe('A');
    expect(mapper.latestTracking({ fulfillments: [{ trackings: [] }] })).toBeNull();
  });

  it('chi phí chưa báo ⇒ null (không quy về 0)', () => {
    expect(mapper.orderCosts({})).toEqual({ total: null, shippingFee: null, subtotal: null });
    expect(
      mapper.orderCosts({
        total_cost: 23.05,
        line_items: [{ item_cost: 10.45 }, { item_cost: 12.6 }],
        fulfillments: [{ shipping_cost: 6.5 }],
      }),
    ).toEqual({ total: 23.05, shippingFee: 6.5, subtotal: 23.05 });
  });
});
