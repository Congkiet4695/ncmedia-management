import { FulfillmentEventType, FulfillmentStatus } from '@prisma/client';
import {
  CANCEL_ACCEPTED_PENDING_MS,
  CANCEL_IN_FLIGHT_MS,
  isCancelPending,
} from './fulfillment-cancel-pending';

describe('isCancelPending — "đang chờ huỷ" từ nhật ký sẵn có', () => {
  const NOW = new Date('2026-11-10T07:00:00Z');
  const at = (msAgo: number) => new Date(NOW.getTime() - msAgo);
  const submitted = { status: FulfillmentStatus.SUBMITTED, providerStatus: null };
  const onHoldError = { status: FulfillmentStatus.ON_HOLD, providerStatus: 'error' };

  it('chưa từng huỷ ⇒ không chờ', () => {
    expect(isCancelPending(submitted, null, NOW)).toBe(false);
  });

  it('🔴 nhà cung cấp đã NHẬN yêu cầu (CANCEL_SUCCESS) mà bản ghi vẫn huỷ được ⇒ đang chờ', () => {
    const event = { eventType: FulfillmentEventType.CANCEL_SUCCESS, createdAt: at(60_000) };
    expect(isCancelPending(submitted, event, NOW)).toBe(true);
    expect(isCancelPending(onHoldError, event, NOW)).toBe(true);
  });

  it('CANCEL_SUCCESS quá hạn chờ ⇒ cho gửi lại', () => {
    const event = { eventType: FulfillmentEventType.CANCEL_SUCCESS, createdAt: at(CANCEL_ACCEPTED_PENDING_MS + 1) };
    expect(isCancelPending(submitted, event, NOW)).toBe(false);
  });

  it('CANCEL_REQUEST chưa có kết quả ⇒ đang chạy trong khoảng ngắn; quá hạn ⇒ không chờ', () => {
    expect(
      isCancelPending(submitted, { eventType: FulfillmentEventType.CANCEL_REQUEST, createdAt: at(5_000) }, NOW),
    ).toBe(true);
    expect(
      isCancelPending(
        submitted,
        { eventType: FulfillmentEventType.CANCEL_REQUEST, createdAt: at(CANCEL_IN_FLIGHT_MS + 1) },
        NOW,
      ),
    ).toBe(false);
  });

  it('lần gần nhất THẤT BẠI ⇒ không chờ (thử lại được)', () => {
    expect(
      isCancelPending(submitted, { eventType: FulfillmentEventType.CANCEL_FAILED, createdAt: at(1_000) }, NOW),
    ).toBe(false);
  });

  it('provider status "cancel processing" ⇒ đang chờ, kể cả khi không có nhật ký', () => {
    expect(isCancelPending({ status: FulfillmentStatus.ON_HOLD, providerStatus: 'cancel processing' }, null, NOW)).toBe(
      true,
    );
  });

  it.each([FulfillmentStatus.CANCELLED, FulfillmentStatus.IN_PRODUCTION, FulfillmentStatus.SHIPPED])(
    'bản ghi %s (không còn huỷ được) ⇒ không bao giờ "đang chờ"',
    (status) => {
      const event = { eventType: FulfillmentEventType.CANCEL_SUCCESS, createdAt: at(1_000) };
      expect(isCancelPending({ status, providerStatus: 'cancel processing' }, event, NOW)).toBe(false);
    },
  );
});
