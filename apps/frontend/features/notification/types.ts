import type { Paginated } from '@/types/api';

/** Trạng thái hiển thị của tích hợp Telegram (backend tính). */
export type TelegramIntegrationStatus =
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'UNTESTED'
  | 'CONNECTED'
  | 'DISCONNECTED';

/** Cấu hình Telegram của tổ chức — backend KHÔNG BAO GIỜ trả Bot Token, chỉ bản che. */
export interface TelegramConfig {
  configured: boolean;
  enabled: boolean;
  status: TelegramIntegrationStatus;
  botTokenMasked: string | null;
  botUsername: string | null;
  chatId: string | null;
  lastDeliveryAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** Máy chủ đã có NOTIFICATION_ENCRYPTION_KEY hợp lệ chưa. */
  encryptionReady: boolean;
  updatedAt: string | null;
}

/** Loại thông báo tổ chức muốn nhận — lưu riêng theo tổ chức, backend áp dụng khi ghi và khi gửi. */
export interface NotificationPreferences {
  newOrder: boolean;
  fulfillment: boolean;
}

export interface SaveTelegramConfigInput {
  /** Bỏ trống khi cập nhật ⇒ giữ token cũ. */
  botToken?: string;
  chatId: string;
  enabled: boolean;
}

export interface TestTelegramInput {
  botToken?: string;
  chatId?: string;
}

export interface TelegramTestResult {
  success: boolean;
  message: string;
  errorCode: string | null;
  botUsername: string | null;
}

export type NotificationEventType = 'ORDER_CREATED' | 'FULFILLMENT_SUBMITTED' | 'FULFILLMENT_CANCELLED';
export type NotificationEventStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'SKIPPED';

export const NOTIFICATION_EVENT_TYPES: NotificationEventType[] = [
  'ORDER_CREATED',
  'FULFILLMENT_SUBMITTED',
  'FULFILLMENT_CANCELLED',
];
export const NOTIFICATION_EVENT_STATUSES: NotificationEventStatus[] = [
  'PENDING',
  'PROCESSING',
  'SENT',
  'FAILED',
  'SKIPPED',
];

export interface NotificationEvent {
  id: string;
  eventType: NotificationEventType;
  entityType: 'POD_ORDER' | 'FULFILLMENT_ORDER';
  entityId: string;
  tiktokOrderId: string | null;
  status: NotificationEventStatus;
  attemptCount: number;
  nextAttemptAt: string;
  sentAt: string | null;
  lastErrorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface NotificationEventQuery {
  page: number;
  limit: number;
  status?: NotificationEventStatus;
  eventType?: NotificationEventType;
}

export type PaginatedNotificationEvents = Paginated<NotificationEvent>;

/** Định dạng phía giao diện — cùng quy tắc với backend (chỉ để báo lỗi sớm tại form). */
export const TELEGRAM_BOT_TOKEN_PATTERN = /^\d{5,20}:[A-Za-z0-9_-]{30,64}$/;
export const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
