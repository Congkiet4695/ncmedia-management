import { PodReturnStatusGroup, Prisma } from '@prisma/client';
import type { TiktokReturnOrder } from '../../tiktok-sdk/types/tiktok-return-refund.types';
import { mapReturnOrder, mapReturnRecords, statusGroupOf, sumPaidAmount, toMoney } from './pod-return.mapper';

/** Bản ghi Search Returns giả lập theo đúng hình dạng model SDK 202602 (không phải dữ liệu thật). */
function returnOrder(over: Partial<TiktokReturnOrder> = {}): TiktokReturnOrder {
  return {
    returnId: '4035000000000001',
    orderId: '576000000000000001',
    returnType: 'REFUND',
    returnStatus: 'RETURN_OR_REFUND_REQUEST_PENDING',
    returnReason: 'ecom_order_delivered_refund_and_return_reason_damaged',
    returnReasonText: 'Damaged item',
    role: 'BUYER',
    createTime: 1_760_000_000,
    updateTime: 1_760_000_600,
    refundAmount: { currency: 'USD', refundTotal: '21.98', refundSubtotal: '19.98', refundShippingFee: '2.00', refundTax: '0' },
    returnLineItems: [
      {
        returnLineItemId: 'rl-1',
        orderLineItemId: 'ol-1',
        productName: 'Tee',
        skuId: 'sku-1',
        skuName: 'M / Black',
        sellerSku: 'TEE-M-BLK',
        productImage: { url: 'https://img/1.jpg' },
        refundAmount: { currency: 'USD', refundTotal: '10.99', refundSubtotal: '9.99' },
      },
    ],
    ...over,
  };
}

describe('mapReturnOrder', () => {
  it('chuẩn hoá đủ trường, giữ raw status / type / reason', () => {
    const mapped = mapReturnOrder(returnOrder())!;
    expect(mapped).toMatchObject({
      tiktokReturnId: '4035000000000001',
      tiktokOrderId: '576000000000000001',
      returnType: 'REFUND',
      returnStatus: 'RETURN_OR_REFUND_REQUEST_PENDING',
      statusGroup: PodReturnStatusGroup.PENDING,
      refundCompleted: false,
      returnReason: 'ecom_order_delivered_refund_and_return_reason_damaged',
      returnReasonText: 'Damaged item',
      currency: 'USD',
      itemQuantity: 1,
    });
    expect(mapped.refundTotal?.toString()).toBe('21.98');
    expect(mapped.requestedAt.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
    expect(mapped.items[0]).toMatchObject({ orderLineItemId: 'ol-1', sellerSku: 'TEE-M-BLK', productImageUrl: 'https://img/1.jpg' });
  });

  it.each([
    ['REFUND'],
    ['RETURN_AND_REFUND'],
    ['REPLACEMENT'],
  ])('giữ nguyên return_type %s (không ép về danh sách cố định)', (type) => {
    expect(mapReturnOrder(returnOrder({ returnType: type }))!.returnType).toBe(type);
  });

  it.each([
    ['RETURN_OR_REFUND_REQUEST_PENDING', PodReturnStatusGroup.PENDING, false],
    ['AWAITING_BUYER_SHIP', PodReturnStatusGroup.PROCESSING, false],
    ['RETURN_OR_REFUND_REQUEST_SUCCESS', PodReturnStatusGroup.PROCESSING, false],
    ['RETURN_OR_REFUND_REQUEST_COMPLETE', PodReturnStatusGroup.COMPLETED, true],
    ['REPLACEMENT_REQUEST_REFUND_SUCCESS', PodReturnStatusGroup.COMPLETED, true],
    ['REPLACEMENT_REQUEST_COMPLETE', PodReturnStatusGroup.COMPLETED, false],
    ['REFUND_OR_RETURN_REQUEST_REJECT', PodReturnStatusGroup.REJECTED, false],
    ['REJECT_RECEIVE_PACKAGE', PodReturnStatusGroup.REJECTED, false],
    ['RETURN_OR_REFUND_REQUEST_CANCEL', PodReturnStatusGroup.CANCELLED, false],
    ['SOMETHING_NEW_FROM_TIKTOK', PodReturnStatusGroup.OTHER, false],
  ])('%s ⇒ nhóm %s, đã hoàn = %s', (status, group, refunded) => {
    const mapped = mapReturnOrder(returnOrder({ returnStatus: status }))!;
    expect(mapped.statusGroup).toBe(group);
    expect(mapped.refundCompleted).toBe(refunded);
    expect(mapped.returnStatus).toBe(status);
  });

  it('nhiều dòng hàng ⇒ số lượng = số line item; refund từng dòng tách bạch với tổng yêu cầu', () => {
    const mapped = mapReturnOrder(
      returnOrder({
        returnLineItems: [
          { returnLineItemId: 'a', orderLineItemId: 'ol-a', skuId: 's1', refundAmount: { refundTotal: '5.00' } },
          { returnLineItemId: 'b', orderLineItemId: 'ol-b', skuId: 's1', refundAmount: { refundTotal: '5.00' } },
          { returnLineItemId: 'c', orderLineItemId: 'ol-c', skuId: 's2', refundAmount: { refundTotal: '7.50' } },
        ],
      }),
    )!;
    expect(mapped.itemQuantity).toBe(3);
    expect(mapped.items.map((item) => item.refundTotal?.toString())).toEqual(['5', '5', '7.5']);
    expect(mapped.refundTotal?.toString()).toBe('21.98');
  });

  it('hoàn một phần: lưu partial_refund riêng, KHÔNG ghi đè refund_total', () => {
    const mapped = mapReturnOrder(
      returnOrder({ sellerProposedReturnType: 'PARTIAL_REFUND', partialRefund: { amount: '4.00', currency: 'USD' } }),
    )!;
    expect(mapped.partialRefundAmount?.toString()).toBe('4');
    expect(mapped.refundTotal?.toString()).toBe('21.98');
  });

  it('thiếu return_id / order_id / update_time ⇒ null (không upsert bản ghi không định danh được)', () => {
    expect(mapReturnOrder(returnOrder({ returnId: undefined }))).toBeNull();
    expect(mapReturnOrder(returnOrder({ orderId: '' }))).toBeNull();
    expect(mapReturnOrder(returnOrder({ updateTime: undefined }))).toBeNull();
  });

  it('địa chỉ kho trả hàng không vào bản lưu đối chiếu; hash ổn định giữa hai lần đọc', () => {
    const withAddress = { ...returnOrder(), returnWarehouseAddress: { fullAddress: 'secret street' } } as TiktokReturnOrder;
    const mapped = mapReturnOrder(withAddress)!;
    expect(JSON.stringify(mapped.rawPayload)).not.toContain('secret street');
    expect(mapReturnOrder(returnOrder())!.payloadHash).toBe(mapReturnOrder(returnOrder())!.payloadHash);
    expect(mapReturnOrder(returnOrder({ returnStatus: 'AWAITING_BUYER_SHIP' }))!.payloadHash).not.toBe(mapped.payloadHash);
  });
});

describe('toMoney / sumPaidAmount', () => {
  it('chuỗi tiền ⇒ Decimal; rỗng / lạ ⇒ null (không ép 0)', () => {
    expect(toMoney('12.30')?.toString()).toBe('12.3');
    expect(toMoney('')).toBeNull();
    expect(toMoney(undefined)).toBeNull();
    expect(toMoney('abc')).toBeNull();
  });

  it('Paid Amount = Σ giá của ĐÚNG các dòng; thiếu một dòng ⇒ null (không dùng tổng đơn)', () => {
    const d = (v: string) => new Prisma.Decimal(v);
    expect(sumPaidAmount([{ paidAmount: d('9.99') }, { paidAmount: d('12.01') }])?.toString()).toBe('22');
    expect(sumPaidAmount([{ paidAmount: d('9.99') }, { paidAmount: null }])).toBeNull();
    expect(sumPaidAmount([])).toBeNull();
  });
});

describe('statusGroupOf', () => {
  it('trạng thái chưa biết ⇒ OTHER', () => expect(statusGroupOf('X')).toBe(PodReturnStatusGroup.OTHER));
});

describe('mapReturnRecords — lịch sử đúng như TikTok trả', () => {
  it('sắp theo thời gian tăng dần, mục thiếu thời gian xếp cuối, không thêm mục nào', () => {
    const entries = mapReturnRecords([
      { createTime: 300, event: 'SELLER_APPROVE', role: 'SELLER', note: 'ok' },
      { event: 'UNKNOWN_TIME' },
      { createTime: 100, event: 'BUYER_CREATE', role: 'BUYER', reasonText: 'Damaged', images: [{}, {}] },
    ]);
    expect(entries.map((entry) => entry.event)).toEqual(['BUYER_CREATE', 'SELLER_APPROVE', 'UNKNOWN_TIME']);
    expect(entries[0]).toMatchObject({ role: 'BUYER', reason: 'Damaged', attachments: 2 });
    expect(entries[1]).toMatchObject({ note: 'ok', time: new Date(300_000).toISOString() });
    expect(entries[2].time).toBeNull();
  });

  it('TikTok trả rỗng ⇒ rỗng (không dựng lịch sử)', () => {
    expect(mapReturnRecords([])).toEqual([]);
  });
});
