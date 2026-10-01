/**
 * Hằng số của module Notification. Tham số VẬN HÀNH (timeout, cron, số lần thử…) nằm ở
 * `config/configuration.ts` (ENV) — ở đây chỉ là quy tắc cố định của Telegram Bot API.
 */

/**
 * Định dạng Bot Token do BotFather cấp: `<bot id>:<secret>` (vd `123456789:AA…`).
 * Kiểm tra hình thức trước khi gọi Telegram để lỗi gõ nhầm được báo ngay tại form.
 */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{5,20}:[A-Za-z0-9_-]{30,64}$/;

/**
 * Chat ID: số nguyên (âm cho group / supergroup / channel, vd `-1001234567890`) hoặc
 * `@username` của channel công khai.
 */
export const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

/** Giới hạn độ dài một tin nhắn của Telegram (sendMessage: 1–4096 ký tự sau khi parse). */
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

/** Số dòng sản phẩm tối đa liệt kê trong một tin — phần còn lại gộp thành "…và N sản phẩm khác". */
export const NOTIFICATION_MAX_ITEMS_IN_MESSAGE = 10;

/** Số ký tự cuối của Bot Token được lưu để nhận diện (không đủ để dùng). */
export const TELEGRAM_TOKEN_HINT_LENGTH = 4;

/** Backoff khi Telegram lỗi tạm thời: 30s, 60s, 120s… chặn trên 30 phút. */
export const NOTIFICATION_RETRY_BASE_MS = 30_000;
export const NOTIFICATION_RETRY_MAX_MS = 30 * 60_000;

/** Gửi thử: tối đa N lần mỗi cửa sổ cho MỘT tổ chức (chống bấm liên tục / spam group). */
export const TELEGRAM_TEST_RATE_LIMIT = { limit: 5, windowSeconds: 60 } as const;

/** Mã lỗi chuẩn hoá của một lần gửi — lưu vào `last_error_code`, giao diện dịch theo mã. */
export const NOTIFICATION_ERROR_CODES = {
  /** Token sai / bot bị thu hồi (401). */
  INVALID_TOKEN: 'TELEGRAM_INVALID_TOKEN',
  /** Chat không tồn tại / bot chưa được thêm vào group (400 chat not found). */
  CHAT_NOT_FOUND: 'TELEGRAM_CHAT_NOT_FOUND',
  /** Bot bị kick / không có quyền gửi tin (403). */
  FORBIDDEN: 'TELEGRAM_FORBIDDEN',
  /** Request không hợp lệ khác (400). */
  BAD_REQUEST: 'TELEGRAM_BAD_REQUEST',
  RATE_LIMITED: 'TELEGRAM_RATE_LIMITED',
  SERVER_ERROR: 'TELEGRAM_SERVER_ERROR',
  /** Không kết nối được (DNS / từ chối kết nối) — request CHẮC CHẮN chưa tới Telegram. */
  NETWORK: 'TELEGRAM_NETWORK_ERROR',
  /** Hết thời gian chờ / mất kết nối giữa chừng — không biết Telegram đã nhận hay chưa (vẫn retry). */
  TIMEOUT: 'TELEGRAM_TIMEOUT',
  /** Tổ chức chưa cấu hình hoặc đã tắt Telegram. */
  DISABLED: 'NOTIFICATION_CHANNEL_DISABLED',
  /** Tổ chức đã tắt LOẠI thông báo này (New Order / Fulfill) trong Cài đặt thông báo. */
  CATEGORY_DISABLED: 'NOTIFICATION_CATEGORY_DISABLED',
  /** Máy chủ thiếu / sai NOTIFICATION_ENCRYPTION_KEY. */
  ENCRYPTION_KEY_MISSING: 'NOTIFICATION_ENCRYPTION_KEY_MISSING',
  /** Payload không dựng được tin nhắn (dữ liệu hỏng). */
  INVALID_PAYLOAD: 'NOTIFICATION_INVALID_PAYLOAD',
} as const;

export type NotificationErrorCode =
  (typeof NOTIFICATION_ERROR_CODES)[keyof typeof NOTIFICATION_ERROR_CODES];
