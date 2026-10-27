import type { NotificationEventRepository } from '../repositories/notification-event.repository';
import type {
  NotificationPreferenceRepository,
  NotificationPreferences,
} from '../repositories/notification-preference.repository';
import type { NotificationRecipientRepository } from '../repositories/notification-recipient.repository';
import type { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import type { NotificationOwner } from '../types/notification-owner';
import type { NotificationEventInput, NotificationEventRow } from '../types/notification-payload.types';
import type { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationOutboxService } from './notification-outbox.service';

const EMP_1 = 'user-emp-1';
const EMP_2 = 'user-emp-2';
const ACC_1 = 'acc-1';
const ACC_2 = 'acc-2';

const ALL_ON: NotificationPreferences = { newOrder: true, fulfillment: true, returnRefund: true };

/**
 * @param telegramEnabled   kênh TỔ CHỨC đang bật
 * @param personal          người dùng có kênh CÁ NHÂN đang bật
 * @param assigned          TikTok Account → người dùng ĐANG được gán (giả lập NotificationRecipientRepository)
 */
function build(options: {
  telegramEnabled: boolean;
  newOrder?: boolean;
  fulfillment?: boolean;
  personal?: string[];
  personalPreferences?: Record<string, NotificationPreferences>;
  assigned?: Record<string, string[]>;
}) {
  const events = { enqueue: jest.fn().mockResolvedValue(1) };
  const configs = {
    isEnabled: jest.fn().mockResolvedValue(options.telegramEnabled),
    enabledPersonalUserIds: jest.fn().mockResolvedValue(options.personal ?? []),
  };
  const dispatcher = { kick: jest.fn() };
  const preferences = {
    find: jest.fn().mockResolvedValue({ newOrder: options.newOrder ?? true, fulfillment: options.fulfillment ?? true, returnRefund: true }),
    findForUsers: jest.fn((_org: string, userIds: string[]) =>
      Promise.resolve(new Map(userIds.map((userId) => [userId, options.personalPreferences?.[userId] ?? ALL_ON]))),
    ),
  };
  const recipients = {
    allowedUserIds: jest.fn((params: { accountId: string | null; userIds: string[] }) =>
      Promise.resolve(
        new Set(params.userIds.filter((userId) => (options.assigned?.[params.accountId ?? ''] ?? []).includes(userId))),
      ),
    ),
  };
  const service = new NotificationOutboxService(
    events as unknown as NotificationEventRepository,
    configs as unknown as TelegramConfigRepository,
    dispatcher as unknown as NotificationDispatcherService,
    preferences as unknown as NotificationPreferenceRepository,
    recipients as unknown as NotificationRecipientRepository,
  );
  const enqueued = (call = 0) => (events.enqueue.mock.calls[call] as [NotificationEventRow[]])[0];
  return { service, events, configs, dispatcher, preferences, recipients, enqueued };
}

function orderEvent(entityId: string, accountId: string | null): NotificationEventInput {
  return {
    organizationId: 'org-a',
    eventType: 'ORDER_CREATED',
    entityType: 'POD_ORDER',
    entityId,
    scope: { accountId, shopId: accountId ? `shop-of-${accountId}` : null },
    payload: {} as never,
  };
}

const FULFILL_EVENT = {
  organizationId: 'org-a',
  eventType: 'FULFILLMENT_SUBMITTED',
  entityType: 'FULFILLMENT_ORDER',
  entityId: 'fo-1',
  scope: { accountId: ACC_1, shopId: 'shop-1' },
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

  it('chưa cấu hình bot của tổ chức ⇒ không cần đọc tuỳ chọn của tổ chức', async () => {
    const { service, preferences } = build({ telegramEnabled: false });
    await service.isEnabled('org-a', 'ORDER_CREATED');
    expect(preferences.find).not.toHaveBeenCalled();
  });

  it('đọc cấu hình + tuỳ chọn của ĐÚNG kênh tổ chức, trong transaction của bên gọi', async () => {
    const { service, preferences, configs } = build({ telegramEnabled: true });
    const tx = { marker: 'tx' };
    await service.isEnabled('org-b', 'ORDER_CREATED', tx as never);
    const owner: NotificationOwner = { organizationId: 'org-b', userId: null };
    expect(configs.isEnabled).toHaveBeenCalledWith(owner, tx);
    expect(preferences.find).toHaveBeenCalledWith(owner, tx);
  });

  it('tổ chức KHÔNG bật nhưng có kênh cá nhân đang bật ⇒ vẫn ghi (để chọn người nhận cá nhân)', async () => {
    const { service } = build({ telegramEnabled: false, personal: [EMP_1] });
    await expect(service.isEnabled('org-a', 'ORDER_CREATED')).resolves.toBe(true);
  });
});

describe('NotificationOutboxService — chọn NGƯỜI NHẬN (fan-out theo phân công shop)', () => {
  it('chỉ kênh tổ chức (như trước) ⇒ đúng MỘT dòng, recipient = tổ chức', async () => {
    const { service, enqueued } = build({ telegramEnabled: true });
    await service.enqueueInTransaction({} as never, [orderEvent('o1', ACC_1)]);
    expect(enqueued().map((row) => row.recipientUserId)).toEqual([null]);
  });

  it('🔴 Employee chỉ nhận đơn của shop ĐƯỢC GÁN: đơn ACC_1 ⇒ EMP_1; đơn ACC_2 ⇒ EMP_2', async () => {
    const { service, enqueued } = build({
      telegramEnabled: true,
      personal: [EMP_1, EMP_2],
      assigned: { [ACC_1]: [EMP_1], [ACC_2]: [EMP_2] },
    });
    await service.enqueueInTransaction({} as never, [orderEvent('o1', ACC_1), orderEvent('o2', ACC_2)]);
    const rows = enqueued().map((row) => `${row.entityId}→${row.recipientUserId ?? 'ORG'}`);
    expect(rows).toEqual(['o1→ORG', `o1→${EMP_1}`, 'o2→ORG', `o2→${EMP_2}`]);
  });

  it('Employee được gán NHIỀU shop ⇒ nhận đơn của từng shop đó', async () => {
    const { service, enqueued } = build({
      telegramEnabled: false,
      personal: [EMP_1],
      assigned: { [ACC_1]: [EMP_1], [ACC_2]: [EMP_1] },
    });
    await service.enqueueInTransaction({} as never, [orderEvent('o1', ACC_1), orderEvent('o2', ACC_2)]);
    expect(enqueued().map((row) => [row.entityId, row.recipientUserId])).toEqual([
      ['o1', EMP_1],
      ['o2', EMP_1],
    ]);
  });

  it('🔴 Employee KHÔNG được gán shop nào ⇒ không có dòng nào cho người đó', async () => {
    const { service, enqueued } = build({ telegramEnabled: false, personal: [EMP_1], assigned: {} });
    await service.enqueueInTransaction({} as never, [orderEvent('o1', ACC_1)]);
    expect(enqueued()).toEqual([]);
  });

  it('🔴 đơn không xác định được Account (dữ liệu thiếu) ⇒ mặc định TỪ CHỐI kênh cá nhân', async () => {
    const { service, enqueued } = build({ telegramEnabled: true, personal: [EMP_1], assigned: { [ACC_1]: [EMP_1] } });
    await service.enqueueInTransaction({} as never, [orderEvent('o1', null)]);
    expect(enqueued().map((row) => row.recipientUserId)).toEqual([null]);
  });

  it('phạm vi lấy từ CHÍNH sự kiện (Account của đơn) và hỏi đúng loại thông báo, trong tx của bên gọi', async () => {
    const { service, recipients } = build({ telegramEnabled: false, personal: [EMP_1], assigned: { [ACC_1]: [EMP_1] } });
    const tx = { marker: 'tx' };
    await service.enqueueInTransaction(tx as never, [orderEvent('o1', ACC_1)]);
    expect(recipients.allowedUserIds).toHaveBeenCalledWith(
      { organizationId: 'org-a', eventType: 'ORDER_CREATED', accountId: ACC_1, userIds: [EMP_1] },
      tx,
    );
  });

  it('tuỳ chọn RIÊNG của kênh cá nhân: EMP_1 tắt New Order ⇒ không nhận, EMP_2 vẫn nhận', async () => {
    const { service, enqueued } = build({
      telegramEnabled: false,
      personal: [EMP_1, EMP_2],
      personalPreferences: { [EMP_1]: { newOrder: false, fulfillment: true, returnRefund: true } },
      assigned: { [ACC_1]: [EMP_1, EMP_2] },
    });
    await service.enqueueInTransaction({} as never, [orderEvent('o1', ACC_1)]);
    expect(enqueued().map((row) => row.recipientUserId)).toEqual([EMP_2]);
  });

  it('dòng của mỗi người nhận mang phạm vi của đơn (để worker kiểm LẠI lúc gửi)', async () => {
    const { service, enqueued } = build({ telegramEnabled: false, personal: [EMP_1], assigned: { [ACC_1]: [EMP_1] } });
    await service.enqueueInTransaction({} as never, [orderEvent('o1', ACC_1)]);
    expect(enqueued()[0].scope).toEqual({ accountId: ACC_1, shopId: `shop-of-${ACC_1}` });
  });
});

describe('NotificationOutboxService.publish', () => {
  it('Fulfill TẮT (và không có kênh cá nhân) ⇒ không ghi sự kiện, không đánh thức worker', async () => {
    const { service, events, dispatcher } = build({ telegramEnabled: true, fulfillment: false });
    await service.publish(FULFILL_EVENT);
    expect(events.enqueue).not.toHaveBeenCalled();
    expect(dispatcher.kick).not.toHaveBeenCalled();
  });

  it('Fulfill BẬT ⇒ ghi sự kiện cho kênh tổ chức + đánh thức worker', async () => {
    const { service, enqueued, dispatcher } = build({ telegramEnabled: true, fulfillment: true });
    await service.publish(FULFILL_EVENT);
    expect(enqueued()).toEqual([{ ...FULFILL_EVENT, recipientUserId: null }]);
    expect(dispatcher.kick).toHaveBeenCalled();
  });

  it('Fulfill: Employee được gán shop của đơn nhận thêm MỘT dòng riêng', async () => {
    const { service, enqueued } = build({ telegramEnabled: true, personal: [EMP_1], assigned: { [ACC_1]: [EMP_1] } });
    await service.publish(FULFILL_EVENT);
    expect(enqueued().map((row) => row.recipientUserId)).toEqual([null, EMP_1]);
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
