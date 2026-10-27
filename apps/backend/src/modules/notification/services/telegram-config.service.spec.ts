import { ConfigService } from '@nestjs/config';
import { OrganizationTelegramConfig } from '@prisma/client';
import { RedisService } from '../../../redis/redis.service';
import { TelegramApiError, TelegramBotClient } from '../clients/telegram-bot.client';
import { NOTIFICATION_ERROR_CODES } from '../constants/notification.constants';
import { TelegramIntegrationStatus } from '../dto/notification.dto';
import {
  NotificationEventNotRetryableException,
  TelegramBotTokenRequiredException,
  TelegramTestRateLimitedException,
} from '../exceptions/notification.exceptions';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import type { NotificationPreferenceRepository } from '../repositories/notification-preference.repository';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationEncryptionService } from './notification-encryption.service';
import { TelegramConfigService } from './telegram-config.service';

const ORG = 'org-1';
/** Kênh TỔ CHỨC (Admin) — chủ sở hữu mà controller dựng từ JWT. */
const OWNER = { organizationId: ORG, userId: null };
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawWXYZ';

function saved(overrides: Partial<OrganizationTelegramConfig> = {}): OrganizationTelegramConfig {
  return {
    id: 'cfg',
    organizationId: ORG,
    ownerKey: 'ORGANIZATION',
    userId: null,
    botTokenEnc: `enc:${TOKEN}`,
    botTokenHint: 'WXYZ',
    botUsername: 'nc_bot',
    chatId: '-100111',
    enabled: true,
    lastDeliveryOk: true,
    lastDeliveryAt: new Date(),
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

function build(existing: OrganizationTelegramConfig | null = saved()) {
  const configs = {
    findByOwner: jest.fn().mockResolvedValue(existing),
    findOrganizationName: jest.fn().mockResolvedValue('HN Media'),
    create: jest.fn((_org: string, _actor: string, data: Record<string, unknown>) =>
      Promise.resolve({ ...saved(), ...data, lastDeliveryOk: null }),
    ),
    update: jest.fn((_org: string, _actor: string, data: Record<string, unknown>) =>
      Promise.resolve(existing ? { ...existing, ...data } : null),
    ),
    recordDelivery: jest.fn().mockResolvedValue(undefined),
    softDelete: jest.fn().mockResolvedValue(true),
  };
  const events = {
    findStatus: jest.fn(),
    requeue: jest.fn(),
    requeueAllFailed: jest.fn(),
    list: jest.fn(),
  };
  const encryption = {
    isConfigured: () => true,
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace('enc:', ''),
  };
  const telegram = {
    getMe: jest.fn().mockResolvedValue({ id: 1, username: 'nc_bot' }),
    sendMessage: jest.fn().mockResolvedValue({ messageId: '1' }),
  };
  const dispatcher = { kick: jest.fn() };
  let counter = 0;
  const redis = { client: { incr: jest.fn(() => Promise.resolve(++counter)), expire: jest.fn() } };
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  const preferences = {
    find: jest.fn().mockResolvedValue({ newOrder: true, fulfillment: true, returnRefund: false }),
    save: jest.fn((_org: string, _actor: string, value: unknown) => Promise.resolve(value)),
  };
  const service = new TelegramConfigService(
    configs as unknown as TelegramConfigRepository,
    events as unknown as NotificationEventRepository,
    encryption as unknown as NotificationEncryptionService,
    telegram as unknown as TelegramBotClient,
    dispatcher as unknown as NotificationDispatcherService,
    redis as unknown as RedisService,
    config,
    preferences as unknown as NotificationPreferenceRepository,
  );
  return { service, configs, events, telegram, dispatcher, preferences, redis };
}

describe('TelegramConfigService', () => {
  it('GET không bao giờ trả Bot Token — chỉ bản che 4 ký tự cuối', async () => {
    const { service } = build();
    const dto = await service.get(OWNER);
    expect(JSON.stringify(dto)).not.toContain(TOKEN);
    expect(JSON.stringify(dto)).not.toContain('enc:');
    expect(dto.botTokenMasked).toBe('••••••••WXYZ');
    expect(dto.status).toBe(TelegramIntegrationStatus.CONNECTED);
  });

  it('trạng thái: tắt ⇒ DISABLED; lỗi gần nhất ⇒ DISCONNECTED; chưa có ⇒ NOT_CONFIGURED', async () => {
    expect((await build(saved({ enabled: false })).service.get(OWNER)).status).toBe('DISABLED');
    expect((await build(saved({ lastDeliveryOk: false })).service.get(OWNER)).status).toBe('DISCONNECTED');
    expect((await build(saved({ lastDeliveryOk: null })).service.get(OWNER)).status).toBe('UNTESTED');
    expect((await build(null).service.get(OWNER)).status).toBe('NOT_CONFIGURED');
  });

  it('cấu hình lần đầu thiếu token ⇒ lỗi TELEGRAM_BOT_TOKEN_REQUIRED', async () => {
    const { service, configs } = build(null);
    await expect(service.save(OWNER, 'admin', { chatId: '-100', enabled: true })).rejects.toBeInstanceOf(
      TelegramBotTokenRequiredException,
    );
    expect(configs.create).not.toHaveBeenCalled();
  });

  it('cấu hình lần đầu có token ⇒ create với bản mã hoá', async () => {
    const { service, configs } = build(null);
    await service.save(OWNER, 'admin', { botToken: TOKEN, chatId: '-100', enabled: true });
    expect(configs.create).toHaveBeenCalledWith(OWNER, 'admin', {
      botTokenEnc: `enc:${TOKEN}`,
      botTokenHint: 'WXYZ',
      chatId: '-100',
      enabled: true,
    });
  });

  it('chỉ đổi Chat ID ⇒ KHÔNG ghi đè token; kết quả gửi cũ bị xoá', async () => {
    const { service, configs } = build();
    await service.save(OWNER, 'admin', { chatId: '-100999', enabled: true });
    expect(configs.create).not.toHaveBeenCalled();
    const update = configs.update.mock.calls[0][2];
    expect(update).not.toHaveProperty('botTokenEnc');
    expect(update).toMatchObject({ chatId: '-100999', lastDeliveryOk: null });
  });

  it('đổi token ⇒ lưu bản MÃ HOÁ, không lưu plaintext', async () => {
    const { service, configs } = build();
    const newToken = '987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsawNEWT';
    await service.save(OWNER, 'admin', { botToken: newToken, chatId: '-100111', enabled: true });
    const update = configs.update.mock.calls[0][2];
    expect(update.botTokenEnc).toBe(`enc:${newToken}`);
    expect(update.botTokenHint).toBe('NEWT');
    expect(Object.values(update)).not.toContain(newToken);
  });

  it('gửi thử thành công với cấu hình đã lưu ⇒ success + ghi Connected', async () => {
    const { service, telegram, configs } = build();
    const result = await service.test(OWNER, {});
    expect(result).toMatchObject({ success: true, botUsername: 'nc_bot' });
    expect(telegram.sendMessage).toHaveBeenCalledWith(TOKEN, '-100111', expect.stringContaining('successful'));
    expect(configs.recordDelivery).toHaveBeenCalledWith(OWNER, expect.anything(), expect.objectContaining({ ok: true }));
  });

  it('gửi thử lỗi (bot chưa vào group) ⇒ success=false + nguyên nhân, không ném 500', async () => {
    const { service, telegram } = build();
    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError(NOTIFICATION_ERROR_CODES.CHAT_NOT_FOUND, 'chat not found', false, 'NOT_DELIVERED', 400),
    );
    const result = await service.test(OWNER, {});
    expect(result).toMatchObject({ success: false, errorCode: NOTIFICATION_ERROR_CODES.CHAT_NOT_FOUND });
  });

  it('gửi thử với giá trị CHƯA lưu ⇒ không ghi đè trạng thái kết nối của cấu hình đã lưu', async () => {
    const { service, configs, telegram } = build();
    await service.test(OWNER, { chatId: '-100555' });
    expect(telegram.sendMessage).toHaveBeenCalledWith(TOKEN, '-100555', expect.any(String));
    expect(configs.recordDelivery).not.toHaveBeenCalled();
  });

  it('gửi thử quá 5 lần / phút ⇒ 429', async () => {
    const { service } = build();
    for (let i = 0; i < 5; i += 1) await service.test(OWNER, {});
    await expect(service.test(OWNER, {})).rejects.toBeInstanceOf(TelegramTestRateLimitedException);
  });

  it('gửi lại sự kiện đã SENT ⇒ 409, không xếp hàng lại', async () => {
    const { service, events, dispatcher } = build();
    events.findStatus.mockResolvedValue({ status: 'SENT' });
    events.requeue.mockResolvedValue(false);
    await expect(service.retryEvent(OWNER, 'e1')).rejects.toBeInstanceOf(NotificationEventNotRetryableException);
    expect(dispatcher.kick).not.toHaveBeenCalled();
  });
});

describe('TelegramConfigService — tuỳ chọn loại thông báo', () => {
  it('đọc / lưu theo ĐÚNG tổ chức của người gọi', async () => {
    const { service, preferences } = build();
    await service.getPreferences(OWNER);
    expect(preferences.find).toHaveBeenCalledWith(OWNER);

    const saved = await service.savePreferences(OWNER, 'admin', { newOrder: false, fulfillment: true });
    // Client cũ không gửi returnRefund ⇒ GIỮ giá trị đang lưu (false), không tự bật lại.
    expect(preferences.save).toHaveBeenCalledWith(OWNER, 'admin', { newOrder: false, fulfillment: true, returnRefund: false });
    expect(saved).toEqual({ newOrder: false, fulfillment: true, returnRefund: false });
  });

  it('gửi returnRefund tường minh ⇒ lưu đúng giá trị đó', async () => {
    const { service, preferences } = build();
    await service.savePreferences(OWNER, 'admin', { newOrder: true, fulfillment: true, returnRefund: true });
    expect(preferences.save).toHaveBeenCalledWith(OWNER, 'admin', { newOrder: true, fulfillment: true, returnRefund: true });
  });

  it('lưu được cả khi tổ chức CHƯA cấu hình Telegram', async () => {
    const { service, preferences } = build(null);
    await expect(service.savePreferences(OWNER, 'admin', { newOrder: true, fulfillment: false })).resolves.toEqual({
      newOrder: true,
      fulfillment: false,
      returnRefund: false,
    });
    expect(preferences.save).toHaveBeenCalled();
  });
});

describe('TelegramConfigService — kênh CÁ NHÂN', () => {
  const ME = { organizationId: ORG, userId: 'user-emp-1' };

  it('mọi thao tác đi với ĐÚNG chủ sở hữu (tổ chức + người dùng) — không chạm kênh của tổ chức', async () => {
    const { service, configs, events, preferences } = build(null);
    await service.save(ME, 'user-emp-1', { botToken: TOKEN, chatId: '-100', enabled: true });
    expect(configs.findByOwner).toHaveBeenCalledWith(ME);
    expect(configs.create).toHaveBeenCalledWith(ME, 'user-emp-1', expect.objectContaining({ chatId: '-100' }));

    events.list.mockResolvedValue([[], 0]);
    await service.listEvents(ME, {});
    expect(events.list).toHaveBeenCalledWith(ME, expect.anything(), 1, 20);

    await service.getPreferences(ME);
    expect(preferences.find).toHaveBeenCalledWith(ME);
  });

  it('gửi lại chỉ tìm sự kiện trong kênh của CHÍNH người đó (id của người khác ⇒ 404)', async () => {
    const { service, events } = build();
    events.findStatus.mockResolvedValue(null);
    await expect(service.retryEvent(ME, 'event-of-someone-else')).rejects.toThrow();
    expect(events.findStatus).toHaveBeenCalledWith(ME, 'event-of-someone-else');
    expect(events.requeue).not.toHaveBeenCalled();
  });

  it('giới hạn gửi thử tính RIÊNG từng kênh (Employee bấm thử không ăn hạn mức của Admin)', async () => {
    const { service, redis } = build();
    await service.test(ME, {});
    await service.test(OWNER, {});
    const keys = (redis.client.incr.mock.calls as unknown as string[][]).map((call) => call[0]);
    expect(keys[0]).toContain('user-emp-1');
    expect(keys[1]).toContain('ORGANIZATION');
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('tin gửi thử của kênh cá nhân nói rõ phạm vi: chỉ đơn của shop được gán', async () => {
    const { service, telegram } = build();
    await service.test(ME, {});
    expect((telegram.sendMessage.mock.calls as string[][])[0][2]).toContain('shop đang được gán cho bạn');
  });
});
