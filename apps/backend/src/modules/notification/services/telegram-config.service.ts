import { Injectable, Logger } from '@nestjs/common';
import { NotificationEvent, OrganizationTelegramConfig } from '@prisma/client';
import { RedisService } from '../../../redis/redis.service';
import { TelegramApiError, TelegramBotClient } from '../clients/telegram-bot.client';
import {
  TELEGRAM_TEST_RATE_LIMIT,
  TELEGRAM_TOKEN_HINT_LENGTH,
} from '../constants/notification.constants';
import {
  NotificationEventDto,
  NotificationEventQueryDto,
  PaginatedNotificationEventDto,
  SaveTelegramConfigDto,
  TelegramConfigDto,
  TelegramIntegrationStatus,
  TelegramTestResultDto,
  TestTelegramDto,
} from '../dto/notification.dto';
import { escapeHtml, formatDateTime } from '../formatters/telegram-message.formatter';
import {
  NotificationEventNotFoundException,
  NotificationEventNotRetryableException,
  TelegramBotTokenRequiredException,
  TelegramConfigNotFoundException,
  TelegramTestRateLimitedException,
} from '../exceptions/notification.exceptions';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import {
  NotificationPreferenceRepository,
  type NotificationPreferences,
} from '../repositories/notification-preference.repository';
import { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import { NotificationDispatcherService, maskChatId } from './notification-dispatcher.service';
import { NotificationEncryptionService } from './notification-encryption.service';
import { ConfigService } from '@nestjs/config';

/**
 * TelegramConfigService — cấu hình Telegram của tổ chức + màn hình "Thông báo gần đây".
 *
 * 🔴 Mọi thao tác nhận `organizationId` từ JWT (controller) — không có tham số nào cho phép chạm
 * cấu hình / sự kiện của tổ chức khác. Bot Token chỉ đi MỘT chiều: vào (mã hoá ngay), không bao giờ ra.
 */
@Injectable()
export class TelegramConfigService {
  private readonly logger = new Logger(TelegramConfigService.name);

  constructor(
    private readonly configs: TelegramConfigRepository,
    private readonly events: NotificationEventRepository,
    private readonly encryption: NotificationEncryptionService,
    private readonly telegram: TelegramBotClient,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly preferences: NotificationPreferenceRepository,
  ) {}

  getPreferences(organizationId: string): Promise<NotificationPreferences> {
    return this.preferences.find(organizationId);
  }

  async savePreferences(
    organizationId: string,
    actorUserId: string,
    dto: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    const saved = await this.preferences.save(organizationId, actorUserId, {
      newOrder: dto.newOrder,
      fulfillment: dto.fulfillment,
    });
    this.logger.log({
      module: 'notification',
      operation: 'preferences.save',
      organizationId,
      ...saved,
      msg: 'Đã lưu loại thông báo của tổ chức',
    });
    return saved;
  }

  async get(organizationId: string): Promise<TelegramConfigDto> {
    return this.toDto(await this.configs.findByOrganization(organizationId));
  }

  async save(
    organizationId: string,
    actorUserId: string,
    dto: SaveTelegramConfigDto,
  ): Promise<TelegramConfigDto> {
    const existing = await this.configs.findByOrganization(organizationId);
    // Mã hoá NGAY tại điểm nhận — giá trị thô không đi xa hơn dòng này.
    const token = dto.botToken
      ? {
          botTokenEnc: this.encryption.encrypt(dto.botToken),
          botTokenHint: dto.botToken.slice(-TELEGRAM_TOKEN_HINT_LENGTH),
        }
      : null;

    let saved: OrganizationTelegramConfig | null;
    if (!existing) {
      // Lần đầu bắt buộc có token.
      if (!token) throw new TelegramBotTokenRequiredException();
      saved = await this.configs.create(organizationId, actorUserId, {
        ...token,
        chatId: dto.chatId,
        enabled: dto.enabled,
      });
    } else {
      // Cập nhật mà để trống token ⇒ GIỮ token cũ (không ghi đè bằng rỗng). Đổi token / Chat ID ⇒
      // kết quả gửi cũ không còn nói gì về cấu hình mới.
      const resetDelivery =
        token || existing.chatId !== dto.chatId
          ? { lastDeliveryOk: null, lastDeliveryAt: null, lastErrorCode: null, lastErrorMessage: null }
          : {};
      saved = await this.configs.update(organizationId, actorUserId, {
        ...(token ? { ...token, botUsername: null } : {}),
        ...resetDelivery,
        chatId: dto.chatId,
        enabled: dto.enabled,
      });
      // Bị xoá song song giữa hai câu lệnh ⇒ coi như chưa cấu hình.
      if (!saved) throw new TelegramConfigNotFoundException();
    }
    const tokenChanged = token !== null;

    this.logger.log({
      module: 'notification',
      operation: 'telegram.config.save',
      organizationId,
      enabled: saved.enabled,
      tokenChanged,
      telegramChatId: maskChatId(saved.chatId),
      msg: 'Đã lưu cấu hình Telegram',
    });
    return this.toDto(saved);
  }

  async remove(organizationId: string, actorUserId: string): Promise<void> {
    const removed = await this.configs.softDelete(organizationId, actorUserId);
    if (!removed) throw new TelegramConfigNotFoundException();
    this.logger.log({
      module: 'notification',
      operation: 'telegram.config.delete',
      organizationId,
      msg: 'Đã xoá cấu hình Telegram',
    });
  }

  /**
   * Gửi tin thử — đồng bộ, KHÔNG qua outbox (người dùng đang chờ kết quả trên màn hình).
   *
   * Dùng giá trị trên form nếu có (thử trước khi lưu), còn lại dùng cấu hình đã lưu. Lỗi của
   * Telegram trả về `success: false` + nguyên nhân (HTTP 200) để giao diện hiển thị rõ ràng.
   */
  async test(organizationId: string, dto: TestTelegramDto): Promise<TelegramTestResultDto> {
    await this.assertTestRate(organizationId);
    const existing = await this.configs.findByOrganization(organizationId);

    const chatId = dto.chatId ?? existing?.chatId;
    if (!existing && (!dto.botToken || !chatId)) throw new TelegramConfigNotFoundException();
    if (!chatId) throw new TelegramConfigNotFoundException();
    const botToken = dto.botToken ?? this.encryption.decrypt((existing as OrganizationTelegramConfig).botTokenEnc);
    if (!botToken) throw new TelegramBotTokenRequiredException();

    // Chỉ khi thử ĐÚNG cấu hình đã lưu thì kết quả mới được ghi làm trạng thái kết nối.
    const testsSaved =
      existing !== null && !dto.botToken && (dto.chatId === undefined || dto.chatId === existing.chatId);

    let botUsername: string | null = null;
    try {
      const identity = await this.telegram.getMe(botToken);
      botUsername = identity.username;
      const orgName = await this.configs.findOrganizationName(organizationId);
      const when = formatDateTime(
        new Date().toISOString(),
        this.config.get<number>('timezoneOffsetMinutes', 420),
      );
      await this.telegram.sendMessage(
        botToken,
        chatId,
        [
          '✅ <b>Telegram connection successful</b>',
          '',
          `NCMedia sẽ gửi thông báo đơn mới / fulfillment${orgName ? ` của <b>${escapeHtml(orgName)}</b>` : ''} vào chat này.`,
          when ? `📅 ${when}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      if (testsSaved && existing) {
        await this.configs.recordDelivery(organizationId, existing, { ok: true, botUsername });
      }
      this.logTest(organizationId, chatId, true);
      return {
        success: true,
        message: 'Telegram connection successful.',
        errorCode: null,
        botUsername,
      };
    } catch (error) {
      if (!(error instanceof TelegramApiError)) throw error;
      if (testsSaved && existing) {
        await this.configs.recordDelivery(organizationId, existing, {
          ok: false,
          errorCode: error.code,
          errorMessage: error.message,
        });
      }
      this.logTest(organizationId, chatId, false, error);
      return { success: false, message: error.message, errorCode: error.code, botUsername };
    }
  }

  async listEvents(
    organizationId: string,
    query: NotificationEventQueryDto,
  ): Promise<PaginatedNotificationEventDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.events.list(
      organizationId,
      { status: query.status, eventType: query.eventType },
      page,
      limit,
    );
    return {
      items: items.map((event) => this.toEventDto(event)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async retryEvent(organizationId: string, id: string): Promise<void> {
    const current = await this.events.findStatus(organizationId, id);
    if (!current) throw new NotificationEventNotFoundException();
    if (!(await this.events.requeue(organizationId, id))) {
      throw new NotificationEventNotRetryableException(current.status);
    }
    this.dispatcher.kick();
  }

  async retryAllFailed(organizationId: string): Promise<number> {
    const requeued = await this.events.requeueAllFailed(organizationId);
    if (requeued > 0) this.dispatcher.kick();
    return requeued;
  }

  // ---------------------------------------------------------------------------

  /** Chống bấm "Gửi thử" liên tục (spam group, đốt giới hạn tần suất của bot). */
  private async assertTestRate(organizationId: string): Promise<void> {
    const key = `notification:telegram:test:${organizationId}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, TELEGRAM_TEST_RATE_LIMIT.windowSeconds);
    if (count > TELEGRAM_TEST_RATE_LIMIT.limit) throw new TelegramTestRateLimitedException();
  }

  private logTest(organizationId: string, chatId: string, ok: boolean, error?: TelegramApiError): void {
    this.logger.log({
      module: 'notification',
      operation: 'telegram.test',
      organizationId,
      telegramChatId: maskChatId(chatId),
      status: ok ? 'SENT' : 'FAILED',
      ...(error ? { errorCode: error.code, httpStatus: error.httpStatus, error: error.message } : {}),
      msg: 'Gửi tin thử Telegram',
    });
  }

  private toDto(config: OrganizationTelegramConfig | null): TelegramConfigDto {
    const encryptionReady = this.encryption.isConfigured();
    if (!config) {
      return {
        configured: false,
        enabled: false,
        status: TelegramIntegrationStatus.NOT_CONFIGURED,
        botTokenMasked: null,
        botUsername: null,
        chatId: null,
        lastDeliveryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        encryptionReady,
        updatedAt: null,
      };
    }
    const status = !config.enabled
      ? TelegramIntegrationStatus.DISABLED
      : config.lastDeliveryOk === true
        ? TelegramIntegrationStatus.CONNECTED
        : config.lastDeliveryOk === false
          ? TelegramIntegrationStatus.DISCONNECTED
          : TelegramIntegrationStatus.UNTESTED;
    return {
      configured: true,
      enabled: config.enabled,
      status,
      botTokenMasked: `••••••••${config.botTokenHint}`,
      botUsername: config.botUsername,
      chatId: config.chatId,
      lastDeliveryAt: config.lastDeliveryAt,
      lastErrorCode: config.lastErrorCode,
      lastErrorMessage: config.lastErrorMessage,
      encryptionReady,
      updatedAt: config.updatedAt,
    };
  }

  private toEventDto(event: NotificationEvent): NotificationEventDto {
    const payload = event.payload as { tiktokOrderId?: unknown } | null;
    return {
      id: event.id,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      tiktokOrderId: typeof payload?.tiktokOrderId === 'string' ? payload.tiktokOrderId : null,
      status: event.status,
      attemptCount: event.attemptCount,
      nextAttemptAt: event.nextAttemptAt,
      sentAt: event.sentAt,
      lastErrorCode: event.lastErrorCode,
      errorMessage: event.errorMessage,
      createdAt: event.createdAt,
    };
  }
}
