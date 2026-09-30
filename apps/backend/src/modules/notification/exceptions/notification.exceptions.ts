import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

/** Máy chủ thiếu / sai `NOTIFICATION_ENCRYPTION_KEY` — lỗi vận hành, không phải lỗi người dùng. */
export class NotificationEncryptionKeyMissingException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'NOTIFICATION_ENCRYPTION_KEY_MISSING',
      message:
        'Máy chủ chưa cấu hình NOTIFICATION_ENCRYPTION_KEY (base64 của đúng 32 byte) nên chưa lưu / ' +
        'dùng được Bot Token. Liên hệ quản trị hệ thống.',
    });
  }
}

/** Tạo cấu hình lần đầu mà không có Bot Token. */
export class TelegramBotTokenRequiredException extends BadRequestException {
  constructor() {
    super({
      code: 'TELEGRAM_BOT_TOKEN_REQUIRED',
      message: 'Nhập Bot Token (lấy từ @BotFather) để kết nối Telegram.',
    });
  }
}

/** Tổ chức chưa có cấu hình Telegram (gửi thử / xoá khi chưa lưu). */
export class TelegramConfigNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'TELEGRAM_CONFIG_NOT_FOUND',
      message: 'Tổ chức chưa cấu hình Telegram.',
    });
  }
}

/** Gửi thử quá nhiều lần trong một phút. */
export class TelegramTestRateLimitedException extends HttpException {
  constructor() {
    super(
      {
        code: 'TELEGRAM_TEST_RATE_LIMITED',
        message: 'Gửi thử quá nhiều lần. Vui lòng đợi một phút rồi thử lại.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class NotificationEventNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOTIFICATION_EVENT_NOT_FOUND', message: 'Không tìm thấy thông báo.' });
  }
}

/** Chỉ thông báo FAILED / UNCERTAIN / SKIPPED mới gửi lại được. */
export class NotificationEventNotRetryableException extends ConflictException {
  constructor(status: string) {
    super({
      code: 'NOTIFICATION_EVENT_NOT_RETRYABLE',
      message: `Thông báo đang ở trạng thái ${status} — chỉ gửi lại được thông báo lỗi, bị bỏ qua hoặc chưa rõ kết quả.`,
    });
  }
}
