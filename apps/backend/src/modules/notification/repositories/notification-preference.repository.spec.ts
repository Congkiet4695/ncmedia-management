import { allowsEvent, DEFAULT_NOTIFICATION_PREFERENCES } from './notification-preference.repository';

describe('allowsEvent — mỗi loại sự kiện đi theo ĐÚNG công tắc của nó', () => {
  const only = (key: 'newOrder' | 'fulfillment' | 'returnRefund') => ({
    newOrder: key === 'newOrder',
    fulfillment: key === 'fulfillment',
    returnRefund: key === 'returnRefund',
  });

  it('RETURN_REFUND_REQUEST chỉ theo returnRefund', () => {
    expect(allowsEvent(only('returnRefund'), 'RETURN_REFUND_REQUEST')).toBe(true);
    expect(allowsEvent(only('newOrder'), 'RETURN_REFUND_REQUEST')).toBe(false);
  });

  it('không làm hỏng New Order / Fulfill (regression)', () => {
    expect(allowsEvent(only('newOrder'), 'ORDER_CREATED')).toBe(true);
    expect(allowsEvent(only('returnRefund'), 'ORDER_CREATED')).toBe(false);
    expect(allowsEvent(only('fulfillment'), 'FULFILLMENT_SUBMITTED')).toBe(true);
    expect(allowsEvent(only('fulfillment'), 'FULFILLMENT_CANCELLED')).toBe(true);
    expect(allowsEvent(only('returnRefund'), 'FULFILLMENT_SUBMITTED')).toBe(false);
  });

  it('chưa có tuỳ chọn ⇒ bật tất cả (kể cả Return/Refund)', () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({ newOrder: true, fulfillment: true, returnRefund: true });
  });
});
