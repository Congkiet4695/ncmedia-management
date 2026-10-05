import { ConfigService } from '@nestjs/config';
import { NotificationEvent, NotificationEventStatus, OrganizationTelegramConfig } from '@prisma/client';
import { TelegramApiError, TelegramBotClient } from '../clients/telegram-bot.client';
import { NOTIFICATION_ERROR_CODES } from '../constants/notification.constants';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import type {
  NotificationPreferenceRepository,
  NotificationPreferences,
} from '../repositories/notification-preference.repository';
import { backoffMs, maskChatId, NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationEncryptionService } from './notification-encryption.service';

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000000';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000000';

function event(id: string, organizationId = ORG_A, overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id,
    organizationId,
    eventType: 'ORDER_CREATED',
    entityType: 'POD_ORDER',
    entityId: `${id}-order`,
    channel: 'TELEGRAM',
    status: NotificationEventStatus.PROCESSING,
    payload: {
      tiktokOrderId: `TT-${id}`,
      accountName: 'Acc',
      shopName: null,
      items: [],
      totalAmount: '1',
      currency: 'USD',
      orderCreatedAt: null,
      fulfillmentProvider: null,
      syncSource: 'CRON',
    },
    attemptCount: 0,
    nextAttemptAt: new Date(),
    lockedUntil: new Date(Date.now() + 60_000),
    lockToken: 'lock',
    sentAt: null,
    providerMessageId: null,
    lastErrorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    ...overrides,
  };
}

function telegramConfig(organizationId: string, overrides: Partial<OrganizationTelegramConfig> = {}): OrganizationTelegramConfig {
  return {
    id: `cfg-${organizationId}`,
    organizationId,
    botTokenEnc: `enc:${organizationId}-token`,
    botTokenHint: 'abcd',
    botUsername: null,
    chatId: organizationId === ORG_A ? '-100111' : '-100222',
    enabled: true,
    lastDeliveryOk: null,
    lastDeliveryAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function build(options: {
  claimed: NotificationEvent[];
  configs?: Record<string, OrganizationTelegramConfig | null>;
  encryptionReady?: boolean;
  maxAttempts?: number;
  preferences?: Record<string, NotificationPreferences>;
}) {
  const settings: Record<string, unknown> = {
    'notification.dispatch.batchSize': 50,
    'notification.dispatch.maxAttempts': options.maxAttempts ?? 5,
    'notification.dispatch.leaseMs': 60_000,
    'notification.dispatch.enabled': true,
  };
  const config = { get: (key: string, fallback: unknown) => settings[key] ?? fallback } as unknown as ConfigService;
  const events = {
    claimDue: jest.fn().mockResolvedValueOnce(options.claimed).mockResolvedValue([]),
    beginAttempt: jest.fn().mockResolvedValue(true),
    finish: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const configs = {
    findByOrganization: jest.fn((org: string) =>
      Promise.resolve(options.configs ? (options.configs[org] ?? null) : telegramConfig(org)),
    ),
    findOrganizationName: jest.fn().mockResolvedValue('Org'),
    recordDelivery: jest.fn().mockResolvedValue(undefined),
  };
  const telegram = { sendMessage: jest.fn().mockResolvedValue({ messageId: '99' }) };
  const encryption = {
    isConfigured: () => options.encryptionReady ?? true,
    decrypt: (value: string) => value.replace('enc:', ''),
  };
  const preferences = {
    find: jest.fn((org: string) =>
      Promise.resolve(options.preferences?.[org] ?? { newOrder: true, fulfillment: true }),
    ),
  };
  const service = new NotificationDispatcherService(
    config,
    events as unknown as NotificationEventRepository,
    configs as unknown as TelegramConfigRepository,
    telegram as unknown as TelegramBotClient,
    encryption as unknown as NotificationEncryptionService,
    preferences as unknown as NotificationPreferenceRepository,
  );
  const finishCall = (index: number) =>
    events.finish.mock.calls[index] as [string, string, { status: NotificationEventStatus; nextAttemptAt?: Date; lastErrorCode?: string }];
  return { service, events, configs, telegram, finishCall };
}

describe('NotificationDispatcherService', () => {
  it('TEST 9 — Telegram OK ⇒ SENT + message_id, ghi trạng thái Connected', async () => {
    const { service, events, telegram, configs, finishCall } = build({ claimed: [event('e1')] });

    const summary = await service.runOnce();

    expect(summary.sent).toBe(1);
    expect(events.beginAttempt).toHaveBeenCalledWith('e1', expect.any(String), 60_000);
    expect(telegram.sendMessage).toHaveBeenCalledWith(`${ORG_A}-token`, '-100111', expect.stringContaining('NEW ORDER'));
    expect(finishCall(0)[2]).toMatchObject({ status: 'SENT', providerMessageId: '99' });
    expect(configs.recordDelivery).toHaveBeenCalledWith(ORG_A, expect.anything(), { ok: true });
  });

  it('TEST 16 — cô lập tổ chức: sự kiện của A gửi bằng bot/chat của A, của B bằng của B', async () => {
    const { service, telegram } = build({ claimed: [event('a1', ORG_A), event('b1', ORG_B)] });

    await service.runOnce();

    expect(telegram.sendMessage).toHaveBeenNthCalledWith(1, `${ORG_A}-token`, '-100111', expect.stringContaining('TT-a1'));
    expect(telegram.sendMessage).toHaveBeenNthCalledWith(2, `${ORG_B}-token`, '-100222', expect.stringContaining('TT-b1'));
  });

  it('TEST 17 — tổ chức tắt Telegram ⇒ SKIPPED, không gọi Telegram; tổ chức khác vẫn gửi', async () => {
    const { service, telegram, finishCall } = build({
      claimed: [event('a1', ORG_A), event('b1', ORG_B)],
      configs: { [ORG_A]: telegramConfig(ORG_A, { enabled: false }), [ORG_B]: telegramConfig(ORG_B) },
    });

    await service.runOnce();

    expect(finishCall(0)[2]).toMatchObject({ status: 'SKIPPED', lastErrorCode: NOTIFICATION_ERROR_CODES.DISABLED });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledWith(`${ORG_B}-token`, '-100222', expect.any(String));
  });

  it('TEST 10 — lỗi tạm thời ⇒ PENDING + next_attempt_at theo backoff', async () => {
    const { service, telegram, finishCall } = build({ claimed: [event('e1')] });
    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError(NOTIFICATION_ERROR_CODES.SERVER_ERROR, 'bad gateway', true, 'NOT_DELIVERED', 502),
    );
    const before = Date.now();

    const summary = await service.runOnce();

    expect(summary.retried).toBe(1);
    const result = finishCall(0)[2];
    expect(result.status).toBe('PENDING');
    expect(result.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + backoffMs(1));
  });

  it('🔴 TEST 19 — timeout (không rõ Telegram đã nhận chưa) ⇒ FAILED DELIVERY_UNKNOWN, KHÔNG tự gửi lại', async () => {
    const { service, telegram, finishCall } = build({ claimed: [event('e1')] });
    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError(NOTIFICATION_ERROR_CODES.TIMEOUT, 'timeout', true, 'UNKNOWN'),
    );
    await service.runOnce();
    expect(finishCall(0)[2]).toMatchObject({
      status: 'FAILED',
      lastErrorCode: NOTIFICATION_ERROR_CODES.DELIVERY_UNKNOWN,
    });
    expect(finishCall(0)[2].nextAttemptAt).toBeUndefined();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('timeout khi KẾT NỐI (chắc chắn chưa tới Telegram) ⇒ vẫn retry bình thường', async () => {
    const { service, telegram, finishCall } = build({ claimed: [event('e1')] });
    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError(NOTIFICATION_ERROR_CODES.NETWORK, 'connect timeout', true, 'NOT_DELIVERED'),
    );
    await service.runOnce();
    expect(finishCall(0)[2]).toMatchObject({ status: 'PENDING', lastErrorCode: NOTIFICATION_ERROR_CODES.NETWORK });
  });

  it('🔴 Telegram ĐÃ nhận tin nhưng ghi SENT hỏng ⇒ thử ghi lại SENT, KHÔNG BAO GIỜ đổi sang PENDING / gửi lại', async () => {
    const { service, telegram, events } = build({ claimed: [event('e1')] });
    telegram.sendMessage.mockResolvedValue({ messageId: '42' });
    events.finish.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValueOnce(true);

    await service.runOnce();

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const results = (events.finish.mock.calls as Array<[string, string, { status: string }]>).map((call) => call[2].status);
    expect(results).toEqual(['SENT', 'SENT']);
  });

  it('🔴 worker chết giữa lúc gửi (claim lại sự kiện còn dấu IN_FLIGHT) ⇒ DELIVERY_UNKNOWN, KHÔNG gọi Telegram', async () => {
    const { service, telegram, events, finishCall } = build({
      claimed: [event('e1', ORG_A, { attemptCount: 1, lastErrorCode: NOTIFICATION_ERROR_CODES.IN_FLIGHT })],
    });

    await service.runOnce();

    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(events.beginAttempt).not.toHaveBeenCalled();
    expect(finishCall(0)[2]).toMatchObject({ status: 'FAILED', lastErrorCode: NOTIFICATION_ERROR_CODES.DELIVERY_UNKNOWN });
  });

  it('retry sau lỗi CHẮC CHẮN chưa gửi (5xx) ⇒ CÙNG sự kiện được gửi lại, không sinh sự kiện mới', async () => {
    const { service, telegram, events } = build({
      claimed: [event('e1', ORG_A, { attemptCount: 1, lastErrorCode: NOTIFICATION_ERROR_CODES.SERVER_ERROR })],
    });
    telegram.sendMessage.mockResolvedValue({ messageId: '9' });

    await service.runOnce();

    expect(events.beginAttempt).toHaveBeenCalledWith('e1', expect.any(String), expect.any(Number));
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('TEST 11 — hết số lần thử ⇒ FAILED (không retry vô hạn)', async () => {
    const { service, telegram, finishCall } = build({ claimed: [event('e1', ORG_A, { attemptCount: 4 })], maxAttempts: 5 });
    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError(NOTIFICATION_ERROR_CODES.NETWORK, 'dns', true, 'NOT_DELIVERED'),
    );
    await service.runOnce();
    expect(finishCall(0)[2]).toMatchObject({ status: 'FAILED', lastErrorCode: NOTIFICATION_ERROR_CODES.NETWORK });
  });

  it('429 ⇒ hẹn lại đúng retry_after; sự kiện kế tiếp CÙNG chat bị hoãn mà không gọi Telegram', async () => {
    const { service, telegram, events, finishCall } = build({ claimed: [event('e1'), event('e2'), event('b1', ORG_B)] });
    telegram.sendMessage
      .mockRejectedValueOnce(
        new TelegramApiError(NOTIFICATION_ERROR_CODES.RATE_LIMITED, '429', true, 'NOT_DELIVERED', 429, 30),
      )
      .mockResolvedValueOnce({ messageId: '7' });
    const before = Date.now();

    const summary = await service.runOnce();

    expect(finishCall(0)[2].nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect(events.release).toHaveBeenCalledWith('e2', expect.any(String), expect.any(Date), expect.any(String));
    // Chat của B không bị ảnh hưởng.
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(summary.deferred).toBe(1);
  });

  it('TEST 18 — token sai ⇒ FAILED, các sự kiện còn lại của tổ chức KHÔNG gọi Telegram nữa, ghi Disconnected', async () => {
    const { service, telegram, configs, finishCall } = build({ claimed: [event('e1'), event('e2')] });
    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError(NOTIFICATION_ERROR_CODES.INVALID_TOKEN, 'Unauthorized', false, 'NOT_DELIVERED', 401),
    );

    await service.runOnce();

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(finishCall(0)[2]).toMatchObject({ status: 'FAILED', lastErrorCode: NOTIFICATION_ERROR_CODES.INVALID_TOKEN });
    expect(finishCall(1)[2]).toMatchObject({ status: 'FAILED', lastErrorCode: NOTIFICATION_ERROR_CODES.INVALID_TOKEN });
    expect(configs.recordDelivery).toHaveBeenCalledWith(ORG_A, expect.anything(), expect.objectContaining({ ok: false }));
  });

  it('TEST 7/8 — mất lease trước khi gửi (worker khác đã nhận lại) ⇒ KHÔNG gửi', async () => {
    const { service, telegram, events } = build({ claimed: [event('e1')] });
    events.beginAttempt.mockResolvedValue(false);

    await service.runOnce();

    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(events.finish).not.toHaveBeenCalled();
  });

  it('sự kiện được nhận lại sau khi worker chết nhưng đã hết lượt ⇒ FAILED, không gửi thêm', async () => {
    const { service, telegram, finishCall } = build({
      claimed: [event('e1', ORG_A, { attemptCount: 5, lastErrorCode: NOTIFICATION_ERROR_CODES.TIMEOUT })],
    });
    await service.runOnce();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(finishCall(0)[2].status).toBe('FAILED');
  });

  it('máy chủ thiếu NOTIFICATION_ENCRYPTION_KEY ⇒ FAILED với mã rõ ràng', async () => {
    const { service, telegram, finishCall } = build({ claimed: [event('e1')], encryptionReady: false });
    await service.runOnce();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(finishCall(0)[2]).toMatchObject({
      status: 'FAILED',
      lastErrorCode: NOTIFICATION_ERROR_CODES.ENCRYPTION_KEY_MISSING,
    });
  });

  it('payload hỏng ⇒ FAILED INVALID_PAYLOAD, không gửi', async () => {
    const { service, telegram, finishCall } = build({ claimed: [event('e1', ORG_A, { payload: {} })] });
    await service.runOnce();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(finishCall(0)[2].lastErrorCode).toBe(NOTIFICATION_ERROR_CODES.INVALID_PAYLOAD);
  });

  it('hai lượt chồng nhau trong cùng tiến trình ⇒ lượt sau không claim song song', async () => {
    const { service, events } = build({ claimed: [event('e1')] });
    await Promise.all([service.runOnce(), service.runOnce()]);
    // Lượt 1: claim lô có dữ liệu + claim rỗng để dừng. Lượt 2 chỉ đặt cờ chạy lại, không claim.
    expect(events.claimDue.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('lỗi DB khi claim ⇒ runOnce không ném lỗi (scheduler không chết)', async () => {
    const { service, events } = build({ claimed: [] });
    events.claimDue.mockReset().mockRejectedValue(new Error('db down'));
    await expect(service.runOnce()).resolves.toMatchObject({ claimed: 0 });
  });
});

describe('helpers', () => {
  it('backoffMs tăng gấp đôi và có trần', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
  });

  it('maskChatId không lộ toàn bộ Chat ID', () => {
    expect(maskChatId('-1001234567890')).toBe('-100******7890');
    expect(maskChatId('@abc')).toBe('***bc');
    expect(maskChatId(null)).toBeUndefined();
  });
});

describe('NotificationDispatcherService — tuỳ chọn loại thông báo (kiểm LÚC GỬI)', () => {
  const fulfillEvent = (id: string, org = ORG_A) =>
    event(id, org, {
      eventType: 'FULFILLMENT_SUBMITTED',
      entityType: 'FULFILLMENT_ORDER',
      payload: {
        tiktokOrderId: `TT-${id}`,
        accountName: 'Acc',
        items: [],
        provider: 'MangoTeePrints',
        fulfilledBy: null,
        providerOrderId: 'MG-1',
        externalOrderId: 'NC-1',
        baseCost: null,
        baseCostConfirmed: false,
        currency: null,
        trackingNumber: null,
        productionLine: null,
        shippingMethod: null,
        fulfilledAt: null,
      },
    });

  it('New Order TẮT ⇒ sự kiện NEW ORDER đã ghi trước đó bị SKIPPED, không gọi Telegram; Fulfill vẫn gửi', async () => {
    const { service, telegram, finishCall } = build({
      claimed: [event('o1'), fulfillEvent('f1')],
      preferences: { [ORG_A]: { newOrder: false, fulfillment: true } },
    });

    await service.runOnce();

    expect(finishCall(0)[2]).toMatchObject({ status: 'SKIPPED', lastErrorCode: NOTIFICATION_ERROR_CODES.CATEGORY_DISABLED });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect((telegram.sendMessage.mock.calls as string[][])[0][2]).toContain('FULFILL SUCCESS');
  });

  it('Fulfill TẮT ⇒ chỉ NEW ORDER được gửi', async () => {
    const { service, telegram, finishCall } = build({
      claimed: [event('o1'), fulfillEvent('f1')],
      preferences: { [ORG_A]: { newOrder: true, fulfillment: false } },
    });
    await service.runOnce();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect((telegram.sendMessage.mock.calls as string[][])[0][2]).toContain('NEW ORDER');
    expect(finishCall(1)[2].status).toBe('SKIPPED');
  });

  it('Cả hai TẮT ⇒ không gọi Telegram', async () => {
    const { service, telegram } = build({
      claimed: [event('o1'), fulfillEvent('f1')],
      preferences: { [ORG_A]: { newOrder: false, fulfillment: false } },
    });
    await service.runOnce();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('tuỳ chọn RIÊNG từng tổ chức: A tắt New Order không ảnh hưởng B', async () => {
    const { service, telegram } = build({
      claimed: [event('a1', ORG_A), event('b1', ORG_B)],
      preferences: { [ORG_A]: { newOrder: false, fulfillment: true } },
    });
    await service.runOnce();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect((telegram.sendMessage.mock.calls as string[][])[0][0]).toBe(`${ORG_B}-token`);
  });
});
