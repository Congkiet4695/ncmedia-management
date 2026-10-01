import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationEvent,
  NotificationEventStatus,
  NotificationEventType,
  OrganizationTelegramConfig,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TelegramApiError, TelegramBotClient } from '../clients/telegram-bot.client';
import {
  NOTIFICATION_ERROR_CODES,
  NOTIFICATION_RETRY_BASE_MS,
  NOTIFICATION_RETRY_MAX_MS,
} from '../constants/notification.constants';
import { formatTelegramMessage } from '../formatters/telegram-message.formatter';
import {
  EventResult,
  NotificationEventRepository,
} from '../repositories/notification-event.repository';
import {
  allowsEvent,
  type NotificationPreferences,
  NotificationPreferenceRepository,
} from '../repositories/notification-preference.repository';
import { TelegramConfigRepository } from '../repositories/telegram-config.repository';
import type { NotificationPayloadMap } from '../types/notification-payload.types';
import { NotificationEncryptionService } from './notification-encryption.service';

/** Tên log có cấu trúc theo loại sự kiện (yêu cầu vận hành). */
export const NOTIFICATION_LOG_OPERATION: Record<NotificationEventType, string> = {
  ORDER_CREATED: 'ORDER_CREATED_NOTIFICATION',
  FULFILLMENT_SUBMITTED: 'FULFILLMENT_SUCCESS_NOTIFICATION',
  FULFILLMENT_CANCELLED: 'FULFILLMENT_CANCEL_NOTIFICATION',
};

/** Tổng kết một lượt xử lý — phục vụ log và test. */
export interface DispatchSummary {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  deferred: number;
}

/** Cấu hình + token đã giải mã của MỘT tổ chức trong MỘT lượt — không bao giờ log. */
interface OrgChannel {
  config: OrganizationTelegramConfig | null;
  botToken: string | null;
  organizationName: string | null;
  /** Loại thông báo tổ chức đang bật (đọc lại LÚC GỬI — tắt sau khi đã ghi sự kiện vẫn có hiệu lực). */
  preferences: NotificationPreferences | null;
  /** Lỗi cấu hình dùng chung cho mọi sự kiện của tổ chức trong lượt này (vd thiếu khoá mã hoá). */
  blocked: { status: NotificationEventStatus; code: string; message: string } | null;
  /** Telegram đang giới hạn tần suất chat này tới thời điểm này. */
  rateLimitedUntil: Date | null;
}

/**
 * NotificationDispatcherService — worker gửi thông báo từ outbox (`notification_events`).
 *
 * ```
 *   claim (FOR UPDATE SKIP LOCKED, lease) ──▶ PROCESSING
 *     └─ beginAttempt (attempt_count+1, gia hạn lease — còn giữ mới được gửi)
 *          └─ Telegram sendMessage
 *               ├─ OK                         ──▶ SENT
 *               ├─ tạm thời (429/5xx/mạng/timeout), còn lượt ──▶ PENDING + next_attempt_at
 *               ├─ tạm thời, hết lượt / lỗi cố định         ──▶ FAILED
 *               └─ tổ chức tắt / chưa cấu hình              ──▶ SKIPPED
 * ```
 *
 * 🔴 Giao hàng là **at-least-once**: worker chết SAU khi Telegram đã nhận tin nhưng TRƯỚC khi ghi
 * SENT ⇒ lease hết hạn ⇒ sự kiện được claim lại và gửi thêm lần nữa. Telegram Bot API không có khoá
 * idempotency cho sendMessage nên không thể loại bỏ hoàn toàn cửa sổ này — chỉ thu hẹp nó: ghi SENT
 * ngay sau khi có response, lease đủ dài so với timeout HTTP, mỗi sự kiện gia hạn lease trước khi gửi.
 * Trùng ở tầng SỰ KIỆN (một đơn → hai sự kiện) thì KHÔNG thể xảy ra — UNIQUE ở outbox chặn.
 *
 * Không bao giờ ném lỗi ra ngoài — scheduler và các lời gọi `kick()` đều fail-soft.
 */
@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  /** Chặn hai lượt chồng nhau TRONG một tiến trình (giữa các instance đã có SKIP LOCKED). */
  private running = false;
  /** Có yêu cầu chạy trong lúc đang chạy ⇒ chạy thêm một lượt ngay sau. */
  private rerunRequested = false;

  constructor(
    private readonly config: ConfigService,
    private readonly events: NotificationEventRepository,
    private readonly configs: TelegramConfigRepository,
    private readonly telegram: TelegramBotClient,
    private readonly encryption: NotificationEncryptionService,
    private readonly preferences: NotificationPreferenceRepository,
  ) {}

  /**
   * Yêu cầu xử lý sớm (sau khi vừa ghi sự kiện) — không chờ, không ném lỗi. Nhịp cron vẫn là lưới
   * an toàn nếu tiến trình này không kịp chạy.
   */
  kick(): void {
    if (!this.config.get<boolean>('notification.dispatch.enabled', true)) return;
    setImmediate(() => {
      void this.runOnce();
    });
  }

  /** Một lượt: claim theo lô cho tới khi hết sự kiện đến hạn (tối đa vài lô để không chiếm nhịp). */
  async runOnce(): Promise<DispatchSummary> {
    const summary: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, deferred: 0 };
    if (this.running) {
      this.rerunRequested = true;
      return summary;
    }
    this.running = true;
    try {
      const batchSize = this.config.get<number>('notification.dispatch.batchSize', 20);
      for (let round = 0; round < 5; round += 1) {
        const claimed = await this.dispatchBatch(batchSize, summary);
        if (claimed < batchSize) break;
      }
    } catch (error) {
      this.logger.error({
        module: 'notification',
        operation: 'dispatch',
        msg: `Lượt gửi thông báo thất bại: ${(error as Error).message}`,
      });
    } finally {
      this.running = false;
    }
    if (this.rerunRequested) {
      this.rerunRequested = false;
      this.kick();
    }
    return summary;
  }

  private async dispatchBatch(limit: number, summary: DispatchSummary): Promise<number> {
    const leaseMs = this.config.get<number>('notification.dispatch.leaseMs', 120_000);
    const lockToken = randomUUID();
    const claimed = await this.events.claimDue(limit, leaseMs, lockToken);
    summary.claimed += claimed.length;

    // Gom theo tổ chức: cấu hình (và token) chỉ đọc + giải mã MỘT lần cho mỗi tổ chức mỗi lô.
    const channels = new Map<string, OrgChannel>();
    for (const event of claimed) {
      let channel = channels.get(event.organizationId);
      if (!channel) {
        channel = await this.loadChannel(event.organizationId);
        channels.set(event.organizationId, channel);
      }
      await this.processOne(event, channel, lockToken, leaseMs, summary);
    }

    return claimed.length;
  }

  /** Cấu hình Telegram của ĐÚNG tổ chức sở hữu sự kiện (ADR-004). */
  private async loadChannel(organizationId: string): Promise<OrgChannel> {
    const config = await this.configs.findByOrganization(organizationId);
    const channel: OrgChannel = {
      config,
      botToken: null,
      organizationName: null,
      preferences: null,
      blocked: null,
      rateLimitedUntil: null,
    };
    if (!config || !config.enabled) {
      channel.blocked = {
        status: NotificationEventStatus.SKIPPED,
        code: NOTIFICATION_ERROR_CODES.DISABLED,
        message: 'Tổ chức chưa cấu hình hoặc đã tắt thông báo Telegram',
      };
      return channel;
    }
    if (!this.encryption.isConfigured()) {
      channel.blocked = {
        status: NotificationEventStatus.FAILED,
        code: NOTIFICATION_ERROR_CODES.ENCRYPTION_KEY_MISSING,
        message: 'Máy chủ chưa cấu hình NOTIFICATION_ENCRYPTION_KEY — không giải mã được Bot Token',
      };
      return channel;
    }
    try {
      channel.botToken = this.encryption.decrypt(config.botTokenEnc);
    } catch {
      channel.blocked = {
        status: NotificationEventStatus.FAILED,
        code: NOTIFICATION_ERROR_CODES.ENCRYPTION_KEY_MISSING,
        message: 'Không giải mã được Bot Token (khoá mã hoá đã đổi?) — nhập lại Bot Token',
      };
      return channel;
    }
    channel.organizationName = await this.configs.findOrganizationName(organizationId);
    channel.preferences = await this.preferences.find(organizationId);
    return channel;
  }

  private async processOne(
    event: NotificationEvent,
    channel: OrgChannel,
    lockToken: string,
    leaseMs: number,
    summary: DispatchSummary,
  ): Promise<void> {
    const maxAttempts = this.config.get<number>('notification.dispatch.maxAttempts', 5);

    if (channel.blocked) {
      await this.complete(event, lockToken, channel, {
        status: channel.blocked.status,
        lastErrorCode: channel.blocked.code,
        errorMessage: channel.blocked.message,
      }, summary);
      return;
    }

    // Tổ chức đã TẮT loại thông báo này ⇒ bỏ qua, không gọi Telegram.
    if (channel.preferences && !allowsEvent(channel.preferences, event.eventType)) {
      await this.complete(event, lockToken, channel, {
        status: NotificationEventStatus.SKIPPED,
        lastErrorCode: NOTIFICATION_ERROR_CODES.CATEGORY_DISABLED,
        errorMessage: 'Tổ chức đã tắt loại thông báo này trong Cài đặt thông báo',
      }, summary);
      return;
    }

    // Cả chat đang bị giới hạn ⇒ hoãn, KHÔNG tính là một lần thử (chưa gọi Telegram).
    if (channel.rateLimitedUntil && channel.rateLimitedUntil > new Date()) {
      await this.events.release(event.id, lockToken, channel.rateLimitedUntil, 'Hoãn do Telegram giới hạn tần suất chat này');
      summary.deferred += 1;
      return;
    }

    // Sự kiện được claim lại sau khi worker cũ chết có thể đã dùng hết số lượt.
    if (event.attemptCount >= maxAttempts) {
      await this.complete(event, lockToken, channel, {
        status: NotificationEventStatus.FAILED,
        lastErrorCode: event.lastErrorCode ?? NOTIFICATION_ERROR_CODES.TIMEOUT,
        errorMessage: `Đã thử ${event.attemptCount}/${maxAttempts} lần — dừng gửi`,
      }, summary);
      return;
    }

    let text: string;
    try {
      text = formatTelegramMessage(
        event.eventType,
        event.payload as unknown as NotificationPayloadMap[typeof event.eventType],
        {
          organizationName: channel.organizationName,
          timezoneOffsetMinutes: this.config.get<number>('timezoneOffsetMinutes', 420),
        },
      );
    } catch (error) {
      await this.complete(event, lockToken, channel, {
        status: NotificationEventStatus.FAILED,
        lastErrorCode: NOTIFICATION_ERROR_CODES.INVALID_PAYLOAD,
        errorMessage: (error as Error).message,
      }, summary);
      return;
    }

    // Còn giữ sự kiện mới được gửi — lease mất (worker khác nhận lại) thì dừng.
    if (!(await this.events.beginAttempt(event.id, lockToken, leaseMs))) return;
    const attempt = event.attemptCount + 1;
    const config = channel.config as OrganizationTelegramConfig;

    try {
      const { messageId } = await this.telegram.sendMessage(channel.botToken as string, config.chatId, text);
      await this.complete(event, lockToken, channel, {
        status: NotificationEventStatus.SENT,
        sentAt: new Date(),
        providerMessageId: messageId,
        lastErrorCode: null,
        errorMessage: null,
      }, summary, attempt);
      await this.configs.recordDelivery(event.organizationId, config, { ok: true });
    } catch (error) {
      const result = this.resultForError(error, attempt, maxAttempts);
      if (error instanceof TelegramApiError && error.code === NOTIFICATION_ERROR_CODES.RATE_LIMITED) {
        channel.rateLimitedUntil = result.nextAttemptAt ?? null;
      }
      // Lỗi cấu hình (token sai, bot bị kick…) ⇒ các sự kiện còn lại của tổ chức trong lô này sẽ
      // lỗi y hệt: dừng gọi Telegram, ghi cùng lỗi — không dội request vô ích vào Telegram.
      if (result.status === NotificationEventStatus.FAILED && error instanceof TelegramApiError && !error.retryable) {
        channel.blocked = {
          status: NotificationEventStatus.FAILED,
          code: error.code,
          message: error.message,
        };
      }
      await this.complete(event, lockToken, channel, result, summary, attempt, error);
      if (error instanceof TelegramApiError && !error.retryable) {
        await this.configs.recordDelivery(event.organizationId, config, {
          ok: false,
          errorCode: error.code,
          errorMessage: error.message,
        });
      }
    }
  }

  /** Kết quả cho một lần gửi lỗi: hẹn lại (backoff / retry_after) hoặc FAILED. */
  resultForError(error: unknown, attempt: number, maxAttempts: number): EventResult {
    if (!(error instanceof TelegramApiError)) {
      // Lỗi không lường trước (DB, bug) — coi là tạm thời, vẫn giới hạn số lượt.
      return attempt < maxAttempts
        ? {
            status: NotificationEventStatus.PENDING,
            nextAttemptAt: new Date(Date.now() + backoffMs(attempt)),
            lastErrorCode: 'NOTIFICATION_INTERNAL_ERROR',
            errorMessage: (error as Error)?.message ?? 'Lỗi không xác định',
          }
        : {
            status: NotificationEventStatus.FAILED,
            lastErrorCode: 'NOTIFICATION_INTERNAL_ERROR',
            errorMessage: (error as Error)?.message ?? 'Lỗi không xác định',
          };
    }
    if (error.retryable && attempt < maxAttempts) {
      const waitMs = error.retryAfterSeconds
        ? error.retryAfterSeconds * 1000
        : backoffMs(attempt);
      return {
        status: NotificationEventStatus.PENDING,
        nextAttemptAt: new Date(Date.now() + waitMs),
        lastErrorCode: error.code,
        errorMessage: error.message,
      };
    }
    return {
      status: NotificationEventStatus.FAILED,
      lastErrorCode: error.code,
      errorMessage: error.retryable
        ? `${error.message} — đã thử ${attempt}/${maxAttempts} lần`
        : error.message,
    };
  }

  private async complete(
    event: NotificationEvent,
    lockToken: string,
    channel: OrgChannel,
    result: EventResult,
    summary: DispatchSummary,
    attempt?: number,
    error?: unknown,
  ): Promise<void> {
    const applied = await this.events.finish(event.id, lockToken, result);
    if (!applied) return; // mất lease — worker khác đã nhận lại sự kiện.

    if (result.status === NotificationEventStatus.SENT) summary.sent += 1;
    else if (result.status === NotificationEventStatus.PENDING) summary.retried += 1;
    else if (result.status === NotificationEventStatus.SKIPPED) summary.skipped += 1;
    else summary.failed += 1;

    const log = {
      module: 'notification',
      operation: NOTIFICATION_LOG_OPERATION[event.eventType],
      organizationId: event.organizationId,
      eventId: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      tiktokOrderId: (event.payload as { tiktokOrderId?: string } | null)?.tiktokOrderId,
      eventType: event.eventType,
      status: result.status,
      attempt,
      telegramChatId: maskChatId(channel.config?.chatId),
      ...(error instanceof TelegramApiError
        ? { errorCode: error.code, httpStatus: error.httpStatus, delivery: error.delivery }
        : {}),
      ...(result.errorMessage ? { error: result.errorMessage } : {}),
      ...(result.nextAttemptAt ? { nextAttemptAt: result.nextAttemptAt.toISOString() } : {}),
    };
    if (result.status === NotificationEventStatus.SENT || result.status === NotificationEventStatus.SKIPPED) {
      this.logger.log({ ...log, msg: 'Kết quả gửi thông báo Telegram' });
    } else {
      this.logger.warn({ ...log, msg: 'Gửi thông báo Telegram chưa thành công' });
    }
  }
}

/** 30s, 60s, 120s… chặn trên 30 phút. */
export function backoffMs(attempt: number): number {
  return Math.min(NOTIFICATION_RETRY_BASE_MS * 2 ** Math.max(attempt - 1, 0), NOTIFICATION_RETRY_MAX_MS);
}

/** `-1001234567890` → `-100******7890` — đủ để đối chiếu trong log, không lộ toàn bộ. */
export function maskChatId(chatId: string | null | undefined): string | undefined {
  if (!chatId) return undefined;
  if (chatId.length <= 8) return `***${chatId.slice(-2)}`;
  return `${chatId.slice(0, 4)}${'*'.repeat(chatId.length - 8)}${chatId.slice(-4)}`;
}
