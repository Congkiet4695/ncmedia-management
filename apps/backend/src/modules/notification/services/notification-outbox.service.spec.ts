import type { NotificationEventRepository } from '../repositories/notification-event.repository';
import type { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import type { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import type { NotificationEventInput } from '../types/notification-payload.types';
import type { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationOutboxService } from './notification-outbox.service';

function build(options: { telegramEnabled: boolean; newOrder?: boolean; fulfillment?: boolean }) {
  const events = { enqueue: jest.fn().mockResolvedValue(1) };
  const configs = { isEnabled: jest.fn().mockResolvedValue(options.telegramEnabled) };
  const dispatcher = { kick: jest.fn() };
  const preferences = {
    find: jest.fn().mockResolvedValue({ newOrder: options.newOrder ?? true, fulfillment: options.fulfillment ?? true }),
  };
  const service = new NotificationOutboxService(
    events as unknown as NotificationEventRepository,
    configs as unknown as TelegramConfigRepository,
    dispatcher as unknown as NotificationDispatcherService,
    preferences as unknown as NotificationPreferenceRepository,
  );
  return { service, events, configs, dispatcher, preferences };
}

const FULFILL_EVENT = {
  organizationId: 'org-a',
  eventType: 'FULFILLMENT_SUBMITTED',
  entityType: 'FULFILLMENT_ORDER',
  entityId: 'fo-1',
  payload: {},
} as unknown as NotificationEventInput;

describe('NotificationOutboxService.isEnabled — backend áp tuỳ chọn khi GHI sự kiện', () => {
  it.each([
    // [telegram, newOrder, fulfillment, ORDER_CREATED?, FULFILLMENT_SUBMITTED?, FULFILLMENT_CANCELLED?]
    [true, true, true, true, true, true],
    [true, true, false, true, false, false],
    [true, false, true, false, true, true],
    [true, false, false, false, false, false],
    // Chưa cấu hình / tắt bot ⇒ không ghi gì dù tuỳ chọn bật.
    [false, true, true, false, false, false],
  ])(
    'telegram=%s newOrder=%s fulfillment=%s ⇒ NEW ORDER %s · FULFILL %s · CANCEL %s',
    async (telegramEnabled, newOrder, fulfillment, order, submitted, cancelled) => {
      const { service } = build({ telegramEnabled, newOrder, fulfillment });
      await expect(service.isEnabled('org-a', 'ORDER_CREATED')).resolves.toBe(order);
      await expect(service.isEnabled('org-a', 'FULFILLMENT_SUBMITTED')).resolves.toBe(submitted);
      await expect(service.isEnabled('org-a', 'FULFILLMENT_CANCELLED')).resolves.toBe(cancelled);
    },
  );

  it('chưa cấu hình bot ⇒ không cần đọc tuỳ chọn', async () => {
    const { service, preferences } = build({ telegramEnabled: false });
    await service.isEnabled('org-a', 'ORDER_CREATED');
    expect(preferences.find).not.toHaveBeenCalled();
  });

  it('đọc tuỳ chọn của ĐÚNG tổ chức, trong transaction của bên gọi', async () => {
    const { service, preferences, configs } = build({ telegramEnabled: true });
    const tx = { marker: 'tx' };
    await service.isEnabled('org-b', 'ORDER_CREATED', tx as never);
    expect(configs.isEnabled).toHaveBeenCalledWith('org-b', tx);
    expect(preferences.find).toHaveBeenCalledWith('org-b', tx);
  });
});

describe('NotificationOutboxService.publish', () => {
  it('Fulfill TẮT ⇒ không ghi sự kiện, không đánh thức worker', async () => {
    const { service, events, dispatcher } = build({ telegramEnabled: true, fulfillment: false });
    await service.publish(FULFILL_EVENT);
    expect(events.enqueue).not.toHaveBeenCalled();
    expect(dispatcher.kick).not.toHaveBeenCalled();
  });

  it('Fulfill BẬT ⇒ ghi sự kiện + đánh thức worker', async () => {
    const { service, events, dispatcher } = build({ telegramEnabled: true, fulfillment: true });
    await service.publish(FULFILL_EVENT);
    expect(events.enqueue).toHaveBeenCalledWith([FULFILL_EVENT]);
    expect(dispatcher.kick).toHaveBeenCalled();
  });

  it('ghi trùng (đã có sự kiện) ⇒ không đánh thức worker lần nữa', async () => {
    const { service, events, dispatcher } = build({ telegramEnabled: true });
    events.enqueue.mockResolvedValue(0);
    await service.publish(FULFILL_EVENT);
    expect(dispatcher.kick).not.toHaveBeenCalled();
  });

  it('lỗi DB ⇒ nuốt lỗi (không làm hỏng fulfill)', async () => {
    const { service, events } = build({ telegramEnabled: true });
    events.enqueue.mockRejectedValue(new Error('db down'));
    await expect(service.publish(FULFILL_EVENT)).resolves.toBeUndefined();
  });
});
