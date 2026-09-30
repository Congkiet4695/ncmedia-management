import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFICATION_ERROR_CODES,
  type NotificationErrorCode,
} from '../constants/notification.constants';

/**
 * Telegram đã nhận request hay chưa — ghi vào log để truy vết khả năng tin trùng.
 *
 * - `NOT_DELIVERED`: chắc chắn chưa tới Telegram (DNS, từ chối kết nối) hoặc Telegram đã trả lời
 *   là KHÔNG gửi (4xx/429/5xx) ⇒ gửi lại không thể sinh tin trùng.
 * - `UNKNOWN`: request có thể đã tới nơi nhưng không nhận được trả lời (timeout, đứt kết nối giữa
 *   chừng). VẪN tự gửi lại (at-least-once — mất thông báo tệ hơn trùng thông báo), nhưng log ghi
 *   rõ `delivery=UNKNOWN` vì lần gửi lại CÓ THỂ sinh tin trùng: Telegram Bot API không có khoá
 *   idempotency cho sendMessage.
 */
export type TelegramDeliveryState = 'NOT_DELIVERED' | 'UNKNOWN';

/**
 * Lỗi đã phân loại của Telegram Bot API.
 *
 * 🔴 `message` KHÔNG BAO GIỜ chứa Bot Token — URL gọi API có token nên tuyệt đối không đưa URL,
 * request hay stack của fetch vào lỗi / log.
 */
export class TelegramApiError extends Error {
  constructor(
    readonly code: NotificationErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly delivery: TelegramDeliveryState,
    readonly httpStatus?: number,
    /** `parameters.retry_after` (giây) của lỗi 429. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export interface TelegramBotIdentity {
  id: number;
  username: string | null;
}

interface TelegramEnvelope<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

/** Mã lỗi mạng mà request CHẮC CHẮN chưa rời khỏi máy (chưa kết nối được). */
const PRE_CONNECT_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/**
 * TelegramBotClient — cửa DUY NHẤT ra Telegram Bot API (https://core.telegram.org/bots/api).
 *
 * Không đọc cấu hình tổ chức, không ghi DB, không biết nghiệp vụ: nhận token + chat id đã giải
 * mã, gọi API, phân loại lỗi. Business logic đơn hàng / fulfillment KHÔNG bao giờ gọi thẳng lớp này.
 */
@Injectable()
export class TelegramBotClient {
  constructor(private readonly config: ConfigService) {}

  /** Kiểm tra token: trả danh tính bot. */
  async getMe(botToken: string): Promise<TelegramBotIdentity> {
    const result = await this.call<{ id: number; username?: string }>(botToken, 'getMe', {});
    return { id: result.id, username: result.username ?? null };
  }

  /** Gửi một tin HTML (đã escape ở formatter). Trả `message_id`. */
  async sendMessage(botToken: string, chatId: string, html: string): Promise<{ messageId: string }> {
    const result = await this.call<{ message_id: number }>(botToken, 'sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    return { messageId: String(result.message_id) };
  }

  private async call<T>(botToken: string, method: string, body: object): Promise<T> {
    const baseUrl = this.config.get<string>('notification.telegram.apiBaseUrl', 'https://api.telegram.org');
    const timeoutMs = this.config.get<number>('notification.telegram.timeoutMs', 10_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw this.classifyTransportError(error, timeoutMs);
    } finally {
      clearTimeout(timer);
    }

    let envelope: TelegramEnvelope<T> | null = null;
    try {
      envelope = (await response.json()) as TelegramEnvelope<T>;
    } catch {
      envelope = null;
    }

    if (response.ok && envelope?.ok && envelope.result !== undefined) return envelope.result;
    throw this.classifyApiError(response.status, envelope);
  }

  /** Lỗi trước khi có HTTP response. */
  private classifyTransportError(error: unknown, timeoutMs: number): TelegramApiError {
    const err = error as { name?: string; cause?: { code?: string } };
    if (err?.name === 'AbortError') {
      return new TelegramApiError(
        NOTIFICATION_ERROR_CODES.TIMEOUT,
        `Telegram không phản hồi sau ${timeoutMs}ms`,
        true,
        'UNKNOWN',
      );
    }
    const code = err?.cause?.code;
    if (code && PRE_CONNECT_ERROR_CODES.has(code)) {
      return new TelegramApiError(
        NOTIFICATION_ERROR_CODES.NETWORK,
        `Không kết nối được tới Telegram (${code})`,
        true,
        'NOT_DELIVERED',
      );
    }
    // Đứt kết nối sau khi đã gửi (ECONNRESET, socket đóng…): không biết Telegram đã nhận chưa.
    return new TelegramApiError(
      NOTIFICATION_ERROR_CODES.TIMEOUT,
      `Mất kết nối tới Telegram giữa chừng${code ? ` (${code})` : ''}`,
      true,
      'UNKNOWN',
    );
  }

  /** Telegram đã trả lời (HTTP response) nhưng không thành công ⇒ tin CHẮC CHẮN chưa được gửi. */
  private classifyApiError(
    httpStatus: number,
    envelope: TelegramEnvelope<unknown> | null,
  ): TelegramApiError {
    const status = envelope?.error_code ?? httpStatus;
    const description = (envelope?.description ?? `HTTP ${httpStatus}`).slice(0, 500);

    if (status === 429) {
      const retryAfter = envelope?.parameters?.retry_after;
      return new TelegramApiError(
        NOTIFICATION_ERROR_CODES.RATE_LIMITED,
        `Telegram giới hạn tần suất: ${description}`,
        true,
        'NOT_DELIVERED',
        status,
        typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    if (status >= 500) {
      return new TelegramApiError(
        NOTIFICATION_ERROR_CODES.SERVER_ERROR,
        `Telegram lỗi máy chủ: ${description}`,
        true,
        'NOT_DELIVERED',
        status,
      );
    }
    // Telegram trả 404 cho token sai định dạng / không tồn tại, 401 cho token bị thu hồi.
    if (status === 401 || status === 404) {
      return new TelegramApiError(
        NOTIFICATION_ERROR_CODES.INVALID_TOKEN,
        `Bot Token không hợp lệ: ${description}`,
        false,
        'NOT_DELIVERED',
        status,
      );
    }
    if (status === 403) {
      return new TelegramApiError(
        NOTIFICATION_ERROR_CODES.FORBIDDEN,
        `Bot không có quyền gửi tin vào chat này: ${description}`,
        false,
        'NOT_DELIVERED',
        status,
      );
    }
    if (/chat not found/i.test(description)) {
      return new TelegramApiError(
        NOTIFICATION_ERROR_CODES.CHAT_NOT_FOUND,
        `Không tìm thấy chat (sai Chat ID hoặc bot chưa được thêm vào group): ${description}`,
        false,
        'NOT_DELIVERED',
        status,
      );
    }
    const migrateTo = envelope?.parameters?.migrate_to_chat_id;
    return new TelegramApiError(
      NOTIFICATION_ERROR_CODES.BAD_REQUEST,
      migrateTo
        ? `Group đã nâng cấp thành supergroup — đổi Chat ID thành ${migrateTo}`
        : `Telegram từ chối request: ${description}`,
      false,
      'NOT_DELIVERED',
      status,
    );
  }
}
