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
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawWXYZ';

function saved(overrides: Partial<OrganizationTelegramConfig> = {}): OrganizationTelegramConfig {
  return {
    id: 'cfg',
    organizationId: ORG,
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
    findByOrganization: jest.fn().mockResolvedValue(existing),
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
    find: jest.fn().mockResolvedValue({ newOrder: true, fulfillment: true }),
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
  return { service, configs, events, telegram, dispatcher, preferences };
}

describe('TelegramConfigService', () => {
  it('GET không bao giờ trả Bot Token — chỉ bản che 4 ký tự cuối', async () => {
    const { service } = build();
    const dto = await service.get(ORG);
    expect(JSON.stringify(dto)).not.toContain(TOKEN);
    expect(JSON.stringify(dto)).not.toContain('enc:');
    expect(dto.botTokenMasked).toBe('••••••••WXYZ');
    expect(dto.status).toBe(TelegramIntegrationStatus.CONNECTED);
  });

  it('trạng thái: tắt ⇒ DISABLED; lỗi gần nhất ⇒ DISCONNECTED; chưa có ⇒ NOT_CONFIGURED', async () => {
    expect((await build(saved({ enabled: false })).service.get(ORG)).status).toBe('DISABLED');
    expect((await build(saved({ lastDeliveryOk: false })).service.get(ORG)).status).toBe('DISCONNECTED');
    expect((await build(saved({ lastDeliveryOk: null })).service.get(ORG)).status).toBe('UNTESTED');
    expect((await build(null).service.get(ORG)).status).toBe('NOT_CONFIGURED');
  });

  it('cấu hình lần đầu thiếu token ⇒ lỗi TELEGRAM_BOT_TOKEN_REQUIRED', async () => {
    const { service, configs } = build(null);
    await expect(service.save(ORG, 'admin', { chatId: '-100', enabled: true })).rejects.toBeInstanceOf(
      TelegramBotTokenRequiredException,
    );
    expect(configs.create).not.toHaveBeenCalled();
  });

  it('cấu hình lần đầu có token ⇒ create với bản mã hoá', async () => {
    const { service, configs } = build(null);
    await service.save(ORG, 'admin', { botToken: TOKEN, chatId: '-100', enabled: true });
    expect(configs.create).toHaveBeenCalledWith(ORG, 'admin', {
      botTokenEnc: `enc:${TOKEN}`,
      botTokenHint: 'WXYZ',
      chatId: '-100',
      enabled: true,
    });
  });

  it('chỉ đổi Chat ID ⇒ KHÔNG ghi đè token; kết quả gửi cũ bị xoá', async () => {
    const { service, configs } = build();
    await service.save(ORG, 'admin', { chatId: '-100999', enabled: true });
    expect(configs.create).not.toHaveBeenCalled();
    const update = configs.update.mock.calls[0][2];
    expect(update).not.toHaveProperty('botTokenEnc');
    expect(update).toMatchObject({ chatId: '-100999', lastDeliveryOk: null });
  });

  it('đổi token ⇒ lưu bản MÃ HOÁ, không lưu plaintext', async () => {
    const { service, configs } = build();
    const newToken = '987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsawNEWT';
    await service.save(ORG, 'admin', { botToken: newToken, chatId: '-100111', enabled: true });
    const update = configs.update.mock.calls[0][2];
    expect(update.botTokenEnc).toBe(`enc:${newToken}`);
    expect(update.botTokenHint).toBe('NEWT');
    expect(Object.values(update)).not.toContain(newToken);
  });

  it('gửi thử thành công với cấu hình đã lưu ⇒ success + ghi Connected', async () => {
    const { service, telegram, configs } = build();
    const result = await service.test(ORG, {});
    expect(result).toMatchObject({ success: true, botUsername: 'nc_bot' });
    expect(telegram.sendMessage).toHaveBeenCalledWith(TOKEN, '-100111', expect.stringContaining('successful'));
    expect(configs.recordDelivery).toHaveBeenCalledWith(ORG, expect.anything(), expect.objectContaining({ ok: true }));
  });

  it('gửi thử lỗi (bot chưa vào group) ⇒ success=false + nguyên nhân, không ném 500', async () => {
    const { service, telegram } = build();
    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError(NOTIFICATION_ERROR_CODES.CHAT_NOT_FOUND, 'chat not found', false, 'NOT_DELIVERED', 400),
    );
    const result = await service.test(ORG, {});
    expect(result).toMatchObject({ success: false, errorCode: NOTIFICATION_ERROR_CODES.CHAT_NOT_FOUND });
  });

  it('gửi thử với giá trị CHƯA lưu ⇒ không ghi đè trạng thái kết nối của cấu hình đã lưu', async () => {
    const { service, configs, telegram } = build();
    await service.test(ORG, { chatId: '-100555' });
    expect(telegram.sendMessage).toHaveBeenCalledWith(TOKEN, '-100555', expect.any(String));
    expect(configs.recordDelivery).not.toHaveBeenCalled();
  });

  it('gửi thử quá 5 lần / phút ⇒ 429', async () => {
    const { service } = build();
    for (let i = 0; i < 5; i += 1) await service.test(ORG, {});
    await expect(service.test(ORG, {})).rejects.toBeInstanceOf(TelegramTestRateLimitedException);
  });

  it('gửi lại sự kiện đã SENT ⇒ 409, không xếp hàng lại', async () => {
    const { service, events, dispatcher } = build();
    events.findStatus.mockResolvedValue({ status: 'SENT' });
    events.requeue.mockResolvedValue(false);
    await expect(service.retryEvent(ORG, 'e1')).rejects.toBeInstanceOf(NotificationEventNotRetryableException);
    expect(dispatcher.kick).not.toHaveBeenCalled();
  });
});

describe('TelegramConfigService — tuỳ chọn loại thông báo', () => {
  it('đọc / lưu theo ĐÚNG tổ chức của người gọi', async () => {
    const { service, preferences } = build();
    await service.getPreferences(ORG);
    expect(preferences.find).toHaveBeenCalledWith(ORG);

    const saved = await service.savePreferences(ORG, 'admin', { newOrder: false, fulfillment: true });
    expect(preferences.save).toHaveBeenCalledWith(ORG, 'admin', { newOrder: false, fulfillment: true });
    expect(saved).toEqual({ newOrder: false, fulfillment: true });
  });

  it('lưu được cả khi tổ chức CHƯA cấu hình Telegram', async () => {
    const { service, preferences } = build(null);
    await expect(service.savePreferences(ORG, 'admin', { newOrder: true, fulfillment: false })).resolves.toEqual({
      newOrder: true,
      fulfillment: false,
    });
    expect(preferences.save).toHaveBeenCalled();
  });
});
